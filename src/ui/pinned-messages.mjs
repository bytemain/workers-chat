/**
 * Pinned Messages Panel Component (Reef.js)
 * Discord-style pinned messages viewer
 */

import {
  store,
  component,
} from 'https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js';

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
    open(state) {
      state.isOpen = true;
      state.loading = true;
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
        <button 
          class="pinned-panel-close" 
          data-reef-close
          title="Close"
        >
          <i class="ri-close-line"></i>
        </button>
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
              <p class="pinned-empty-tip">PROTIP:</p>
              <p>Pin important messages by right-clicking them and selecting "Pin Message".</p>
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
                  ${index < messages.length - 1 ? '<div class="pinned-message-divider"></div>' : ''}
                </div>
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

  // Wrap the pin button in a relative container if needed
  let wrapper = pinButton.parentElement;
  if (!wrapper.classList.contains('pinned-messages-wrapper')) {
    wrapper = document.createElement('div');
    wrapper.className = 'pinned-messages-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';

    // Wrap the pin button
    pinButton.parentElement.insertBefore(wrapper, pinButton);
    wrapper.appendChild(pinButton);
  }

  // Create container inside the wrapper
  let container = wrapper.querySelector('#pinned-messages-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pinned-messages-container';
    wrapper.appendChild(container);
  }

  // Create Reef component
  pinnedComponent = component(container, pinnedMessagesTemplate, {
    signals: [SignalName],
  });

  console.log('Reef component initialized');

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
  const target = event.target.closest('[data-reef-close]');
  if (target) {
    event.preventDefault();
    closePinnedPanel();
    return;
  }

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
    unpinMessage(messageId);
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

  // Use actions to trigger reactive updates
  pinnedState.open();

  console.log('State after update:', pinnedState.value);

  // Load pinned messages from server
  loadPinnedMessages(roomName, channelName);
}

// Close the pinned messages panel
export function closePinnedPanel() {
  pinnedState.close();
}

// Toggle the pinned messages panel
export function togglePinnedPanel(roomName, channelName) {
  if (pinnedState.value.isOpen) {
    closePinnedPanel();
  } else {
    openPinnedPanel(roomName, channelName);
  }
}

// Load pinned messages from server (placeholder - needs backend API)
async function loadPinnedMessages(roomName, channelName) {
  try {
    // TODO: Replace with actual API call
    // For now, use localStorage as a temporary storage
    const storageKey = `pinnedMessages:${roomName}:${channelName}`;
    const stored = localStorage.getItem(storageKey);
    const messages = stored ? JSON.parse(stored) : [];

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Use action to set messages
    pinnedState.setMessages(messages);
  } catch (error) {
    console.error('Failed to load pinned messages:', error);
    // Use action to set error
    pinnedState.setError('Failed to load pinned messages');
  }
}

// Pin a message
export function pinMessage(roomName, channelName, messageData) {
  const storageKey = `pinnedMessages:${roomName}:${channelName}`;
  const stored = localStorage.getItem(storageKey);
  const messages = stored ? JSON.parse(stored) : [];

  // Check if already pinned
  const exists = messages.some(
    (msg) => msg.messageId === messageData.messageId,
  );
  if (exists) {
    console.log('Message already pinned');
    return;
  }

  // Add to pinned messages (at the beginning)
  messages.unshift({
    messageId: messageData.messageId,
    name: messageData.name,
    message: messageData.message,
    timestamp: messageData.timestamp,
    channel: channelName,
    pinnedAt: Date.now(),
  });

  // Limit to 50 pinned messages per channel
  if (messages.length > 50) {
    messages.pop();
  }

  localStorage.setItem(storageKey, JSON.stringify(messages));

  // If panel is open, refresh using action
  if (pinnedState.isOpen) {
    pinnedState.addMessage({
      messageId: messageData.messageId,
      name: messageData.name,
      message: messageData.message,
      timestamp: messageData.timestamp,
      channel: channelName,
      pinnedAt: Date.now(),
    });
  }

  console.log('✅ Message pinned');
}

// Unpin a message
export function unpinMessage(messageId) {
  // Use action to remove message
  pinnedState.removeMessage(messageId);

  // Update localStorage
  // Extract room and channel from remaining messages
  if (pinnedState.messages.length > 0) {
    const sampleMsg = pinnedState.messages[0];
    // We need room and channel info - for now just log
    console.log('✅ Message unpinned');
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

// Get pinned message count for a channel
export function getPinnedCount(roomName, channelName) {
  const storageKey = `pinnedMessages:${roomName}:${channelName}`;
  const stored = localStorage.getItem(storageKey);
  const messages = stored ? JSON.parse(stored) : [];
  return messages.length;
}

// Inject CSS styles
function injectStyles() {
  if (document.querySelector('#pinned-messages-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'pinned-messages-styles';
  style.textContent = /* css */ `
    /* Wrapper for relative positioning */
    .pinned-messages-wrapper {
      position: relative;
      display: inline-block;
    }

    /* Container positioning */
    #pinned-messages-container {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 1001;
      pointer-events: none;
    }

    #pinned-messages-container > * {
      pointer-events: auto;
    }

    /* Pinned Panel Container - Discord-style popover dropdown */
    .pinned-panel {
      position: absolute;
      top: calc(100% + var(--header-height));
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

    .pinned-panel-close {
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
      font-size: 1.3em;
      color: var(--text-muted);
    }

    .pinned-panel-close:hover {
      background: var(--background-alt);
      color: var(--text-main);
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

    .pinned-empty-tip {
      color: #28a745;
      font-weight: 600;
      margin-top: var(--spacing);
      margin-bottom: var(--spacing-xs);
    }

    .pinned-panel-empty p:last-child {
      margin: 0;
      font-size: 0.9em;
    }

    /* Messages List */
    .pinned-messages-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    /* Message Item */
    .pinned-message-item {
      display: flex;
      gap: var(--spacing-sm);
      padding: var(--spacing);
      transition: var(--transition);
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
