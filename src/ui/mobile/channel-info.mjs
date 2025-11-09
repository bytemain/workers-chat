/**
 * Mobile Channel Info Panel Component (Reef.js)
 * Mobile-only view for channel details with tabs: Members, Pins, Threads, Links, Files
 */

import {
  store,
  component,
} from 'https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js';
import { api } from '../api.mjs';
import { syncUrlState } from '../utils/url-state-sync.mjs';

const SignalName = 'channelInfoState';

// Channel info state with actions
const channelInfoState = store(
  {
    isOpen: false,
    activeTab: 'members', // 'members', 'pins', 'threads', 'links', 'files'
    channelName: '',
    roomName: '',
    members: [],
    pins: [],
    threads: [],
    links: [],
    files: [],
    loading: false,
    error: null,
  },
  {
    // Action to open the panel
    open(state, roomName, channelName) {
      state.isOpen = true;
      state.roomName = roomName;
      state.channelName = channelName;
      state.activeTab = 'members';
      state.loading = false;
      state.error = null;
    },
    // Action to close the panel
    close(state) {
      state.isOpen = false;
    },
    // Action to switch tab
    switchTab(state, tabName) {
      state.activeTab = tabName;
    },
    // Action to set members
    setMembers(state, members) {
      state.members = members;
    },
    // Action to set pins
    setPins(state, pins) {
      state.pins = pins;
      state.loading = false;
    },
    // Action to set threads
    setThreads(state, threads) {
      state.threads = threads;
      state.loading = false;
    },
    // Action to set links
    setLinks(state, links) {
      state.links = links;
      state.loading = false;
    },
    // Action to set files
    setFiles(state, files) {
      state.files = files;
      state.loading = false;
    },
    // Action to set loading
    setLoading(state, isLoading) {
      state.loading = isLoading;
    },
    // Action to set error
    setError(state, error) {
      state.error = error;
      state.loading = false;
    },
    // Action: Update state from URL (used by syncUrlState)
    updateFromUrl(state, updates) {
      Object.assign(state, updates);
    },
  },
  SignalName,
);

// Template function for the channel info panel
function channelInfoTemplate() {
  const state = channelInfoState.value;

  if (!state.isOpen) {
    return '';
  }

  const {
    activeTab,
    channelName,
    members,
    pins,
    threads,
    links,
    files,
    loading,
    error,
  } = state;

  return `
    <div class="channel-info-page" data-reef-channel-info>
      <!-- Header with back button -->
      <div class="channel-info-header">
        <button class="channel-info-back" data-reef-back>
          <i class="ri-arrow-left-line"></i>
        </button>
        <h2 class="channel-info-title">#${channelName}</h2>
      </div>

      <!-- Tab Navigation -->
      <div class="channel-info-tabs">
        <button 
          class="channel-info-tab ${activeTab === 'members' ? 'active' : ''}" 
          data-reef-tab="members"
        >
          <i class="ri-group-line"></i>
          <span>Members</span>
        </button>
        <button 
          class="channel-info-tab ${activeTab === 'pins' ? 'active' : ''}" 
          data-reef-tab="pins"
        >
          <i class="ri-pushpin-line"></i>
          <span>Pins</span>
        </button>
        <button 
          class="channel-info-tab ${activeTab === 'threads' ? 'active' : ''}" 
          data-reef-tab="threads"
        >
          <i class="ri-chat-thread-line"></i>
          <span>Threads</span>
        </button>
        <button 
          class="channel-info-tab ${activeTab === 'links' ? 'active' : ''}" 
          data-reef-tab="links"
        >
          <i class="ri-link"></i>
          <span>Links</span>
        </button>
        <button 
          class="channel-info-tab ${activeTab === 'files' ? 'active' : ''}" 
          data-reef-tab="files"
        >
          <i class="ri-file-line"></i>
          <span>Files</span>
        </button>
      </div>

      <!-- Tab Content -->
      <div class="channel-info-content">
        ${renderTabContent(activeTab, { members, pins, threads, links, files, loading, error })}
      </div>
    </div>
  `;
}

