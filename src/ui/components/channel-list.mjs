/**
 * Channel List Component - TinyBase + Reef.js
 *
 * Architecture:
 * TinyBase channels 表 → Signal → Reef Component → 渲染频道列表
 */

import { signal, component } from 'reefjs';
import { listenReefEvent } from '../utils/reef-helpers.mjs';
import { getCurrentChannel } from '../utils/chat-state.mjs';
import logger from '../../common/logger.mjs';

const SignalName = 'channelsSignal';

/**
 * Initialize channel list component
 * @param {Object} tinybaseStore - TinyBase store instance
 * @param {string} containerSelector - CSS selector for container element
 * @param {Function} onChannelClick - Callback when channel is clicked (channelName) => void
 * @returns {Object} Component instance and helper functions
 */
export function initChannelList(
  tinybaseStore,
  containerSelector,
  onChannelClick,
) {
  // Reef.js Signal - 响应式频道数据
  const channelsSignal = signal(
    {
      items: [], // 频道列表 [{channel, count, lastUsed}]
      loading: false,
      error: null,
      currentChannel: 'general', // 当前选中的频道
      unreadCounts: {}, // 未读消息计数 {channelName: count}
    },
    SignalName,
  );

  /**
   * Get hidden channels from localStorage
   */
  function getHiddenChannels() {
    try {
      const hidden = localStorage.getItem('hiddenChannels');
      return hidden ? JSON.parse(hidden) : [];
    } catch (error) {
      console.error('Failed to get hidden channels:', error);
      return [];
    }
  }

  /**
   * Sync TinyBase channels 表 → Signal
   */
  function syncTinybaseToSignal() {
    try {
      // Get channels from TinyBase using shared utility
      const channelsList = window.getChannelsFromStore
        ? window.getChannelsFromStore(tinybaseStore)
        : [];

      channelsSignal.items = channelsList;
      channelsSignal.error = null;

      logger.log('📊 Channels synced to Signal:', channelsList.length);
    } catch (error) {
      logger.error('Failed to sync channels to Signal:', error);
      channelsSignal.error = error.message;
    }
  }

  // 监听 TinyBase channels 表变化
  tinybaseStore.addTableListener('channels', () => {
    logger.debug('🔄 TinyBase channels table changed, syncing...');
    syncTinybaseToSignal();
  });

  // 初始同步
  syncTinybaseToSignal();

  /**
   * Template function - 频道列表渲染
   */
  function channelsTemplate() {
    if (channelsSignal.loading) {
      return '<div class="channel-loading">Loading channels...</div>';
    }

    if (channelsSignal.error) {
      return `<div class="channel-error">Error: ${channelsSignal.error}</div>`;
    }

    // Get hidden channels from localStorage
    const hiddenChannels = getHiddenChannels();

    // Filter out hidden channels AND DM channels (dm- prefix)
    const visibleChannels = channelsSignal.items.filter(
      (item) =>
        !hiddenChannels.includes(item.channel) &&
        !item.channel.toLowerCase().startsWith('dm-'),
    );

    if (visibleChannels.length === 0) {
      return '<div style="color:var(--text-muted);font-size:0.85em;padding:8px;text-align:center;">No channels yet</div>';
    }

    // Sort channels: 'general' at the top, others alphabetically (case-insensitive)
    const sortedChannels = [...visibleChannels].sort((a, b) => {
      const aIsGeneral = a.channel.toLowerCase() === 'general';
      const bIsGeneral = b.channel.toLowerCase() === 'general';

      // If one is 'general', it comes first
      if (aIsGeneral && !bIsGeneral) return -1;
      if (!aIsGeneral && bIsGeneral) return 1;

      // Both are general or neither is general, sort alphabetically
      return a.channel.localeCompare(b.channel, undefined, {
        sensitivity: 'base',
      });
    });

    const currentChannel = channelsSignal.currentChannel;

    return sortedChannels
      .map((item) => {
        const isActive = item.channel === currentChannel;
        const unreadCount = channelsSignal.unreadCounts[item.channel] || 0;
        const showUnreadBadge = unreadCount > 0 && !isActive;

        return `
        <div 
          class="channel-item ${isActive ? 'current' : ''}" 
          data-channel="${item.channel}"
          data-action="click-channel"
        >
          <span class="channel-icon"><i class="ri-hashtag"></i></span>
          <span class="channel-name">${item.channel}</span>
          ${showUnreadBadge ? `<span class="channel-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
        </div>
      `;
      })
      .join('');
  }

  // 创建 Reef.js 组件
  const container = document.querySelector(containerSelector);
  if (!container) {
    throw new Error(`Container not found: ${containerSelector}`);
  }

  const channelsComponent = component(container, channelsTemplate, {
    signals: [SignalName],
  });

  // Event delegation - 频道点击
  container.addEventListener('click', (event) => {
    const channelItem = event.target.closest(
      '.channel-item[data-action="click-channel"]',
    );
    if (channelItem) {
      event.preventDefault();
      const channelName = channelItem.dataset.channel;
      if (channelName && onChannelClick) {
        channelsSignal.currentChannel = channelName;
        onChannelClick(channelName);
      }
    }
  });

  // Event delegation - 右键菜单
  container.addEventListener('contextmenu', (event) => {
    const channelItem = event.target.closest('.channel-item');
    if (channelItem) {
      event.preventDefault();
      const channelName = channelItem.dataset.channel;
      if (channelName && window.showChannelContextMenu) {
        window.showChannelContextMenu(event, channelName);
      }
    }
  });

  /**
   * Helper: 添加或更新频道
   */
  function upsertChannel(channelName, count = 0) {
    const now = Date.now();
    tinybaseStore.setCell('channels', channelName, 'count', count);
    tinybaseStore.setCell('channels', channelName, 'lastUsed', now);
    logger.log(`📝 Channel upserted: ${channelName}`);
  }

  /**
   * Helper: 更新频道消息计数
   */
  function updateChannelCount(channelName, count) {
    tinybaseStore.setCell('channels', channelName, 'count', count);
    logger.log(`🔢 Channel count updated: ${channelName} = ${count}`);
  }

  /**
   * Helper: 增加频道消息计数
   */
  function incrementChannelCount(channelName) {
    const currentCount =
      tinybaseStore.getCell('channels', channelName, 'count') || 0;
    updateChannelCount(channelName, currentCount + 1);
  }

  /**
   * Helper: 更新频道最后使用时间
   */
  function touchChannel(channelName) {
    tinybaseStore.setCell('channels', channelName, 'lastUsed', Date.now());
  }

  /**
   * Helper: 删除频道
   */
  function deleteChannel(channelName) {
    if (channelName === 'general') {
      logger.warn('Cannot delete general channel');
      return;
    }
    tinybaseStore.delRow('channels', channelName);
    logger.log(`🗑️ Channel deleted: ${channelName}`);
  }

  /**
   * Helper: 设置当前频道
   */
  function setCurrentChannel(channelName) {
    channelsSignal.currentChannel = channelName;
  }

  /**
   * Helper: 设置频道未读计数
   */
  function setChannelUnreadCount(channelName, count) {
    const key = channelName.toLowerCase();
    if (count <= 0) {
      // 删除计数
      const newCounts = { ...channelsSignal.unreadCounts };
      delete newCounts[key];
      channelsSignal.unreadCounts = newCounts;
    } else {
      // 设置计数（触发 Reef.js 重新渲染）
      channelsSignal.unreadCounts = {
        ...channelsSignal.unreadCounts,
        [key]: count,
      };
    }
    logger.debug(`🔔 Channel unread count updated: ${channelName} = ${count}`);
  }

  /**
   * Helper: 获取频道未读计数
   */
  function getChannelUnreadCount(channelName) {
    return channelsSignal.unreadCounts[channelName.toLowerCase()] || 0;
  }

  /**
   * Helper: 清除频道未读计数
   */
  function clearChannelUnreadCount(channelName) {
    setChannelUnreadCount(channelName, 0);
  }

  /**
   * Helper: 增加频道未读计数
   */
  function incrementChannelUnreadCount(channelName) {
    const current = getChannelUnreadCount(channelName);
    setChannelUnreadCount(channelName, current + 1);
  }

  return {
    component: channelsComponent,
    signal: channelsSignal,
    upsertChannel,
    updateChannelCount,
    incrementChannelCount,
    touchChannel,
    deleteChannel,
    setCurrentChannel,
    syncNow: syncTinybaseToSignal,
    // Unread count management
    setChannelUnreadCount,
    getChannelUnreadCount,
    clearChannelUnreadCount,
    incrementChannelUnreadCount,
  };
}

export function whenChannelChange(callback) {
  let channel = getCurrentChannel();
  callback(channel);

  listenReefEvent(SignalName, () => {
    const newChannel = getCurrentChannel();
    if (channel === newChannel) return;
    callback(newChannel);
    channel = newChannel;
  });
}
