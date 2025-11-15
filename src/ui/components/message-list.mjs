/**
 * Message List Component - TinyBase + Reef.js
 *
 * Architecture:
 * TinyBase (数据源) → Signal (响应式) → Reef Component (自动渲染)
 *
 * NOTE: 这个组件复用 index.mjs 中的 createMessageElement 函数来渲染消息
 * 不自己写 HTML，而是调用现有的消息渲染逻辑
 */

import { signal, component } from 'reefjs';
import { listenReefRender } from '../utils/reef-helpers.mjs';
import { tryDecryptMessage } from '../utils/message-crypto.mjs';
import CryptoUtils from '../../common/crypto-utils.js';
import { markChannelAsRead, getUnreadCount } from '../tinybase/read-status.mjs';

const SignalName = 'messagesSignal';

/**
 * Initialize message list component
 * @param {Object} tinybaseStore - TinyBase store instance
 * @param {Object} tinybaseIndexes - TinyBase indexes instance for O(log n) filtering
 * @param {string} containerSelector - CSS selector for container element
 * @param {Function} getCurrentChannel - Function to get current channel
 * @param {Function} createMessageElement - Function to create message DOM element
 * @param {Object} encryptionContext - Encryption context { currentRoomKey, isRoomEncrypted }
 * @param {Map} messagesCache - Global messages cache for legacy features (threads, etc.)
 * @param {Function} updateThreadInfo - Function to update thread info for reply messages
 * @param {Object} readStatusStore - TinyBase store for read status tracking
 * @param {string} roomName - Current room name
 * @returns {Object} Component instance and helper functions
 */
