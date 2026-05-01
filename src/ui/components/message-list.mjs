/**
 * Message List Component - RxDB + Reef.js
 *
 * Architecture:
 * RxDB (数据源) → Signal (响应式) → Reef Component (自动渲染)
 *
 * NOTE: 使用 message-element Web Component 通过 setData() 方法传递数据
 * 避免了属性编码/解码和双数据源同步的复杂性
 */

import { signal, component } from 'reefjs';
import { throttle } from '../../common/utils.mjs';
import { listenReefEvent } from '../utils/reef-helpers.mjs';
import logger from '../../common/logger.mjs';
import { markChannelAsRead, getUnreadCount } from '../rxdb/read-status.mjs';
import { forEach } from '../react/flow.mjs';
import { getCurrentChannel } from '../utils/chat-state.mjs';
import { whenChannelChange } from './channel-list.mjs';
import { Disposable, MutableDisposable } from '../../common/disposable.mjs';
import { VirtualMessageList } from './virtual-message-list.mjs';

/**
 * @typedef {Object} RawMessage
 * @property {string} messageId - Unique message identifier
 * @property {string} name - Username of the message author
 * @property {string} message - Message text content
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {string} channel - Channel name where the message was sent
 * @property {string|null} replyToId - ID of the message being replied to, if any
 * @property {number|null} editedAt - Unix timestamp of last edit, if edited
 */

const SignalName = 'messagesSignal';
const tableId = 'messages';
const VIRTUAL_SCROLL_THRESHOLD = 200;
const VIRTUAL_OVERSCAN_ITEMS = 12;
const DEFAULT_MESSAGE_HEIGHT = 72;
const VIRTUAL_EDGE_ROOT_MARGIN_PX =
  DEFAULT_MESSAGE_HEIGHT * VIRTUAL_OVERSCAN_ITEMS;
// Smooth measured height changes so variable-size media messages don't cause scroll jumps.
const NEW_MEASUREMENT_WEIGHT = 0.2;

/**
 * Initialize message list component
 * @param {Object} tinybaseStore - RxDB compat store instance
 * @param {Object} tinybaseIndexes - Unused (kept for API compat)
 * @param {string} containerSelector - CSS selector for container element
 * @param {Map} messagesCache - Global messages cache for legacy features (threads, etc.)
 * @param {Object} readStatusStore - Store for read status tracking
 * @param {string} roomName - Current room name
 * @param {Object} channelList - Channel list component instance (for unread count updates)
 * @param {Object} [welcomeConfig] - Welcome messages configuration for empty state
 * @param {function} [welcomeConfig.getCurrentUsername] - Function that returns current username
 * @param {function} [welcomeConfig.getRoomDisplayName] - Function that returns display name for the room
 * @param {boolean} [welcomeConfig.isPrivateRoom] - Whether this is a private room
 * @returns {Object} Component instance and helper functions
 */
