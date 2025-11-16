/**
 * Pinned Messages Panel Component (Reef.js)
 * Discord-style pinned messages viewer
 */

import { store, component } from 'reefjs';
import { decryptMessageText } from './utils/message-crypto.mjs';

const SignalName = 'pinnedState';

// Pinned messages state with actions
const pinnedState = store(
  {
    isOpen: false,
    messages: [], // Array of pinned message objects
    loading: false,
    error: null,
  },
  {
    // Action to open the panel
    open(state, showLoading = true) {
      state.isOpen = true;
      state.loading = showLoading;
      state.error = null;
    },
    // Action to close the panel
    close(state) {
      state.isOpen = false;
    },
    // Action to set loading state
    setLoading(state, isLoading) {
      state.loading = isLoading;
    },
    // Action to set error
    setError(state, error) {
      state.error = error;
      state.loading = false;
    },
    // Action to set messages
    setMessages(state, messages) {
      state.messages = messages;
      state.loading = false;
      state.error = null;
    },
    // Action to add a message
    addMessage(state, message) {
      state.messages.push(message);
    },
    // Action to remove a message
    removeMessage(state, messageId) {
      const index = state.messages.findIndex(
        (msg) => msg.messageId === messageId,
      );
      if (index !== -1) {
        state.messages.splice(index, 1);
      }
    },
  },
  SignalName,
);

// Template function for the pinned messages panel
function pinnedMessagesTemplate() {
  const state = pinnedState.value;
  console.log('Template called, state:', state);

  if (!state.isOpen) {
    return '';
  }

  const { messages, loading, error } = state;

  return `
    <div class="pinned-panel" data-reef-panel>
      <!-- Header -->
      <div class="pinned-panel-header">
        <div class="pinned-panel-title">
          <i class="ri-pushpin-fill"></i>
          <span>Pinned Messages</span>
        </div>
      </div>

        <!-- Content -->
        <div class="pinned-panel-content">
          ${
            loading
              ? `
            <div class="pinned-panel-loading">
              <i class="ri-loader-4-line ri-spin"></i>
              <p>Loading pinned messages...</p>
            </div>
          `
              : error
                ? `
            <div class="pinned-panel-error">
              <i class="ri-error-warning-line"></i>
              <p>${error}</p>
            </div>
          `
                : messages.length === 0
                  ? `
            <div class="pinned-panel-empty">
              <div class="pinned-empty-icon">
                <i class="ri-pushpin-2-line"></i>
              </div>
              <h3>This channel doesn't have any pinned messages... yet.</h3>
            </div>
          `
                  : `
            <div class="pinned-messages-list">
              ${messages
                .map(
                  (msg, index) => `
                <div class="pinned-message-item" data-message-id="${msg.messageId}">
                  <div class="pinned-message-content">
                    <div class="pinned-message-header">
                      <playful-avatar class="pinned-avatar" name="${msg.name}"></playful-avatar>
                      <div class="pinned-message-meta">
                        <span class="pinned-username">${msg.name}</span>
                        <span class="pinned-timestamp">${formatPinnedTimestamp(msg.timestamp)}</span>
                      </div>
                    </div>
                    <div class="pinned-message-body">
                      ${renderMessagePreview(msg.message)}
                    </div>
                  </div>
                  <div class="pinned-message-actions">
                    <button 
                      class="pinned-action-btn" 
                      data-reef-jump="${msg.messageId}"
                      title="Jump to message"
                    >
                      <i class="ri-chat-forward-line"></i>
                    </button>
                    <button 
                      class="pinned-action-btn pinned-action-unpin" 
                      data-reef-unpin="${msg.messageId}"
                      title="Unpin message"
                    >
                      <i class="ri-unpin-line"></i>
                    </button>
                  </div>
                </div>
                ${index < messages.length - 1 ? '<div class="pinned-message-divider"></div>' : ''}
              `,
                )
                .join('')}
            </div>
          `
          }
        </div>
      </div>
    </div>
  `;
}

