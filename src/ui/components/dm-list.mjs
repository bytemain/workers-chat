/**
 * DM Contact List Component (RxDB version)
 * Uses RxDB reactive queries for real-time updates
 */
import { signal, component } from 'reefjs';
import {
  getAllContactsQuery,
  removeContact,
  updateUnreadCount,
} from '../utils/p2p-database.mjs';
import { chatState } from '../utils/chat-state.mjs';
import { P2PChat } from './p2p-chat.mjs';

const SignalName = 'dmListSignal';

// State for DM list
const dmListState = signal(
  {
    contacts: [], // Array of { username, lastMessageTime, unreadCount }
    isLoading: true,
  },
  SignalName,
);

let contactsSubscription = null;

// Actions
export const DMList = {
  async init() {
    try {
      const query = await getAllContactsQuery();

      // Subscribe to reactive query
      contactsSubscription = query.$.subscribe((contacts) => {
        // Sort contacts by lastMessageTime in memory (descending)
        const sortedContacts = contacts
          .map((doc) => doc.toJSON())
          .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

        dmListState.contacts = sortedContacts;
        dmListState.isLoading = false;
      });
    } catch (error) {
      console.error('Failed to initialize DM list:', error);
      dmListState.isLoading = false;
    }
  },

  async clearUnread(username) {
    try {
      await updateUnreadCount(username, 0);
    } catch (error) {
      console.error('Failed to clear unread count:', error);
    }
  },

  async removeContact(username) {
    try {
      await removeContact(username);
    } catch (error) {
      console.error('Failed to remove contact:', error);
    }
  },

  getTotalUnread() {
    return dmListState.contacts.reduce(
      (sum, contact) => sum + (contact.unreadCount || 0),
      0,
    );
  },

  cleanup() {
    if (contactsSubscription) {
      contactsSubscription.unsubscribe();
      contactsSubscription = null;
    }
  },
};

// Template function
function template() {
  const { contacts, isLoading } = dmListState;

  if (isLoading) {
    return '<div class="dm-loading">Loading contacts...</div>';
  }

  if (contacts.length === 0) {
    return '<div class="dm-empty">No DM contacts yet. Click "P2P Connect" on a user to start chatting.</div>';
  }

  // Get current channel from chatState or channelsSignal
  const currentChannel =
    chatState?.channel || window.channelsSignal?.currentChannel || 'general';

  return contacts
    .map((contact) => {
      const dmChannel = `dm-${contact.username}`;
      const isActive = currentChannel === dmChannel;
      const showUnreadBadge = contact.unreadCount > 0 && !isActive;

      return `
    <div class="channel-item dm-item ${isActive ? 'current' : ''}" data-username="${contact.username}">
      <span class="channel-icon">
        <i class="ri-user-3-line"></i>
      </span>
      <span class="channel-name">${escapeHtml(contact.username)}</span>
      ${
        showUnreadBadge
          ? `<span class="channel-unread-badge">${contact.unreadCount > 99 ? '99+' : contact.unreadCount}</span>`
          : ''
      }
      <button class="dm-remove-btn" data-action="remove" data-username="${contact.username}" title="Remove contact">
        <i class="ri-close-line"></i>
      </button>
    </div>
  `;
    })
    .join('');
}

// Event handlers
function handleClick(event) {
  // Remove contact
  const removeBtn = event.target.closest('[data-action="remove"]');
  if (removeBtn) {
    event.stopPropagation();
    const username = removeBtn.dataset.username;
    if (confirm(`Remove ${username} from DM list?`)) {
      DMList.removeContact(username);
    }
    return;
  }

  // Open chat
  const dmItem = event.target.closest('.dm-item');
  if (dmItem) {
    const username = dmItem.dataset.username;
    P2PChat.open(username);
    DMList.clearUnread(username);
  }
}

// Helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize DM list component
 * @param {HTMLElement} container - Container element (e.g., #dm-list)
 */
export function initDMList(container) {
  if (!container) {
    console.error('DM list container not found');
    return;
  }

  // Create Reef component - listen to both dmListSignal and channelsSignal for reactivity
  component(container, template, { signals: [SignalName, 'channelsSignal'] });

  // Event delegation
  container.addEventListener('click', handleClick);

  // Load initial data
  DMList.init();
}

// Inject styles
const style = document.createElement('style');
style.textContent = `
  .dm-loading,
  .dm-empty {
    padding: 10px;
    color: #666;
    font-size: 13px;
    text-align: center;
  }

  .dm-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    margin: 1px 0;
    cursor: pointer;
    transition: background 0.15s;
  }

  .dm-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .dm-item .channel-icon {
    width: 20px;
    text-align: center;
    color: #666;
  }

  .dm-item .channel-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dm-unread-badge {
    background: #e74c3c;
    color: white;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: 600;
  }

  .dm-remove-btn {
    opacity: 0;
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    padding: 2px 4px;
    font-size: 16px;
    transition: opacity 0.15s, color 0.15s;
  }

  .dm-item:hover .dm-remove-btn {
    opacity: 1;
  }

  .dm-remove-btn:hover {
    color: #e74c3c;
  }
`;
document.head.appendChild(style);