export function initMessageList(
  tinybaseStore,
  tinybaseIndexes,
  containerSelector,
  getCurrentChannel,
  createMessageElement,
  encryptionContext,
  messagesCache,
  updateThreadInfo,
  readStatusStore,
  roomName,
) {
  // Reef.js Signal - 响应式消息数据
  const messagesSignal = signal(
    {
      items: [], // 消息列表
      loading: false, // 加载状态
      error: null, // 错误信息
      version: 0, // 版本号，用于强制重新渲染
    },
    SignalName || 'messagesSignal',
  );

  /**
   * Sync TinyBase → Signal
   * 监听 TinyBase 的 messages 表变化，自动更新 Signal
   * 包含解密、replyTo 预览生成等完整逻辑
   */
  async function syncTinybaseToSignal() {
    try {
      const currentChannel = getCurrentChannel();

      // ✅ Use index for O(log n) query - much faster than O(n) filter!
      // Get message IDs for current channel from pre-built index
      const messageIds = tinybaseIndexes.getSliceRowIds(
        'messagesByChannel',
        currentChannel,
      );

      console.log(
        `📇 Index query: found ${messageIds.length} messages in #${currentChannel}`,
      );

      // Convert to message objects (原始加密数据)
      const rawMessagesList = messageIds.map((messageId) => {
        const row = tinybaseStore.getRow('messages', messageId);
        return {
          messageId: messageId,
          name: row.username || 'Anonymous',
          message: row.text || '',
          timestamp: row.timestamp || Date.now(),
          channel: row.channel || 'general',
          replyToId: row.replyToId || null,
          editedAt: row.editedAt || null,
          encrypted: CryptoUtils.isEncrypted(row.text || ''),
          uploadProgress: row.uploadProgress,
          uploadStatus: row.uploadStatus,
        };
      });
      // Note: Already sorted by timestamp via index definition!

      // 解密所有消息（并行处理）
      const decryptionPromises = rawMessagesList.map(async (msg) => {
        // 解密主消息
        const decryptedMessage = await tryDecryptMessage(
          { message: msg.message },
          encryptionContext.currentRoomKey,
          encryptionContext.isRoomEncrypted,
        );

        // 处理 replyTo - 需要从 TinyBase 获取父消息并解密
        let replyTo = null;
        if (msg.replyToId) {
          // 从 TinyBase 获取父消息
          const parentData = tinybaseStore.getCell(
            'messages',
            msg.replyToId,
            'text',
          );
          const parentUsername = tinybaseStore.getCell(
            'messages',
            msg.replyToId,
            'username',
          );

          if (parentData) {
            // 解密父消息
            const decryptedParent = await tryDecryptMessage(
              { message: parentData },
              encryptionContext.currentRoomKey,
              encryptionContext.isRoomEncrypted,
            );

            // 生成预览（前 50 个字符）
            let preview = decryptedParent;
            if (preview.startsWith('FILE:')) {
              const parts = preview.substring(5).split('|');
              preview = parts[1] || 'File'; // 使用文件名作为预览
            }
            preview = preview.substring(0, 50);
            if (decryptedParent.length > 50) {
              preview += '...';
            }

            replyTo = {
              messageId: msg.replyToId,
              username: parentUsername || 'Anonymous',
              preview: preview,
              message: decryptedParent, // 完整解密后的消息（用于某些 UI 场景）
            };
          }
        }

        // 返回完整的、解密后的消息数据
        return {
          messageId: msg.messageId,
          name: msg.name,
          message: decryptedMessage, // 已解密
          timestamp: msg.timestamp,
          channel: msg.channel,
          replyTo: replyTo, // 已处理预览
          editedAt: msg.editedAt,
        };
      });

      // 等待所有解密完成
      const messagesList = await Promise.all(decryptionPromises);

      // 缓存消息到全局 messagesCache（用于线程等遗留功能）
      messagesList.forEach((msg) => {
        messagesCache.set(msg.messageId, msg);
      });

      // Update unread counts using read status store
      if (readStatusStore && roomName) {
        // Get all messages from TinyBase
        const allMessages = Object.entries(
          tinybaseStore.getTable('messages') || {},
        ).map(([id, data]) => ({
          messageId: id,
          channel: data.channel || 'general',
        }));

        // Update unread count for each channel
        const channelsSet = new Set(allMessages.map((m) => m.channel));
        channelsSet.forEach((channel) => {
          const unreadCount = getUnreadCount(
            readStatusStore,
            roomName,
            channel,
            allMessages,
          );

          // Update UI - call global function to set unread count
          if (window.setChannelUnreadCount) {
            window.setChannelUnreadCount(channel, unreadCount);
          }
        });

        // Mark current channel messages as read
        const currentChannelMessages = messagesList.filter(
          (msg) => msg.channel.toLowerCase() === currentChannel.toLowerCase(),
        );
        if (currentChannelMessages.length > 0) {
          markChannelAsRead(
            readStatusStore,
            roomName,
            currentChannel,
            currentChannelMessages,
          );
          console.log(
            `✅ Marked ${currentChannelMessages.length} messages in #${currentChannel} as read`,
          );
        }
      }

      // 更新 Signal（触发 Reef.js 重新渲染）
      messagesSignal.items = messagesList;
      messagesSignal.error = null;
      messagesSignal.version++; // 增加版本号，强制重新渲染

      console.log(
        '📊 Messages synced to Signal (decrypted):',
        messagesList.length,
      );
    } catch (error) {
      console.error('Failed to sync TinyBase to Signal:', error);
      messagesSignal.error = error.message;
    }
  }

  // 监听 TinyBase messages 表的变化
  tinybaseStore.addTableListener('messages', () => {
    console.log('🔄 TinyBase messages table changed, syncing to Signal...');
    // Note: async function, but we don't await here (fire and forget)
    syncTinybaseToSignal().catch((err) => {
      console.error('Error in syncTinybaseToSignal:', err);
    });
  });

  // 监听 TinyBase reaction_instances 表的变化，也触发重新渲染
  tinybaseStore.addTableListener('reaction_instances', () => {
    console.log('🔄 TinyBase reactions changed, re-rendering messages...');
    // Reactions 改变时，只需要增加版本号，触发重新渲染
    messagesSignal.version++;
  });

  // 初始同步
  syncTinybaseToSignal().catch((err) => {
    console.error('Error in initial sync:', err);
  });

  /**
   * Template function - 消息列表渲染
   *
   * NOTE: 这里不返回 HTML 字符串，而是返回一个占位符
   * 实际渲染通过 render() 钩子在 DOM 中操作
   */
  function messagesTemplate() {
    const currentChannel = getCurrentChannel();

    // 不再显示全屏 loading，改为在 channel info bar 显示
    // if (messagesSignal.loading) {
    //   return '<div class="message-loading">Loading messages...</div>';
    // }

    if (messagesSignal.error) {
      return `<div class="message-error">Error: ${messagesSignal.error}</div>`;
    }

    // 过滤当前频道的消息
    const channelMessages = messagesSignal.items.filter(
      (msg) => msg.channel === currentChannel,
    );

    if (channelMessages.length === 0 && !messagesSignal.loading) {
      return `
        <div class="message-empty">
          <p>No messages in #${currentChannel} yet.</p>
          <p>Start the conversation!</p>
        </div>
      `;
    }

    // 返回占位符，实际渲染在 render() 钩子中完成
    return `<div class="messages-container" data-channel="${currentChannel}" data-version="${messagesSignal.version}"></div>`;
  }

  // 创建 Reef.js 组件
  const container = document.querySelector(containerSelector);
  if (!container) {
    throw new Error(`Container not found: ${containerSelector}`);
  }

  const messagesComponent = component(container, messagesTemplate, {
    signals: [SignalName || 'messagesSignal'],
  });

  // 监听 Reef.js 渲染完成事件，使用 createMessageElement 渲染消息
  let lastRenderedDateStr = null; // Track last rendered date for dividers

  listenReefRender((event) => {
    if (event.target !== container) return;

    const messagesContainer = container.querySelector('.messages-container');
    if (!messagesContainer) return;

    const currentChannel = getCurrentChannel();
    const channelMessages = messagesSignal.items.filter(
      (msg) => msg.channel === currentChannel,
    );

    // 清空容器（保留占位符属性）
    messagesContainer.innerHTML = '';
    lastRenderedDateStr = null; // Reset date tracker

    // 使用 createMessageElement 渲染每条消息，插入日期分隔线
    channelMessages.forEach((messageData) => {
      // Generate date string for this message
      const date = new Date(messageData.timestamp);
      const dateStr =
        date.getFullYear() +
        '-' +
        String(date.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(date.getDate()).padStart(2, '0');

      // Insert date divider if day changes
      if (lastRenderedDateStr !== dateStr) {
        lastRenderedDateStr = dateStr;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = dateStr;
        divider.style.textAlign = 'center';
        divider.style.color = '#aaa';
        divider.style.fontSize = '0.9em';
        divider.style.margin = '16px 0 8px 0';
        messagesContainer.appendChild(divider);
      }

      // Render message element
      const messageElement = createMessageElement(messageData, false, false);
      messagesContainer.appendChild(messageElement);
      updateTimeDisplayForMessage(messageElement);

      // Update thread info for reply messages
      if (messageData.replyTo && updateThreadInfo) {
        updateThreadInfo(messageData);
      }
    });

    console.log(
      `✅ Rendered ${channelMessages.length} messages using createMessageElement`,
    );
  });

  /**
   * Helper: 发送消息（写入 TinyBase）
   */
  function sendMessage(text, username, channel, options = {}) {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    tinybaseStore.setCell('messages', messageId, 'text', text);
    tinybaseStore.setCell('messages', messageId, 'username', username);
    tinybaseStore.setCell('messages', messageId, 'channel', channel);
    tinybaseStore.setCell('messages', messageId, 'timestamp', Date.now());

    if (options.encrypted) {
      tinybaseStore.setCell('messages', messageId, 'encrypted', true);
    }

    if (options.replyToId) {
      tinybaseStore.setCell(
        'messages',
        messageId,
        'replyToId',
        options.replyToId,
      );
    }

    console.log('📤 Message sent to TinyBase:', messageId);
    return messageId;
  }

  /**
   * Helper: 删除消息
   */
  function deleteMessage(messageId) {
    tinybaseStore.delRow('messages', messageId);
    console.log('🗑️ Message deleted from TinyBase:', messageId);
  }

  /**
   * Helper: 编辑消息
   */
  function editMessage(messageId, newText) {
    tinybaseStore.setCell('messages', messageId, 'text', newText);
    tinybaseStore.setCell('messages', messageId, 'editedAt', Date.now());
    console.log('✏️ Message edited in TinyBase:', messageId);
  }

  return {
    component: messagesComponent,
    signal: messagesSignal,
    sendMessage,
    deleteMessage,
    editMessage,
    syncNow: syncTinybaseToSignal,
  };
}

// Update time display based on whether this is the first message in a group
function updateTimeDisplayForMessage(messageElement) {
  const username = messageElement.getAttribute('data-username');
  const timestamp = messageElement.getAttribute('data-timestamp');
  const timeSpan = messageElement.querySelector('.msg-time-outside-actions');

  if (!timeSpan || !username || !timestamp) return;

  // Check if previous message is from the same user
  // Skip over date dividers and system messages
  let prevWrapper = messageElement.previousElementSibling;
  while (prevWrapper && !prevWrapper.classList.contains('message-wrapper')) {
    prevWrapper = prevWrapper.previousElementSibling;
  }

  let isFirstInGroup = true;

  if (prevWrapper && prevWrapper.classList.contains('message-wrapper')) {
    const prevUsername = prevWrapper.getAttribute('data-username');
    const prevTimestamp = prevWrapper.getAttribute('data-timestamp');

    // If same user and within 5 minutes, it's not the first in group
    if (prevUsername === username && prevTimestamp) {
      const timeDiff = Number(timestamp) - Number(prevTimestamp);
      if (timeDiff < 5 * 60 * 1000) {
        // 5 minutes
        isFirstInGroup = false;
      }
    }
  }

  // Update time display
  if (isFirstInGroup) {
    timeSpan.setAttribute('data-first-message', 'true');
  } else {
    timeSpan.removeAttribute('data-first-message');
  }
}
