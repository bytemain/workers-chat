/**
 * Message List Component - TinyBase + Reef.js
 *
 * Architecture:
 * TinyBase (数据源) → Signal (响应式) → Reef Component (自动渲染)
 *
 * NOTE: 使用 message-element Web Component 通过 setData() 方法传递数据
 * 避免了属性编码/解码和双数据源同步的复杂性
 */

import { signal, component } from 'reefjs';
import { throttle } from '../../common/utils.mjs';
import { listenReefEvent } from '../utils/reef-helpers.mjs';
import logger from '../../common/logger.mjs';
import { tryDecryptMessage } from '../utils/message-crypto.mjs';
import CryptoUtils from '../../common/crypto-utils.js';
import { markChannelAsRead, getUnreadCount } from '../tinybase/read-status.mjs';
import { forEach } from '../react/flow.mjs';
import { IndexesIds } from '../tinybase/index.mjs';
import { getCurrentChannel } from '../utils/chat-state.mjs';
import { whenChannelChange } from './channel-list.mjs';
import { Disposable, MutableDisposable } from '../../common/disposable.mjs';

/**
 * @typedef {Object} RawMessage
 * @property {string} messageId - Unique message identifier
 * @property {string} name - Username of the message author
 * @property {string} message - Message text content (may be encrypted)
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {string} channel - Channel name where the message was sent
 * @property {string|null} replyToId - ID of the message being replied to, if any
 * @property {number|null} editedAt - Unix timestamp of last edit, if edited
 * @property {boolean} encrypted - Whether the message content is encrypted
 */

const SignalName = 'messagesSignal';
const tableId = 'messages';

/**
 * Initialize message list component
 * @param {import('tinybase').Store} tinybaseStore - TinyBase store instance
 * @param {import('tinybase').Indexes} tinybaseIndexes - TinyBase indexes instance for O(log n) filtering
 * @param {string} containerSelector - CSS selector for container element
 * @param {Object} encryptionContext - Encryption context { currentRoomKey, isRoomEncrypted }
 * @param {Map} messagesCache - Global messages cache for legacy features (threads, etc.)
 * @param {Object} readStatusStore - TinyBase store for read status tracking
 * @param {string} roomName - Current room name
 * @param {Object} channelList - Channel list component instance (for unread count updates)
 * @returns {Object} Component instance and helper functions
 */
