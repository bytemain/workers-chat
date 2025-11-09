/**
 * Chat State Management with URL Sync
 *
 * Centralized Reef.js store for chat navigation state (channel, thread, room)
 * Automatically syncs with URL for deep linking and browser history
 */

import {
  store,
  component,
} from 'https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js';
import { syncUrlState } from './url-state-sync.mjs';

const SignalName = 'chatState';

/**
 * Chat navigation state
 * This replaces global variables: currentChannel, currentThreadId
 */
export const chatState = store(
  {
    // Current channel (e.g., 'general', 'dm-alice')
    channel: 'general',

    // Current thread ID (null if no thread open)
    threadId: null,

    // Room name (from URL path, set externally)
    roomName: null,
  },
  {
    // Action: Switch to a channel
    switchChannel(state, channelName) {
      state.channel = channelName || 'general';
      // Close thread when switching channels
      state.threadId = null;
    },

    // Action: Open a thread
    openThread(state, threadId) {
      state.threadId = threadId;
    },

    // Action: Close thread
    closeThread(state) {
      state.threadId = null;
    },

    // Action: Set room name
    setRoom(state, roomName) {
      state.roomName = roomName;
    },

    // Action: Clear channel (for mobile channel list)
    clearChannel(state) {
      state.channel = null;
      state.threadId = null;
    },
  },
  SignalName,
);

// Set up URL state sync
let urlSync = null;

export function initChatState() {
  urlSync = syncUrlState(chatState, {
    // Signal name for this store
    signalName: SignalName,
    // Map state keys to URL params
    stateToUrl: {
      channel: 'channel',
      threadId: 'thread',
    },

    // Serialize: convert state to URL
    serialize: {
      channel: (value) => (value === 'general' || !value ? null : value), // default channel omitted
      threadId: (value) => value || null, // null = remove from URL
    },

    // Deserialize: convert URL to state
    deserialize: {
      channel: (value) => value || 'general',
      threadId: (value) => value || null,
    },

    // Always sync (these are global navigation params)
    shouldSync: () => true,

    // Use pushState for navigation (creates history entries)
    pushState: true,

    // Custom popstate handler - triggers actual UI updates
    onPopState: (event, store) => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlChannel = urlParams.get('channel') || 'general';
      const urlThread = urlParams.get('thread');

      const state = store.value;

      // Check if room changed (by pathname)
      const newRoomName = getRoomNameFromURL();
      if (state.roomName && newRoomName !== state.roomName) {
        // Room changed, reload the page
        window.location.reload();
        return;
      }

      // Handle thread navigation - call actual window functions
      if (urlThread !== state.threadId) {
        if (urlThread && window.openThread) {
          // Store will be updated by openThread calling chatState.openThread
          window.openThread(urlThread);
        } else if (!urlThread && state.threadId && window.closeThread) {
          // Store will be updated by closeThread calling chatState.closeThread
          window.closeThread();
        }
      }

      // Handle channel navigation - call actual switchToChannel
      if (urlChannel !== state.channel && window.switchToChannel) {
        console.log(
          `🔄 Popstate: switching from ${state.channel} to ${urlChannel}`,
        );
        // Store will be updated by switchToChannel calling chatState.switchChannel
        window.switchToChannel(urlChannel);

        // On mobile, ensure we're showing the chat page
        if (window.isMobile && window.isMobile()) {
          const MobileUI = window.MobileUI;
          if (MobileUI && MobileUI.showMobileChatPage) {
            MobileUI.showMobileChatPage();
          }
        }
      }
    },
  });

  console.log('✅ Chat state initialized with URL sync');

  return urlSync;
}

// Helper: Get room name from URL path
function getRoomNameFromURL() {
  const path = window.location.pathname;
  const match = path.match(/^\/room\/([^\/]+)/);
  return match ? match[1] : null;
}

// Cleanup function
export function cleanupChatState() {
  if (urlSync) {
    urlSync.cleanup();
  }
}

// Export state for external access (backward compatibility)
export function getCurrentChannel() {
  return chatState.value.channel;
}

export function getCurrentThreadId() {
  return chatState.value.threadId;
}

export function isThreadOpen() {
  return chatState.value.threadId !== null;
}