// Helper: Format timestamp for pinned messages
function formatPinnedTimestamp(timestamp) {
  const date = new Date(Number(timestamp));
  const now = new Date();
  const diff = now - date;

  // Less than 1 minute
  if (diff < 60000) {
    return 'just now';
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }

  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  // Format as date
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Helper: Render message preview (handle FILE: messages, etc.)
function renderMessagePreview(message) {
  if (!message) return '<em>No content</em>';

  // Handle file messages
  if (message.startsWith('FILE:')) {
    const parts = message.substring(5).split('|');
    const fileName = parts[1] || 'file';
    const fileType = parts[2] || '';

    // Check if it's an image
    if (fileType.startsWith('image/')) {
      return `
        <div class="pinned-file-preview">
          <i class="ri-image-line"></i>
          <span>${escapeHtml(fileName)}</span>
        </div>
      `;
    }

    return `
      <div class="pinned-file-preview">
        <i class="ri-file-line"></i>
        <span>${escapeHtml(fileName)}</span>
      </div>
    `;
  }

  // Regular message - truncate if too long
  const maxLength = 200;
  const escaped = escapeHtml(message);
  if (escaped.length > maxLength) {
    return escaped.substring(0, maxLength) + '...';
  }
  return escaped;
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Create Reef component
let pinnedComponent = null;

// Initialize the pinned messages panel
export function initPinnedMessages(pinButtonSelector = '#btn-show-pins') {
  // Inject styles
  injectStyles();

  // Find the pin button
  const pinButton = document.querySelector(pinButtonSelector);
  if (!pinButton) {
    console.error('Pin button not found:', pinButtonSelector);
    return;
  }

  // Create container directly under body
  let container = document.querySelector('#pinned-messages-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pinned-messages-container';
    document.body.appendChild(container);
  }

  // Create Reef component
  pinnedComponent = component(container, pinnedMessagesTemplate, {
    signals: [SignalName],
  });

  // Setup event delegation for buttons
  container.addEventListener('click', handlePinnedPanelClick);

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (pinnedState.isOpen) {
      // Check if click is outside the panel and pin button
      if (!container.contains(e.target) && !pinButton.contains(e.target)) {
        closePinnedPanel();
      }
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinnedState.value.isOpen) {
      closePinnedPanel();
    }
  });
}

// Handle clicks within the pinned panel
function handlePinnedPanelClick(event) {
  const jumpBtn = event.target.closest('[data-reef-jump]');
  if (jumpBtn) {
    event.preventDefault();
    const messageId = jumpBtn.getAttribute('data-reef-jump');
    jumpToMessage(messageId);
    return;
  }

  const unpinBtn = event.target.closest('[data-reef-unpin]');
  if (unpinBtn) {
    event.preventDefault();
    const messageId = unpinBtn.getAttribute('data-reef-unpin');
    // Get current room and channel from global state
    const roomName = window.currentRoomName;
    const channelName = window.currentChannel || 'general';
    unpinMessage(roomName, channelName, messageId);
    return;
  }

  // Prevent clicks inside the panel from closing it
  if (event.target.closest('[data-reef-panel]')) {
    event.stopPropagation();
  }
}

// Open the pinned messages panel
export function openPinnedPanel(roomName, channelName) {
  console.log('Opening pinned panel for', roomName, channelName);

  // Check if we have cached data
  const hasCache = pinnedState.value.messages.length > 0;

  // Use actions to trigger reactive updates
  // Only show loading state if no cache
  pinnedState.open(!hasCache);

  console.log('State after update:', pinnedState.value);

  // Update button icon to filled
  updatePinButtonIcon(true);

  // Load pinned messages from TinyBase (silent reload if we have cache)
  loadPinnedMessages(roomName, channelName)
    .then((pins) => {
      pinnedState.setMessages(pins);
    })
    .catch((error) => {
      pinnedState.setError('加载置顶消息失败');
    });
}

// Close the pinned messages panel
export function closePinnedPanel() {
  pinnedState.close();

  // Update button icon to outline
  updatePinButtonIcon(false);
}

// Update the pin button icon based on panel state
function updatePinButtonIcon(isOpen) {
  const btnShowPins = document.getElementById('btn-show-pins');
  if (btnShowPins) {
    const icon = btnShowPins.querySelector('i');
    if (icon) {
      if (isOpen) {
        icon.className = 'ri-pushpin-fill';
        btnShowPins.classList.add('active');
      } else {
        icon.className = 'ri-pushpin-line';
        btnShowPins.classList.remove('active');
      }
    }
  }
}