export function initMessageList(
  tinybaseStore,
  tinybaseIndexes,
  containerSelector,
  encryptionContext,
  messagesCache,
  readStatusStore,
  roomName,
  channelList,
) {
  // Reef.js Signal - 响应式消息数据

  const messagesSignal = signal(
    {
      /** @type {RawMessage[]} */
      items: [], // 消息列表（来自 TinyBase）
      tempItems: [], // 临时消息列表（仅本地，不同步）
      loading: false, // 加载状态
      error: null, // 错误信息
      version: 0, // 版本号，用于强制重新渲染
    },
    SignalName,
  );

  // Track if user is at bottom of scroll (for auto-scroll behavior)
  let isAtBottom = true;
  let isInitialLoad = true;

  /**
   * Sync TinyBase → Signal
   * 监听 TinyBase 的 messages 表变化，自动更新 Signal
   * 包含解密、replyTo 预览生成等完整逻辑
   */
  async function syncTinybaseToSignalInternal() {
    try {
      const currentChannel = getCurrentChannel();
      logger.debug(
        `🚀 ~ syncTinybaseToSignalInternal ~ currentChannel:`,
        currentChannel,
      );

      // ✅ Use index for O(log n) query - much faster than O(n) filter!
      // Get message IDs for current channel from pre-built index
      const messageIds = tinybaseIndexes.getSliceRowIds(
        IndexesIds.MessagesByChannel,
        currentChannel,
      );

      logger.log(
        `📇 Index query: found ${messageIds.length} messages in #${currentChannel}`,
      );

      // Convert to message objects (原始加密数据)
      /** @type {RawMessage[]} */
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
            tableId,
            msg.replyToId,
            'text',
          );
          const parentUsername = tinybaseStore.getCell(
            tableId,
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
          ...msg,
          message: decryptedMessage, // 覆盖：已解密的消息
          replyTo: replyTo, // 覆盖：已处理预览的 replyTo
        };
      });

      // 等待所有解密完成
      const messagesList = await Promise.all(decryptionPromises);

      // 缓存消息到全局 messagesCache（用于线程等遗留功能）
      messagesList.forEach((msg) => {
        messagesCache.set(msg.messageId, msg);
      });

      // Update unread counts using read status store
      if (readStatusStore && roomName && channelList) {
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

          // Update channel list's unread count
          channelList.setChannelUnreadCount(channel, unreadCount);
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
          logger.log(
            `✅ Marked ${currentChannelMessages.length} messages in #${currentChannel} as read`,
          );
        }
      }

      // 更新 Signal（触发 Reef.js 重新渲染）
      messagesSignal.items = messagesList;
      messagesSignal.error = null;
      messagesSignal.version++; // 增加版本号，强制重新渲染

      logger.log(
        '📊 Messages synced to Signal (decrypted):',
        messagesList.length,
      );
    } catch (error) {
      logger.error('Failed to sync TinyBase to Signal:', error);
      messagesSignal.error = error.message;
    }
  }

  const syncTinybaseToSignal = throttle(syncTinybaseToSignalInternal, 16);

  const mutableDisposable = new MutableDisposable();
  whenChannelChange((channel) => {
    console.log(`🚀 ~ initMessageList ~ channel:`, channel);
    const disposable = mutableDisposable.create();
    // Reset to scroll to bottom when switching channels
    isInitialLoad = true;

    if (channel.startsWith('dm-')) {
      logger.debug(`🔄 Channel changed to DM: ${channel}, skipping listener`);
      return;
    }

    const id = tinybaseIndexes.addSliceRowIdsListener(
      IndexesIds.MessagesByChannel,
      channel,
      (indexes, indexId, sliceId) => {
        logger.debug(
          `🔄 MessagesByChannel index changed for slice: ${sliceId}`,
        );
        syncTinybaseToSignal();
      },
    );

    disposable.add({
      dispose: () => {
        tinybaseIndexes.delListener(id);
      },
    });

    syncTinybaseToSignal();
  });

  // 监听单个 row 的变化
  tinybaseStore.addRowListener(
    tableId,
    null, // null = listen to all rows
    async (store, tableId, rowId, getCellChange) => {
      const cellChange = getCellChange();
      logger.debug(
        `🔄 TinyBase message row changed: ${rowId}, changes:`,
        cellChange,
      );

      // 只更新对应的消息元素，不触发全量重绘
      const messageElement = document.querySelector(
        `message-element[data-message-id="${rowId}"]`,
      );

      if (messageElement) {
        // 从 TinyBase 读取最新数据
        const row = store.getRow(tableId, rowId);

        // 解密消息（如果需要）
        const decryptedMessage = await tryDecryptMessage(
          { message: row.text || '' },
          encryptionContext.currentRoomKey,
          encryptionContext.isRoomEncrypted,
        );

        // 直接用 setData 更新，触发 message-element 内部的 Reef.js 重新渲染
        messageElement.setData({
          messageId: rowId,
          name: row.username || 'Anonymous',
          message: decryptedMessage,
          timestamp: row.timestamp || Date.now(),
          channel: row.channel || 'general',
          replyToId: row.replyToId || null,
          editedAt: row.editedAt || null,
          encrypted: CryptoUtils.isEncrypted(row.text || ''),
        });

        logger.log(`✅ Updated message element for row: ${rowId}`);
      }
    },
  );

  if (!getCurrentChannel().startsWith('dm-')) {
    syncTinybaseToSignal();
  }

  // 手动管理 message-element 的创建和更新（避免 outerHTML 导致失去响应性）
  function renderMessages() {
    const currentChannel = getCurrentChannel();
    const container = document.querySelector(containerSelector);
    if (!container) return;

    // 错误状态
    if (messagesSignal.error) {
      container.innerHTML = `<div class="message-error">Error: ${messagesSignal.error}</div>`;
      return;
    }

    // 过滤当前频道的消息
    const channelMessages = messagesSignal.items;

    // 追加临时消息（仅本地，不同步）
    const tempChannelMessages = messagesSignal.tempItems;
    const allMessages = [...channelMessages, ...tempChannelMessages];

    // 空状态
    if (allMessages.length === 0 && !messagesSignal.loading) {
      container.innerHTML = `
        <div class="message-empty">
          <p>No messages in #${currentChannel} yet.</p>
          <p>Start the conversation!</p>
        </div>
      `;
      return;
    }

    // 创建或更新 messages-container
    let messagesContainer = container.querySelector('.messages-container');
    if (!messagesContainer) {
      messagesContainer = document.createElement('div');
      messagesContainer.className = 'messages-container';
      container.innerHTML = '';
      container.appendChild(messagesContainer);
    }
    messagesContainer.setAttribute('data-channel', currentChannel);
    messagesContainer.setAttribute('data-version', messagesSignal.version);

    // 获取现有的 message-element 元素（用于复用）
    const existingElements = new Map();
    messagesContainer.querySelectorAll('message-element').forEach((el) => {
      const messageId = el.getAttribute('data-message-id');
      if (messageId) {
        existingElements.set(messageId, el);
      }
    });

    // 创建新的 DocumentFragment（提高性能）
    const fragment = document.createDocumentFragment();

    // 遍历消息，创建或复用 message-element
    allMessages.forEach((item, index) => {
      let msgEl = existingElements.get(item.messageId);

      // 检查是否是同一用户组的第一条消息（用于头像显示）
      let isFirstInGroup = true;
      if (index > 0) {
        const prevItem = allMessages[index - 1];
        // 如果同一用户且时间间隔小于 5 分钟，则不是第一条
        if (prevItem.name === item.name) {
          const timeDiff = item.timestamp - prevItem.timestamp;
          if (timeDiff < 5 * 60 * 1000) {
            // 5 minutes
            isFirstInGroup = false;
          }
        }
      }

      if (msgEl) {
        // 复用现有元素，更新数据
        msgEl.setData({
          ...item,
          isInThread: false,
          isThreadOriginal: false,
          isFirstInGroup, // 传递分组信息
        });
        existingElements.delete(item.messageId); // 标记为已使用
      } else {
        // 创建新元素
        msgEl = document.createElement('message-element');
        msgEl.setAttribute('data-message-id', item.messageId); // 设置 key
        msgEl.setData({
          ...item,
          isInThread: false,
          isThreadOriginal: false,
          isFirstInGroup, // 传递分组信息
        });
      }

      fragment.appendChild(msgEl);
    });

    // 删除不再需要的元素
    existingElements.forEach((el) => {
      el.remove();
    });

    // 替换容器内容
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(fragment);

    logger.log(
      `✅ Rendered ${channelMessages.length} messages in #${currentChannel}`,
    );

    // Scroll to bottom if this is initial load or user was at bottom
    if (isInitialLoad || isAtBottom) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        logger.debug('📜 Scrolled to bottom');
      });

      // Reset initial load flag after first render
      if (isInitialLoad) {
        isInitialLoad = false;
      }
    }
  }

  listenReefEvent(SignalName, renderMessages);

  // 初始渲染
  const container = document.querySelector(containerSelector);
  if (!container) {
    throw new Error(`Container not found: ${containerSelector}`);
  }

  // Track scroll position to determine if user is at bottom
  container.addEventListener('scroll', () => {
    // Allow 1px tolerance for floating point calculation errors
    isAtBottom =
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - 1;
  });

  renderMessages();

  function sendMessage(text, username, channel, options = {}) {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const messageData = {
      text: text,
      username: username,
      channel: channel,
      timestamp: Date.now(),
    };

    if (options.encrypted) {
      messageData.encrypted = true;
    }

    if (options.replyToId) {
      messageData.replyToId = options.replyToId;
    }

    tinybaseStore.setRow('messages', messageId, messageData);

    logger.log('📤 Message sent to TinyBase:', messageId);
    return messageId;
  }

  /**
   * Helper: 删除消息
   */
  function deleteMessage(messageId) {
    tinybaseStore.delRow('messages', messageId);
    logger.log('🗑️ Message deleted from TinyBase:', messageId);
  }

  /**
   * Helper: 强制滚动到底部
   */
  function scrollToBottom() {
    isAtBottom = true;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      logger.debug('📜 Force scrolled to bottom');
    });
  }

  /**
   * Helper: 编辑消息
   */
  function editMessage(messageId, newText) {
    tinybaseStore.setCell('messages', messageId, 'text', newText);
    tinybaseStore.setCell('messages', messageId, 'editedAt', Date.now());
    logger.log('✏️ Message edited in TinyBase:', messageId);
  }

  /**
   * 添加临时消息（仅本地，不同步到 TinyBase）
   * 用于显示正在上传的文件等临时状态
   * @param {RawMessage} message - 临时消息对象
   * @returns {string} 临时消息 ID
   */
  function addTempMessage(message) {
    const tempId =
      message.messageId ||
      `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const tempMessage = {
      ...message,
      messageId: tempId,
      timestamp: message.timestamp || Date.now(),
      channel: message.channel || getCurrentChannel(),
      _isTemp: true, // 标记为临时消息
    };

    messagesSignal.tempItems = [...messagesSignal.tempItems, tempMessage];
    return tempId;
  }

  /**
   * 更新临时消息（例如更新上传进度）
   * @param {string} tempId - 临时消息 ID
   * @param {Partial<RawMessage>} updates - 要更新的字段
   */
  function updateTempMessage(tempId, updates) {
    const index = messagesSignal.tempItems.findIndex(
      (msg) => msg.messageId === tempId,
    );
    if (index === -1) {
      logger.warn('⚠️ Temp message not found:', tempId);
      return;
    }

    const updatedItems = [...messagesSignal.tempItems];
    updatedItems[index] = {
      ...updatedItems[index],
      ...updates,
    };
    messagesSignal.tempItems = updatedItems;
  }

  /**
   * 删除临时消息
   * @param {string} tempId - 临时消息 ID
   */
  function removeTempMessage(tempId) {
    messagesSignal.tempItems = messagesSignal.tempItems.filter(
      (msg) => msg.messageId !== tempId,
    );
    logger.log('🗑️ Temp message removed:', tempId);
  }

  /**
   * Helper: 设置 isAtBottom 状态（用于外部同步）
   */
  function setAtBottom(value) {
    isAtBottom = value;
  }

  /**
   * Helper: 获取当前 isAtBottom 状态
   */
  function getAtBottom() {
    return isAtBottom;
  }

  return {
    signal: messagesSignal,
    sendMessage,
    deleteMessage,
    editMessage,
    addTempMessage,
    updateTempMessage,
    removeTempMessage,
    syncNow: syncTinybaseToSignal,
    render: renderMessages, // 暴露渲染函数供外部使用
    scrollToBottom, // 强制滚动到底部
    setAtBottom, // 设置 isAtBottom 状态
    getAtBottom, // 获取 isAtBottom 状态
  };
}
