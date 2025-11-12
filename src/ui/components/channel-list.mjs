/**
 * Channel List Component - TinyBase + Reef.js
 *
 * Architecture:
 * TinyBase channels 表 → Signal → Reef Component → 渲染频道列表
 */

import { signal, component } from 'reefjs';

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
    },
    'channelsSignal',
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
   * Get unread count for a channel
   */
  function getChannelUnreadCount(channelName) {
    try {
      const key = `unread_${channelName}`;
      const count = localStorage.getItem(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Sync TinyBase channels 表 → Signal
   */
  function syncTinybaseToSignal() {
    try {
      const channelsTable = tinybaseStore.getTable('channels');

      // 转换为数组格式，按 lastUsed 排序（最近使用的在前）
      const channelsList = Object.entries(channelsTable || {})
        .map(([channelName, data]) => ({
          channel: channelName,
          count: data.count || 0,
          lastUsed: data.lastUsed || Date.now(),
        }))
        .sort((a, b) => b.lastUsed - a.lastUsed);

      // 确保 general 频道存在
      if (!channelsList.some((ch) => ch.channel === 'general')) {
        channelsList.push({
          channel: 'general',
          count: 0,
          lastUsed: Date.now(),
        });
      }

      channelsSignal.items = channelsList;
      channelsSignal.error = null;

      console.log('📊 Channels synced to Signal:', channelsList.length);
    } catch (error) {
      console.error('Failed to sync channels to Signal:', error);
      channelsSignal.error = error.message;
    }
  }

  // 监听 TinyBase channels 表变化
  tinybaseStore.addTableListener('channels', () => {
    console.log('🔄 TinyBase channels table changed, syncing...');
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

    // Sort channels: 'general' at the top, others by lastUsed descending
    const sortedChannels = [...visibleChannels].sort((a, b) => {
      const aIsGeneral = a.channel.toLowerCase() === 'general';
      const bIsGeneral = b.channel.toLowerCase() === 'general';

      // If one is 'general', it comes first
      if (aIsGeneral && !bIsGeneral) return -1;
      if (!aIsGeneral && bIsGeneral) return 1;

      // Both are general or neither is general, sort by lastUsed
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    });

    const currentChannel = channelsSignal.currentChannel;

    return sortedChannels
      .map((item) => {
        const isActive = item.channel === currentChannel;
        const unreadCount = getChannelUnreadCount(item.channel);
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
          <span class="channel-count">${item.count || 0}</span>
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
    signals: ['channelsSignal'],
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
    console.log(`📝 Channel upserted: ${channelName}`);
  }

  /**
   * Helper: 更新频道消息计数
   */
  function updateChannelCount(channelName, count) {
    tinybaseStore.setCell('channels', channelName, 'count', count);
    console.log(`🔢 Channel count updated: ${channelName} = ${count}`);
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
      console.warn('Cannot delete general channel');
      return;
    }
    tinybaseStore.delRow('channels', channelName);
    console.log(`🗑️ Channel deleted: ${channelName}`);
  }

  /**
   * Helper: 设置当前频道
   */
  function setCurrentChannel(channelName) {
    channelsSignal.currentChannel = channelName;
    touchChannel(channelName);
  }

  /**
   * Helper: 从服务器加载频道列表（初始化或刷新）
   */
  async function loadFromServer(api, roomname) {
    channelsSignal.loading = true;
    try {
      const data = await api.getChannels(roomname);
      const serverChannels = data.channels || [];

      // 批量写入 TinyBase
      serverChannels.forEach((ch) => {
        upsertChannel(ch.channel, ch.count);
      });

      console.log(`✅ Loaded ${serverChannels.length} channels from server`);
    } catch (error) {
      console.error('Failed to load channels from server:', error);
      channelsSignal.error = error.message;
    } finally {
      channelsSignal.loading = false;
    }
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
    loadFromServer,
    syncNow: syncTinybaseToSignal,
  };
}