// Render content for active tab
function renderTabContent(activeTab, data) {
  const { members, pins, threads, links, files, loading, error } = data;

  if (loading) {
    return `
      <div class="channel-info-loading">
        <i class="ri-loader-4-line ri-spin"></i>
        <p>Loading...</p>
      </div>
    `;
  }

  if (error) {
    return `
      <div class="channel-info-error">
        <i class="ri-error-warning-line"></i>
        <p>${error}</p>
      </div>
    `;
  }

  switch (activeTab) {
    case 'members':
      return renderMembersTab(members);
    case 'pins':
      return renderPinsTab(pins);
    case 'threads':
      return renderThreadsTab(threads);
    case 'links':
      return renderLinksTab(links);
    case 'files':
      return renderFilesTab(files);
    default:
      return '<p>Unknown tab</p>';
  }
}

// Render Members tab
function renderMembersTab(members) {
  if (members.length === 0) {
    return `
      <div class="channel-info-empty">
        <i class="ri-group-line"></i>
        <p>No members found</p>
      </div>
    `;
  }

  return `
    <div class="channel-info-list">
      ${members
        .map(
          (member) => `
        <div class="channel-info-item member-item">
          <playful-avatar class="member-avatar" name="${member.name}"></playful-avatar>
          <span class="member-name">${member.name}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// Render Pins tab
function renderPinsTab(pins) {
  if (pins.length === 0) {
    return `
      <div class="channel-info-empty">
        <i class="ri-pushpin-line"></i>
        <p>No pinned messages</p>
      </div>
    `;
  }

  return `
    <div class="channel-info-list">
      ${pins
        .map(
          (pin) => `
        <div class="channel-info-item pin-item" data-message-id="${pin.messageId}">
          <div class="pin-header">
            <playful-avatar class="pin-avatar" name="${pin.name}"></playful-avatar>
            <div class="pin-meta">
              <span class="pin-username">${pin.name}</span>
              <span class="pin-timestamp">${formatTimestamp(pin.timestamp)}</span>
            </div>
          </div>
          <div class="pin-message">${escapeHtml(pin.message)}</div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// Render Threads tab
function renderThreadsTab(threads) {
  if (threads.length === 0) {
    return `
      <div class="channel-info-empty">
        <i class="ri-chat-thread-line"></i>
        <p>No threads yet</p>
      </div>
    `;
  }

  return `
    <div class="channel-info-list">
      ${threads
        .map(
          (thread) => `
        <div class="channel-info-item thread-item">
          <div class="thread-preview">
            <strong>${thread.author}</strong>: ${escapeHtml(thread.preview)}
          </div>
          <div class="thread-stats">
            <span>${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}</span>
          </div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// Render Links tab
function renderLinksTab(links) {
  if (links.length === 0) {
    return `
      <div class="channel-info-empty">
        <i class="ri-link"></i>
        <p>No links shared yet</p>
      </div>
    `;
  }

  return `
    <div class="channel-info-list">
      ${links
        .map(
          (link) => `
        <div class="channel-info-item link-item">
          <a href="${link.url}" target="_blank" rel="noopener noreferrer">
            <i class="ri-external-link-line"></i>
            <span>${escapeHtml(link.url)}</span>
          </a>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// Render Files tab
function renderFilesTab(files) {
  if (files.length === 0) {
    return `
      <div class="channel-info-empty">
        <i class="ri-file-line"></i>
        <p>No files shared yet</p>
      </div>
    `;
  }

  return `
    <div class="channel-info-list">
      ${files
        .map(
          (file) => `
        <div class="channel-info-item file-item">
          <i class="ri-${getFileIcon(file.type)}"></i>
          <div class="file-info">
            <span class="file-name">${escapeHtml(file.name)}</span>
            <span class="file-meta">${file.size} • ${formatTimestamp(file.timestamp)}</span>
          </div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// Helper: Get file icon based on type
function getFileIcon(type) {
  if (type.startsWith('image/')) return 'image-line';
  if (type.startsWith('video/')) return 'video-line';
  if (type.startsWith('audio/')) return 'music-line';
  if (type.includes('pdf')) return 'file-pdf-line';
  if (type.includes('zip') || type.includes('rar')) return 'file-zip-line';
  return 'file-line';
}

// Helper: Format timestamp
function formatTimestamp(timestamp) {
  const date = new Date(Number(timestamp));
  const now = new Date();
  const diff = now - date;

  if (diff < 86400000) {
    // Less than 24 hours
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Create Reef component
let channelInfoComponent = null;
let urlStateSync = null;

// Initialize the channel info panel
export function initChannelInfo(containerSelector = 'body') {
  // Inject styles
  injectStyles();

  // Find or create container
  let container = document.querySelector('#channel-info-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'channel-info-container';
    document.querySelector(containerSelector).appendChild(container);
  }

  // Create Reef component
  channelInfoComponent = component(container, channelInfoTemplate, {
    signals: [SignalName],
  });

  console.log('Channel info component initialized');

  // Setup URL state sync
  urlStateSync = syncUrlState(channelInfoState, {
    // Signal name for this store
    signalName: SignalName,
    // Map state keys to URL params
    stateToUrl: {
      isOpen: 'info',
      activeTab: 'tab',
    },
    // Serialize: convert state to URL
    serialize: {
      isOpen: (value) => (value ? 'open' : null), // null = remove from URL
      activeTab: (value) => (value === 'members' ? null : value), // default tab not in URL
    },
    // Deserialize: convert URL to state
    deserialize: {
      isOpen: (value) => value === 'open',
      activeTab: (value) => value || 'members',
    },
    // Only sync when panel is open
    shouldSync: (state) => state.isOpen,
    // Use replaceState for tab changes (no history spam)
    pushState: false,
    // Custom popstate handler to load data
    onPopState: (event, store) => {
      const urlParams = new URLSearchParams(window.location.search);
      const shouldBeOpen = urlParams.get('info') === 'open';
      const urlTab = urlParams.get('tab') || 'members';
      const state = store.value;

      if (shouldBeOpen && !state.isOpen) {
        // Should be open but currently closed
        const room = window.currentRoomName || '';
        const channel = window.currentChannel || '';
        if (room && channel) {
          store.open(room, channel);
          store.switchTab(urlTab);
          loadTabData(urlTab, room, channel);
        }
      } else if (!shouldBeOpen && state.isOpen) {
        // Should be closed but currently open
        store.close();
      } else if (shouldBeOpen && state.isOpen && urlTab !== state.activeTab) {
        // Same state but different tab
        store.switchTab(urlTab);
        loadTabData(urlTab, state.roomName, state.channelName);
      }
    },
  });

  // Setup event delegation
  container.addEventListener('click', handleChannelInfoClick);

  // Initial load from URL (handled by syncUrlState automatically)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('info') === 'open') {
    const room = window.currentRoomName || '';
    const channel = window.currentChannel || '';
    const tab = urlParams.get('tab') || 'members';
    if (room && channel) {
      channelInfoState.open(room, channel);
      channelInfoState.switchTab(tab);
      loadTabData(tab, room, channel);
    }
  }
}

// Helper to load data for a specific tab
function loadTabData(tabName, roomName, channelName) {
  switch (tabName) {
    case 'members':
      loadMembersData();
      break;
    case 'pins':
      loadPinsData(roomName, channelName);
      break;
    case 'threads':
      loadThreadsData(roomName, channelName);
      break;
    case 'links':
      loadLinksData(roomName, channelName);
      break;
    case 'files':
      loadFilesData(roomName, channelName);
      break;
  }
}

// Handle clicks within the channel info panel
function handleChannelInfoClick(event) {
  // Handle back button
  const backBtn = event.target.closest('[data-reef-back]');
  if (backBtn) {
    event.preventDefault();
    closeChannelInfo();
    return;
  }

  // Handle tab switching
  const tabBtn = event.target.closest('[data-reef-tab]');
  if (tabBtn) {
    event.preventDefault();
    const tabName = tabBtn.getAttribute('data-reef-tab');
    switchTab(tabName);
    return;
  }

  // Handle pin item click - jump to message
  const pinItem = event.target.closest('.pin-item');
  if (pinItem) {
    event.preventDefault();
    const messageId = pinItem.getAttribute('data-message-id');
    if (messageId) {
      jumpToMessage(messageId);
    }
    return;
  }
}

// Jump to a specific message in the chat
function jumpToMessage(messageId) {
  // Close the channel info panel
  closeChannelInfo();

  // Wait a bit for the panel to close, then scroll to message
  setTimeout(() => {
    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`,
    );
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight the message briefly
      messageElement.classList.add('highlight-message');
      setTimeout(() => {
        messageElement.classList.remove('highlight-message');
      }, 2000);
    }
  }, 300);
}

// Open the channel info panel
export function openChannelInfo(roomName, channelName) {
  console.log('Opening channel info for', roomName, channelName);

  // Just update state - URL sync happens automatically
  channelInfoState.open(roomName, channelName);

  // Load initial data for members tab
  loadMembersData();
}

// Close the channel info panel
export function closeChannelInfo() {
  // Just update state - URL sync happens automatically
  channelInfoState.close();

  // Notify mobile UI to return to chat
  if (window.MobileUI && window.MobileUI.showChatPage) {
    window.MobileUI.showChatPage();
  }
}

// Switch tab
function switchTab(tabName) {
  // Just update state - URL sync happens automatically
  channelInfoState.switchTab(tabName);

  // Load data for the new tab
  const state = channelInfoState.value;
  switch (tabName) {
    case 'members':
      loadMembersData();
      break;
    case 'pins':
      loadPinsData(state.roomName, state.channelName);
      break;
    case 'threads':
      loadThreadsData(state.roomName, state.channelName);
      break;
    case 'links':
      loadLinksData(state.roomName, state.channelName);
      break;
    case 'files':
      loadFilesData(state.roomName, state.channelName);
      break;
  }
}

// Load members data
function loadMembersData() {
  // Get members from the roster
  const roster = document.getElementById('roster');
  if (roster) {
    const memberElements = roster.querySelectorAll('.user-item');
    const members = Array.from(memberElements).map((el) => {
      const nameSpan = el.querySelector('span');
      const name = nameSpan ? nameSpan.textContent.replace(' (me)', '') : '';
      return { name };
    });
    channelInfoState.setMembers(members);
  }
}

// Load pins data
async function loadPinsData(roomName, channelName) {
  channelInfoState.setLoading(true);
  try {
    const result = await api.getPinnedMessages(roomName, channelName);
    channelInfoState.setPins(result.pins || []);
  } catch (error) {
    console.error('Failed to load pins:', error);
    channelInfoState.setError('Failed to load pins');
  }
}

// Load threads data (placeholder)
async function loadThreadsData(roomName, channelName) {
  channelInfoState.setLoading(true);
  // TODO: Implement threads API
  setTimeout(() => {
    channelInfoState.setThreads([]);
  }, 500);
}

// Load links data (placeholder)
async function loadLinksData(roomName, channelName) {
  channelInfoState.setLoading(true);
  // TODO: Extract links from messages
  setTimeout(() => {
    channelInfoState.setLinks([]);
  }, 500);
}

// Load files data (placeholder)
async function loadFilesData(roomName, channelName) {
  channelInfoState.setLoading(true);
  // TODO: Load file messages
  setTimeout(() => {
    channelInfoState.setFiles([]);
  }, 500);
}

// Inject CSS styles
function injectStyles() {
  if (document.querySelector('#channel-info-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'channel-info-styles';
  style.textContent = /* css */ `
    /* Channel Info Page (Mobile only) */
    #channel-info-container {
      display: none;
    }

    @media (max-width: 600px) {
      #channel-info-container {
        display: block;
      }

      /* Mobile channel info button (in nav bar) */
      .mobile-channel-info-btn {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--text-muted);
        padding: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--transition);
      }

      .mobile-channel-info-btn:active {
        color: var(--text-main);
        background: var(--background-alt);
        border-radius: var(--border-radius);
      }

      .channel-info-page {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--background);
        z-index: 2000;
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .channel-info-header {
        display: flex;
        align-items: center;
        gap: var(--spacing);
        padding: var(--spacing);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        background: var(--background);
        height: var(--mobile-nav-bar-height);
      }

      .channel-info-back {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: 1.5em;
        color: var(--text-main);
      }

      .channel-info-back:active {
        background: var(--background-alt);
      }

      .channel-info-title {
        margin: 0;
        font-size: 1.2em;
        color: var(--text-main);
      }

      /* Tab Navigation */
      .channel-info-tabs {
        display: flex;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm);
        overflow-x: auto;
        flex-shrink: 0;
        background: var(--background);
        -webkit-overflow-scrolling: touch;
      }

      .channel-info-tab {
        flex-shrink: 0;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 20px;
        cursor: pointer;
        color: var(--text-muted);
        transition: var(--transition);
        white-space: nowrap;
      }

      .channel-info-tab i {
        font-size: 1.1em;
      }

      .channel-info-tab span {
        font-size: 0.9em;
      }

      .channel-info-tab.active {
        color: var(--links);
        background: var(--background-alt);
        border-color: var(--links);
      }

      .channel-info-tab:active {
        transform: scale(0.95);
      }

      /* Content Area */
      .channel-info-content {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      /* Loading State */
      .channel-info-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3em;
        color: var(--text-muted);
      }

      .channel-info-loading i {
        font-size: 2em;
        margin-bottom: var(--spacing);
      }

      /* Error State */
      .channel-info-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3em;
        color: #dc3545;
      }

      .channel-info-error i {
        font-size: 2em;
        margin-bottom: var(--spacing);
      }

      /* Empty State */
      .channel-info-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3em 2em;
        text-align: center;
        color: var(--text-muted);
      }

      .channel-info-empty i {
        font-size: 3em;
        margin-bottom: var(--spacing);
        opacity: 0.5;
      }

      /* List Container */
      .channel-info-list {
        display: flex;
        flex-direction: column;
      }

      /* Generic Item */
      .channel-info-item {
        padding: var(--spacing);
        border-bottom: 1px solid var(--border);
      }

      .channel-info-item:last-child {
        border-bottom: none;
      }

      /* Member Item */
      .member-item {
        display: flex;
        align-items: center;
        gap: var(--spacing);
      }

      .member-avatar {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
      }

      .member-avatar::part(svg) {
        width: 40px;
        height: 40px;
        border-radius: 50%;
      }

      .member-name {
        font-size: 1em;
        color: var(--text-main);
      }

      /* Pin Item */
      .pin-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        cursor: pointer;
        transition: var(--transition);
      }

      .pin-item:active {
        background: var(--background-alt);
      }

      .pin-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .pin-avatar {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
      }

      .pin-avatar::part(svg) {
        width: 32px;
        height: 32px;
        border-radius: 50%;
      }

      .pin-meta {
        display: flex;
        align-items: baseline;
        gap: var(--spacing-sm);
      }

      .pin-username {
        font-weight: 600;
        color: var(--text-main);
        font-size: 0.9em;
      }

      .pin-timestamp {
        font-size: 0.75em;
        color: var(--text-muted);
      }

      .pin-message {
        color: var(--text-main);
        font-size: 0.9em;
        line-height: 1.4;
      }

      /* Thread Item */
      .thread-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .thread-preview {
        color: var(--text-main);
        font-size: 0.9em;
      }

      .thread-stats {
        font-size: 0.8em;
        color: var(--text-muted);
      }

      /* Link Item */
      .link-item a {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--links);
        text-decoration: none;
      }

      .link-item a:active {
        opacity: 0.7;
      }

      /* File Item */
      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing);
      }

      .file-item i {
        font-size: 2em;
        color: var(--text-muted);
      }

      .file-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
      }

      .file-name {
        color: var(--text-main);
        font-size: 0.9em;
      }

      .file-meta {
        font-size: 0.75em;
        color: var(--text-muted);
      }
    }

    /* Spin animation */
    .ri-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Highlight message animation (global) */
    @keyframes highlight-pulse {
      0% { background: var(--links); opacity: 0.3; }
      50% { background: var(--links); opacity: 0.5; }
      100% { background: transparent; opacity: 1; }
    }
  `;

  // Also inject global highlight style for messages
  if (!document.querySelector('#message-highlight-style')) {
    const globalStyle = document.createElement('style');
    globalStyle.id = 'message-highlight-style';
    globalStyle.textContent = `
      .highlight-message {
        animation: highlight-pulse 0.5s ease-out;
      }
    `;
    document.head.appendChild(globalStyle);
  }

  document.head.appendChild(style);
}

// Export the state for external use
export { channelInfoState };