export function initMessageList(
  tinybaseStore,
  tinybaseIndexes,
  containerSelector,
  messagesCache,
  readStatusStore,
  roomName,
  channelList,
  welcomeConfig,
) {
  // Reef.js Signal - 响应式消息数据

  const messagesSignal = signal(
    {
      /** @type {RawMessage[]} */
      items: [], // 消息列表（来自 RxDB）
      tempItems: [], // 临时消息列表（仅本地，不同步）
      loading: false, // 加载状态
      error: null, // 错误信息
      version: 0, // 版本号，用于强制重新渲染
    },
    SignalName,
  );

  // VirtualMessageList - unified sorted collection for all message types
  const virtualList = new VirtualMessageList();

  // Track if user is at bottom of scroll (for auto-scroll behavior)
  let isAtBottom = true;
  let isInitialLoad = true;
  let edgeObserver = null;
  let measureFrame = null;
  let pendingScrollToMessageId = null;
  let scrollContainer = null;
  const virtualState = {
    range: { start: 0, end: 0, topHeight: 0, bottomHeight: 0 },
    heights: new Map(),
    averageHeight: DEFAULT_MESSAGE_HEIGHT,
  };

  function getVirtualKey(item) {
    return item?.messageId || `${item?.timestamp || 0}-${item?.name || ''}`;
  }

  function getEstimatedHeight(item) {
    return (
      virtualState.heights.get(getVirtualKey(item)) ||
      virtualState.averageHeight
    );
  }

  function calculateVirtualRange(items, container) {
    if (items.length <= VIRTUAL_SCROLL_THRESHOLD) {
      return {
        start: 0,
        end: items.length,
        topHeight: 0,
        bottomHeight: 0,
      };
    }

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight || window.innerHeight;
    const overscanPx = virtualState.averageHeight * VIRTUAL_OVERSCAN_ITEMS;
    const targetStart = Math.max(0, scrollTop - overscanPx);
    const targetEnd = scrollTop + viewportHeight + overscanPx;

    let offset = 0;
    let start = 0;

    while (
      start < items.length &&
      offset + getEstimatedHeight(items[start]) < targetStart
    ) {
      offset += getEstimatedHeight(items[start]);
      start++;
    }

    const topHeight = offset;
    let end = start;

    while (end < items.length && offset < targetEnd) {
      offset += getEstimatedHeight(items[end]);
      end++;
    }

    end = Math.min(items.length, Math.max(end, start + 1));

    let totalHeight = offset;
    for (let i = end; i < items.length; i++) {
      totalHeight += getEstimatedHeight(items[i]);
    }

    return {
      start,
      end,
      topHeight,
      bottomHeight: Math.max(0, totalHeight - offset),
    };
  }

  function rangesDiffer(a, b) {
    return (
      a.start !== b.start ||
      a.end !== b.end ||
      Math.abs(a.topHeight - b.topHeight) > 1 ||
      Math.abs(a.bottomHeight - b.bottomHeight) > 1
    );
  }

  const scheduleVirtualRender = throttle(() => {
    if (!scrollContainer) return;

    const items = virtualList.getItemsByChannel(getCurrentChannel());
    if (items.length <= VIRTUAL_SCROLL_THRESHOLD) return;

    const nextRange = calculateVirtualRange(items, scrollContainer);
    if (rangesDiffer(nextRange, virtualState.range)) {
      messagesSignal.version++;
    }
  }, 16);

  function setupEdgeObservers(messagesContainer) {
    if (edgeObserver) {
      edgeObserver.disconnect();
      edgeObserver = null;
    }

    if (!messagesContainer) return;
    if (!('IntersectionObserver' in window)) return;

    const topSentinel = messagesContainer.querySelector(
      '[data-virtual-edge="top"]',
    );
    const bottomSentinel = messagesContainer.querySelector(
      '[data-virtual-edge="bottom"]',
    );
    if (!topSentinel && !bottomSentinel) return;

    edgeObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          scheduleVirtualRender();
        }
      },
      {
        root: scrollContainer,
        rootMargin: `${VIRTUAL_EDGE_ROOT_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );

    if (topSentinel) edgeObserver.observe(topSentinel);
    if (bottomSentinel) edgeObserver.observe(bottomSentinel);
  }

  function measureRenderedItems(messagesContainer) {
    if (measureFrame) {
      cancelAnimationFrame(measureFrame);
    }

    measureFrame = requestAnimationFrame(() => {
      measureFrame = null;
      let changed = false;
      let measuredTotal = 0;
      let measuredCount = 0;

      Array.from(messagesContainer.children)
        .filter((element) => element.hasAttribute('data-message-id'))
        .forEach((element) => {
          const messageId = element.getAttribute('data-message-id');
          if (!messageId) return;

          const height = element.getBoundingClientRect().height;
          if (!height) return;

          measuredTotal += height;
          measuredCount++;

          const previous = virtualState.heights.get(messageId);
          if (!previous || Math.abs(previous - height) > 1) {
            virtualState.heights.set(messageId, height);
            changed = true;
          }
        });

      if (measuredCount > 0) {
        const measuredAverage = measuredTotal / measuredCount;
        // Weighted average favors the existing estimate and blends in a small
        // share of new measurements, reducing jumps when media changes row height.
        const nextAverage =
          virtualState.averageHeight * (1 - NEW_MEASUREMENT_WEIGHT) +
          measuredAverage * NEW_MEASUREMENT_WEIGHT;
        if (Math.abs(nextAverage - virtualState.averageHeight) > 1) {
          virtualState.averageHeight = nextAverage;
          changed = true;
        }
      }

      if (changed) {
        scheduleVirtualRender();
      }

      if (pendingScrollToMessageId) {
        const messageId = pendingScrollToMessageId;
        pendingScrollToMessageId = null;
        const messageElement = Array.from(messagesContainer.children).find(
          (element) => element.getAttribute('data-message-id') === messageId,
        );
        if (messageElement) {
          messageElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          messageElement.style.background = '#fff3cd';
          messageElement.style.transition = 'background 0.3s ease';
          setTimeout(() => {
            messageElement.style.background = '';
          }, 2000);
        }
      }
    });
  }

  /**
   * Sync RxDB → Signal
   * 读取 RxDB 的 messages 表，按 channel 过滤，自动更新 Signal
   */
  async function syncTinybaseToSignalInternal() {
    try {
      const currentChannel = getCurrentChannel();
      logger.debug(
        `🚀 ~ syncTinybaseToSignalInternal ~ currentChannel:`,
        currentChannel,
      );

      // Get all messages for this channel from compat store
      const messagesTable = tinybaseStore.getTable('messages');
      const messageEntries = Object.entries(messagesTable || {});

      // Filter by channel
      const channelMessages = messageEntries.filter(
        ([, data]) =>
          (data.channel || 'general').toLowerCase() ===
          currentChannel.toLowerCase(),
      );

      logger.log(
        `📇 Query: found ${channelMessages.length} messages in #${currentChannel}`,
      );

      // Convert to message objects and sort by timestamp
      /** @type {RawMessage[]} */
      const rawMessagesList = channelMessages
        .map(([messageId, row]) => ({
          messageId: messageId,
          name: row.username || 'Anonymous',
          message: row.text || '',
          timestamp: row.timestamp || Date.now(),
          channel: row.channel || 'general',
          replyToId: row.replyToId || null,
          editedAt: row.editedAt || null,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      // Process replyTo previews
      const messagePromises = rawMessagesList.map(async (msg) => {
        // 处理 replyTo - 需要从 RxDB 获取父消息
        let replyTo = null;
        if (msg.replyToId) {
          // 从 store 获取父消息
          const parentRow = tinybaseStore.getRow(tableId, msg.replyToId);
          const parentData = parentRow?.text;
          const parentUsername = parentRow?.username;

          if (parentData) {
            // 生成预览（前 50 个字符）
            let preview = parentData;
            if (preview.startsWith('FILE:')) {
              const parts = preview.substring(5).split('|');
              preview = parts[1] || 'File'; // 使用文件名作为预览
            }
            preview = preview.substring(0, 50);
            if (parentData.length > 50) {
              preview += '...';
            }

            replyTo = {
              messageId: msg.replyToId,
              username: parentUsername || 'Anonymous',
              preview: preview,
              message: parentData,
            };
          }
        }

        return {
          ...msg,
          replyTo: replyTo,
        };
      });

      // 等待所有处理完成
      const messagesList = await Promise.all(messagePromises);

      // 缓存消息到全局 messagesCache（用于线程等遗留功能）
      messagesList.forEach((msg) => {
        messagesCache.set(msg.messageId, msg);
      });

      // Update unread counts using read status store
      if (readStatusStore && roomName && channelList) {
        // Get all messages from RxDB
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

      // Sync regular items into VirtualMessageList
      virtualList.setRegularItems(messagesList);

      messagesSignal.version++; // 增加版本号，强制重新渲染

      logger.log('📊 Messages synced to Signal:', messagesList.length);
    } catch (error) {
      logger.error('Failed to sync RxDB to Signal:', error);
      messagesSignal.error = error.message;
    }
  }

  const syncRxdbToSignal = throttle(syncTinybaseToSignalInternal, 16);

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

    // Listen to messages table changes via compat store
    const id = tinybaseStore.addTableListener('messages', () => {
      logger.debug(
        `🔄 Messages table changed, syncing for channel: ${channel}`,
      );
      syncRxdbToSignal();
    });

    disposable.add({
      dispose: () => {
        tinybaseStore.delListener(id);
      },
    });

    syncRxdbToSignal();
  });

  // 监听单个 row 的变化
  tinybaseStore.addRowListener(
    tableId,
    null, // null = listen to all rows
    async (store, tableId, rowId, getCellChange) => {
      const cellChange = getCellChange();
      logger.debug(
        `🔄 RxDB message row changed: ${rowId}, changes:`,
        cellChange,
      );

      // 只更新对应的消息元素，不触发全量重绘
      const messageElement = document.querySelector(
        `message-element[data-message-id="${rowId}"]`,
      );

      if (messageElement) {
        // 从 RxDB 读取最新数据
        const row = store.getRow(tableId, rowId);

        // 直接用 setData 更新，触发 message-element 内部的 Reef.js 重新渲染
        messageElement.setData({
          messageId: rowId,
          name: row.username || 'Anonymous',
          message: row.text || '',
          timestamp: row.timestamp || Date.now(),
          channel: row.channel || 'general',
          replyToId: row.replyToId || null,
          editedAt: row.editedAt || null,
        });

        logger.log(`✅ Updated message element for row: ${rowId}`);
      }
    },
  );

  if (!getCurrentChannel().startsWith('dm-')) {
    syncRxdbToSignal();
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

    // Get all messages for current channel from VirtualMessageList (already sorted)
    const allMessages = virtualList.getItemsByChannel(currentChannel);

    // 空状态
    if (allMessages.length === 0 && !messagesSignal.loading) {
      let welcomeHtml = '';
      if (welcomeConfig) {
        const username = welcomeConfig.getCurrentUsername
          ? welcomeConfig.getCurrentUsername()
          : '';
        const lines = [];
        if (username) {
          lines.push(`Hello ${username}!`);
        }
        lines.push(
          'This is an app built with Cloudflare Workers Durable Objects. The source code ' +
            'can be found at: <a href="https://github.com/bytemain/workers-chat" target="_blank" rel="noopener noreferrer">https://github.com/bytemain/workers-chat</a>',
        );
        lines.push(
          'WARNING: Participants in this chat are random people on the internet. ' +
            'Names are not authenticated; anyone can pretend to be anyone. Chat history is saved.',
        );
        if (welcomeConfig.isPrivateRoom) {
          lines.push(
            'This is a private room. You can invite someone to the room by sending them the URL.',
          );
        } else {
          const roomDisplayName = welcomeConfig.getRoomDisplayName
            ? welcomeConfig.getRoomDisplayName()
            : '';
          if (roomDisplayName) {
            lines.push(`Welcome to ${roomDisplayName}. Say hi!`);
          }
        }
        welcomeHtml = lines
          .map(
            (line) =>
              `<p class="system-message" style="color: #888; font-style: italic;">* ${line}</p>`,
          )
          .join('');
      }
      container.innerHTML = `
        <div class="message-empty">
          ${welcomeHtml}
          <p>No messages in #${currentChannel} yet. Start the conversation!</p>
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

    const useVirtualScroll = allMessages.length > VIRTUAL_SCROLL_THRESHOLD;
    const virtualRange = useVirtualScroll
      ? calculateVirtualRange(allMessages, container)
      : {
          start: 0,
          end: allMessages.length,
          topHeight: 0,
          bottomHeight: 0,
        };
    virtualState.range = virtualRange;

    if (useVirtualScroll) {
      const topSpacer = document.createElement('div');
      topSpacer.className = 'virtual-scroll-spacer virtual-scroll-spacer-top';
      topSpacer.setAttribute('data-virtual-edge', 'top');
      topSpacer.style.height = `${virtualRange.topHeight}px`;
      fragment.appendChild(topSpacer);
    }

    // 遍历消息，创建或复用 message-element
    allMessages
      .slice(virtualRange.start, virtualRange.end)
      .forEach((item, relativeIndex) => {
        const index = virtualRange.start + relativeIndex;
        // Render system messages as <system-message> elements
        if (item._isSystem) {
          const p = document.createElement('p');
          p.className = 'system-message';
          p.setAttribute('data-message-id', item.messageId);
          const sysMsg = document.createElement('system-message');
          sysMsg.setAttribute('message', item.message);
          p.appendChild(sysMsg);
          fragment.appendChild(p);
          return;
        }

        let msgEl = existingElements.get(item.messageId);

        // 检查是否是同一用户组的第一条消息（用于头像显示）
        let isFirstInGroup = true;
        if (index > 0) {
          const prevItem = allMessages[index - 1];
          // 如果同一用户且时间间隔小于 5 分钟，则不是第一条
          if (prevItem.name === item.name && !prevItem._isSystem) {
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

    if (useVirtualScroll) {
      const bottomSpacer = document.createElement('div');
      bottomSpacer.className =
        'virtual-scroll-spacer virtual-scroll-spacer-bottom';
      bottomSpacer.setAttribute('data-virtual-edge', 'bottom');
      bottomSpacer.style.height = `${virtualRange.bottomHeight}px`;
      fragment.appendChild(bottomSpacer);
    }

    // 删除不再需要的元素
    existingElements.forEach((el) => {
      el.remove();
    });

    // 替换容器内容
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(fragment);
    measureRenderedItems(messagesContainer);
    setupEdgeObservers(useVirtualScroll ? messagesContainer : null);

    logger.log(
      `✅ Rendered ${useVirtualScroll ? `${virtualRange.end - virtualRange.start}/${allMessages.length}` : allMessages.length} messages in #${currentChannel}`,
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
  scrollContainer = container;

  // Track scroll position to determine if user is at bottom
  container.addEventListener('scroll', () => {
    // Allow 1px tolerance for floating point calculation errors
    isAtBottom =
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - 1;
    scheduleVirtualRender();
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

    if (options.replyToId) {
      messageData.replyToId = options.replyToId;
    }

    tinybaseStore.setRow('messages', messageId, messageData);

    logger.log('📤 Message sent to RxDB:', messageId);
    return messageId;
  }

  /**
   * Helper: 删除消息
   */
  function deleteMessage(messageId) {
    tinybaseStore.delRow('messages', messageId);
    logger.log('🗑️ Message deleted from RxDB:', messageId);
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

  function getCenteredScrollTop(scrollElement, offset, messageHeight) {
    if (!scrollElement) return 0;

    // Center the message vertically by moving to its top offset, subtracting
    // half the viewport height, then adding half the row height.
    return Math.max(
      0,
      offset - scrollElement.clientHeight / 2 + messageHeight / 2,
    );
  }

  function scrollToMessage(messageId) {
    if (!messageId || !container) {
      return false;
    }

    const currentChannel = getCurrentChannel();
    if (!currentChannel) {
      return false;
    }

    const allMessages = virtualList.getItemsByChannel(currentChannel);
    const index = allMessages.findIndex((item) => item.messageId === messageId);

    if (index === -1) {
      return false;
    }

    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += getEstimatedHeight(allMessages[i]);
    }

    pendingScrollToMessageId = messageId;
    requestAnimationFrame(() => {
      container.scrollTop = getCenteredScrollTop(
        container,
        offset,
        getEstimatedHeight(allMessages[index]),
      );
      messagesSignal.version++;
    });
    return true;
  }

  /**
   * Helper: 编辑消息
   */
  function editMessage(messageId, newText) {
    tinybaseStore.setCell('messages', messageId, 'text', newText);
    tinybaseStore.setCell('messages', messageId, 'editedAt', Date.now());
    logger.log('✏️ Message edited in RxDB:', messageId);
  }

  /**
   * 添加临时消息（仅本地，不同步到 RxDB）
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

    virtualList.addTempItem(tempMessage);
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

    virtualList.updateTempItem(tempId, updates);
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
    virtualList.removeItem(tempId);
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

  /**
   * Add a system message (join/quit/welcome) that renders inline with chat messages
   * @param {string} text - System message text
   */
  function addSystemMessage(text) {
    virtualList.addSystemMessage(text, getCurrentChannel());
    // Bump version to trigger re-render
    messagesSignal.version++;
  }

  return {
    signal: messagesSignal,
    virtualList,
    sendMessage,
    deleteMessage,
    editMessage,
    addTempMessage,
    updateTempMessage,
    removeTempMessage,
    addSystemMessage,
    syncNow: syncRxdbToSignal,
    render: renderMessages, // 暴露渲染函数供外部使用
    scrollToBottom, // 强制滚动到底部
    setAtBottom, // 设置 isAtBottom 状态
    getAtBottom, // 获取 isAtBottom 状态
    scrollToMessage, // 滚动到虚拟列表中的指定消息
  };
}