// Toggle the pinned messages panel
export function togglePinnedPanel(roomName, channelName) {
  if (pinnedState.value.isOpen) {
    closePinnedPanel();
  } else {
    openPinnedPanel(roomName, channelName);
  }
}

// Load pinned messages from TinyBase
// Returns decrypted pins array for use by other components
export async function loadPinnedMessages(roomName, channelName) {
  try {
    if (!window.store) {
      console.error('[PinnedMessages] TinyBase store not initialized');
      return [];
    }

    const pinsTable = window.store.getTable('pins');

    // Filter pins for current channel
    const pins = [];
    Object.entries(pinsTable).forEach(([messageId, pinData]) => {
      if (pinData.channelName === channelName) {
        // Get message data from messages table using getCell
        const message = window.store.getCell('messages', messageId, 'text');
        const username = window.store.getCell(
          'messages',
          messageId,
          'username',
        );
        const timestamp = window.store.getCell(
          'messages',
          messageId,
          'timestamp',
        );

        if (message) {
          pins.push({
            messageId,
            message, // Encrypted message
            username,
            timestamp,
            pinnedAt: pinData.pinnedAt,
          });
        }
      }
    });

    // Sort by pin timestamp (most recent first)
    pins.sort((a, b) => b.pinnedAt - a.pinnedAt);

    // Decrypt messages
    const roomKey = window.encryptionState?.roomKey;
    const decryptedPins = await Promise.all(
      pins.map(async (pin) => {
        const decryptedMessage = await decryptMessageText(pin.message, roomKey);
        return {
          ...pin,
          message: decryptedMessage, // Replace with decrypted message for display
          name: pin.username, // Map username to name for display
        };
      }),
    );

    return decryptedPins;
  } catch (error) {
    console.error('Failed to load pinned messages:', error);
    throw error;
  }
} // Pin a message
/**
 * Pin a message
 */
export async function pinMessage(messageId, messageData) {
  try {
    const channelName = window.currentChannel;

    if (!window.store) {
      throw new Error('TinyBase store not initialized');
    }

    // Add to TinyBase pins table - only store messageId and metadata
    window.store.setRow('pins', messageId, {
      channelName,
      pinnedAt: Date.now(),
    });

    console.log('[PinnedMessages] Message pinned:', messageId);
  } catch (error) {
    console.error('[PinnedMessages] Failed to pin:', error);
    throw error;
  }
}

// Unpin a message
/**
 * Unpin a message
 */
export async function unpinMessage(messageId) {
  try {
    if (!window.store) {
      throw new Error('TinyBase store not initialized');
    }

    // Remove from TinyBase pins table
    window.store.delRow('pins', messageId);

    console.log('[PinnedMessages] Message unpinned:', messageId);
  } catch (error) {
    console.error('[PinnedMessages] Failed to unpin:', error);
    throw error;
  }
}

