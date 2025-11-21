/**
 * User Roster Component - Reef.js
 *
 * Architecture:
 * Signal (响应式用户列表) → Reef Component (自动渲染)
 *
 * Displays online users in the current room with automatic updates
 */

import { signal, component } from 'reefjs';
import { userState } from '../utils/user-state.mjs';
import { P2PChat } from './p2p-chat.mjs';
import logger from '../../common/logger.mjs';

const SignalName = 'userRosterSignal';

/**
 * Initialize user roster component
 * @param {string} containerSelector - CSS selector for container element
 * @param {Object} currentUser - Current user info { username }
 * @returns {Object} Component instance and helper functions
 */
export function initUserRoster(containerSelector) {
  // Reef.js Signal - 响应式用户列表
  const rosterSignal = signal(
    {
      /** @type {string[]} */
      users: [], // 在线用户列表
    },
    SignalName,
  );

  // Template function - 返回 HTML 字符串
  function rosterTemplate() {
    const { users } = rosterSignal;

    if (users.length === 0) {
      return '<div class="user-item-empty">No users online</div>';
    }

    // 生成用户列表 HTML
    return users
      .map((username) => {
        const isCurrentUser = username === userState.value.username;
        const displayName = username + (isCurrentUser ? ' (me)' : '');
        const userClass = isCurrentUser ? 'current-user' : 'other-user';

        return `
        <div class="user-item ${userClass}" data-username="${username}">
          <playful-avatar name="${username}" size="32" class="user-avatar"></playful-avatar>
          <span class="user-name">${displayName}</span>
          ${
            isCurrentUser
              ? `<button class="logout-btn" data-action="logout" title="Logout and change username">×</button>`
              : ''
          }
        </div>
      `;
      })
      .join('');
  }

  // 获取容器
  const container = document.querySelector(containerSelector);
  if (!container) {
    throw new Error(`Container not found: ${containerSelector}`);
  }

  // 创建 Reef.js Component
  const rosterComponent = component(container, rosterTemplate, {
    signals: [SignalName],
  });

  // Event delegation - 处理 logout 按钮点击
  container.addEventListener('click', (event) => {
    const logoutBtn = event.target.closest('[data-action="logout"]');
    if (logoutBtn) {
      event.stopPropagation();

      // 触发自定义事件，让外部处理 logout 逻辑
      const logoutEvent = new CustomEvent('roster:logout', {
        bubbles: true,
        detail: { username: userState.value.username },
      });
      container.dispatchEvent(logoutEvent);
    }
  });

  // Event delegation - Handle user item click (for P2P actions)
  container.addEventListener('click', (event) => {
    const userItem = event.target.closest('.user-item');
    console.log('User item clicked:1', userItem);

    // Ignore if clicking logout button or if it's the current user
    if (userItem && !event.target.closest('.logout-btn')) {
      const username = userItem.dataset.username;
      const currentUsername = userState.value.username;
      console.log('Click details:', { username, currentUsername });

      if (username && username !== currentUsername) {
        console.log('Showing context menu for:', username);
        showUserContextMenu(event, username);
      } else if (username === currentUsername) {
        console.log('Ignoring click: self');
        // Optional: Show a small tooltip or feedback
      } else {
        console.log('Ignoring click: invalid username');
      }
    }
  });

  function showUserContextMenu(event, username) {
    // Remove existing
    const existing = document.querySelector('.user-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'user-context-menu';
    menu.style.cssText = `
        visibility: hidden; /* Hide initially to calculate size */
    `;

    const actions = [
      {
        label: 'P2P 私聊',
        icon: 'ri-chat-private-line',
        onClick: async () => {
          if (window.webRTCManager) {
            window.webRTCManager.connect(username);
            await P2PChat.open(username);
          } else {
            alert('WebRTC Manager not initialized');
          }
        },
      },
      {
        label: '屏幕共享',
        icon: 'ri-computer-line',
        onClick: () => {
          if (window.webRTCManager) {
            // Connect first if needed, then share
            window.webRTCManager.connect(username).then(() => {
              // Small delay to ensure connection is ready
              setTimeout(
                () => window.webRTCManager.startScreenShare(username),
                1000,
              );
            });
          } else {
            alert('WebRTC Manager not initialized');
          }
        },
      },
    ];

    actions.forEach((action) => {
      const item = document.createElement('div');
      item.className = 'user-context-menu-item';
      item.innerHTML = `<i class="${action.icon}"></i> ${action.label}`;
      item.onclick = () => {
        action.onClick();
        menu.remove();
      };
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Position menu and handle overflow
    const rect = menu.getBoundingClientRect();
    let left = event.clientX;
    let top = event.clientY;

    // Adjust if off-screen
    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 10;
    }
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 10;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';

    // Close on click outside
    setTimeout(() => {
      document.addEventListener(
        'click',
        function closeMenu() {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        },
        { once: true },
      );
    }, 0);
  }

  /**
   * Add user to roster
   * @param {string} username - Username to add
   */
  function addUser(username) {
    // 防止重复添加
    if (rosterSignal.users.includes(username)) {
      logger.debug(`⚠️ User already in roster: ${username}`);
      return;
    }

    // 添加用户（触发 Reef.js 重新渲染）
    rosterSignal.users = [...rosterSignal.users, username];
    logger.log(`✅ User added to roster: ${username}`);
  }

  /**
   * Remove user from roster
   * @param {string} username - Username to remove
   */
  function removeUser(username) {
    // 移除用户（触发 Reef.js 重新渲染）
    rosterSignal.users = rosterSignal.users.filter((u) => u !== username);
    logger.log(`🗑️ User removed from roster: ${username}`);
  }

  /**
   * Clear all users from roster
   */
  function clearUsers() {
    rosterSignal.users = [];
    logger.log('🗑️ Roster cleared');
  }

  /**
   * Get current user list
   * @returns {string[]} Array of usernames
   */
  function getUsers() {
    return [...rosterSignal.users];
  }

  /**
   * Check if user is in roster
   * @param {string} username - Username to check
   * @returns {boolean} True if user is in roster
   */
  function hasUser(username) {
    return rosterSignal.users.includes(username);
  }

  return {
    signal: rosterSignal,
    component: rosterComponent,
    addUser,
    removeUser,
    clearUsers,
    getUsers,
    hasUser,
  };
}