// Jump to a message in the main chat
function jumpToMessage(messageId) {
  closePinnedPanel();

  // Find the message in the main chat
  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`,
  );

  if (messageElement) {
    // Scroll to it
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight it
    messageElement.style.background = 'var(--background-alt)';
    messageElement.style.transition = 'background 0.3s ease';

    setTimeout(() => {
      messageElement.style.background = '';
    }, 2000);
  } else {
    console.log('Message not found in current view');
    // TODO: Could load the channel if message is in a different channel
  }
}

// Get pinned message count for a channel (from state)
export function getPinnedCount() {
  return pinnedState.value.messages.length;
}

/**
 * Initialize listener for TinyBase pin changes
 * This should be called after TinyBase store is initialized
 */
export async function initPinListener() {
  if (!window.store) {
    console.error('[PinnedMessages] Cannot init listener: store not ready');
    return;
  }

  // Listen to pins table changes
  window.store.addTableListener('pins', () => {
    // Only reload if panel is open
    if (pinnedState.value.isOpen) {
      const roomName = window.currentRoomName;
      const channelName = window.currentChannel || 'general';
      loadPinnedMessages(roomName, channelName)
        .then((pins) => {
          pinnedState.setMessages(pins);
        })
        .catch((error) => {
          console.error('[PinnedMessages] Failed to reload pins:', error);
        });
    }
  });

  console.log('[PinnedMessages] TinyBase listener initialized');
}

// Inject CSS styles
function injectStyles() {
  if (document.querySelector('#pinned-messages-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'pinned-messages-styles';
  style.textContent = /* css */ `
    /* Container positioning - fixed to viewport */
    #pinned-messages-container {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1001;
      pointer-events: none;
    }

    #pinned-messages-container > * {
      pointer-events: auto;
    }

    /* Pinned Panel Container - Discord-style popover dropdown */
    .pinned-panel {
      position: fixed;
      top: calc(var(--header-height) + 10px);
      right: 120px;
      width: 420px;
      max-width: 90vw;
      max-height: 85vh;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
      animation: slideDown 0.15s ease;
      z-index: 1001;
    }

    @keyframes slideDown {
      from { 
        opacity: 0;
        transform: translateY(-10px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Header */
    .pinned-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .pinned-panel-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 1.1em;
      font-weight: 600;
      color: var(--text-main);
    }

    .pinned-panel-title i {
      font-size: 1.2em;
      color: var(--links);
    }

    /* Content Area */
    .pinned-panel-content {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing);
    }

    /* Loading State */
    .pinned-panel-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3em;
      color: var(--text-muted);
    }

    .pinned-panel-loading i {
      font-size: 2em;
      margin-bottom: var(--spacing);
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Error State */
    .pinned-panel-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3em;
      color: #dc3545;
    }

    .pinned-panel-error i {
      font-size: 2em;
      margin-bottom: var(--spacing);
    }

    /* Empty State */
    .pinned-panel-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3em 2em;
      text-align: center;
      color: var(--text-muted);
    }

    .pinned-empty-icon {
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--background-alt);
      border-radius: 50%;
      margin-bottom: var(--spacing);
    }

    .pinned-empty-icon i {
      font-size: 2.5em;
      color: var(--text-muted);
      opacity: 0.5;
    }

    .pinned-panel-empty h3 {
      margin: var(--spacing) 0;
      font-size: 1.1em;
      color: var(--text-main);
    }

    /* Messages List */
    .pinned-messages-list {
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 100%;
    }

    /* Message Item */
    .pinned-message-item {
      display: flex;
      gap: var(--spacing-sm);
      padding: var(--spacing);
      transition: var(--transition);
      width: 100%;
      box-sizing: border-box;
    }

    .pinned-message-item:hover {
      background: var(--background-alt);
    }

    .pinned-message-content {
      flex: 1;
      min-width: 0;
    }

    .pinned-message-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-xs);
    }

    .pinned-avatar {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
    }

    .pinned-avatar::part(svg) {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }

    .pinned-message-meta {
      display: flex;
      align-items: baseline;
      gap: var(--spacing-sm);
    }

    .pinned-username {
      font-weight: 600;
      color: var(--text-main);
      font-size: 0.95em;
    }

    .pinned-timestamp {
      font-size: 0.8em;
      color: var(--text-muted);
    }

    .pinned-message-body {
      color: var(--text-main);
      font-size: 0.9em;
      line-height: 1.4;
      word-wrap: break-word;
    }

    .pinned-file-preview {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      color: var(--links);
      font-style: italic;
    }

    .pinned-file-preview i {
      font-size: 1.2em;
    }

    /* Message Actions */
    .pinned-message-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
      flex-shrink: 0;
    }

    .pinned-action-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: var(--transition);
      color: var(--text-muted);
      font-size: 1.2em;
    }

    .pinned-action-btn:hover {
      background: var(--background-body);
      color: var(--text-main);
    }

    .pinned-action-unpin:hover {
      color: #dc3545;
      background: rgba(220, 53, 69, 0.1);
    }

    /* Message Divider */
    .pinned-message-divider {
      height: 1px;
      background: var(--border);
      margin: 0 var(--spacing);
    }

    /* Mobile Responsive */
    @media (max-width: 600px) {
      #pinned-messages-container {
        position: fixed;
        top: var(--mobile-nav-bar-height);
        right: 0;
        left: 0;
        bottom: 0;
      }

      .pinned-panel {
        position: fixed;
        top: var(--mobile-nav-bar-height);
        right: 0;
        left: 0;
        bottom: 0;
        width: 100%;
        max-width: 100%;
        max-height: none;
        border-radius: 0;
      }

      .pinned-message-actions {
        flex-direction: row;
      }
    }

    /* Remix Icon spin helper */
    .ri-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

  document.head.appendChild(style);
}

// Export the state for external use
export { pinnedState };
