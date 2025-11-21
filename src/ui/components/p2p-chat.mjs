/**
 * P2P Chat Component - Reuses main chat framework
 * Uses URL routing: /dm/{username} for P2P chats
 */
import {
  addMessage,
  getMessagesQuery,
  updateUnreadCount,
  addContact,
} from '../utils/p2p-database.mjs';
import { chatState } from '../utils/chat-state.mjs';

let currentP2PChat = null;
let messageSubscription = null;
let isInitializing = false; // Prevent concurrent initialization

export const P2PChat = {
  /**
   * Open P2P chat by switching to dm-{username} channel
   */
  async open(username) {
    // Prevent duplicate initialization
    if (isInitializing) {
      console.log('P2P chat initialization already in progress, skipping...');
      return;
    }

    const dmChannel = `dm-${username}`;

    // Update chat state to dm channel (URL sync happens automatically)
    chatState.switchChannel(dmChannel);

    // Update channelsSignal for UI sync (channel list current state)
    if (window.channelsSignal) {
      window.channelsSignal.currentChannel = dmChannel;
    }

    // Establish WebRTC connection if not already connected and not self-chat
    const currentUsername = window.userState?.value?.username;
    if (username !== currentUsername && window.webRTCManager) {
      // Only connect if not already connected or connecting
      const pc = window.webRTCManager.peers.get(username);
      if (
        !pc ||
        (pc.connectionState !== 'connected' &&
          pc.connectionState !== 'connecting')
      ) {
        console.log(`🔌 Initiating WebRTC connection to ${username}`);
        window.webRTCManager.connect(username);
      } else {
        console.log(`✅ WebRTC already ${pc.connectionState} to ${username}`);
      }
    }

    // Add to contacts if not already there
    try {
      await addContact(username);
    } catch (error) {
      console.log('Contact already exists or error adding:', error);
    }

    // Initialize P2P chat view
    await this.init(username);
  },

  /**
   * Initialize P2P chat for a username
   * Called when channel is dm-{username}
   */
  async init(username) {
    // Prevent concurrent initialization
    if (isInitializing) {
      console.log('Already initializing, skipping...');
      return;
    }

    const dmChannel = `dm-${username}`;

    // Skip if already viewing this chat
    if (currentP2PChat === username && messageSubscription) {
      console.log('Already viewing chat with', username);
      return;
    }

    isInitializing = true;
    console.log('Initializing P2P chat for:', username);

    // Clean up previous subscription
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }

    currentP2PChat = username;

    // Update channel name display
    const channelNameDisplay = document.getElementById('channel-name-display');
    if (channelNameDisplay) {
      channelNameDisplay.textContent = username;
    }

    // Update channel icon to user icon
    const channelHash = document.querySelector('.channel-hash');
    if (channelHash) {
      channelHash.innerHTML = '<i class="ri-user-3-line"></i>';
    }

    // Subscribe to RxDB messages and sync to Reef.js signal
    const query = await getMessagesQuery(username, 100);
    messageSubscription = query.$.subscribe((messageDocs) => {
      const messages = messageDocs.map((doc) => doc.toJSON());
      console.log(`🚀 ~ P2P messages:`, messages.length);
      this.syncToReefSignal(messages, dmChannel);
    });

    // Clear unread count
    await updateUnreadCount(username, 0);

    // Initialization complete
    isInitializing = false;
  },

  /**
   * Sync RxDB messages to Reef.js messagesSignal
   */
  syncToReefSignal(messages, dmChannel) {
    console.log('📨 Syncing P2P messages to Reef signal:', messages.length);

    // Access the global messagesSignal
    const messagesSignal = window.__messagesSignal;
    if (!messagesSignal) {
      console.error('❌ messagesSignal not found');
      return;
    }

    // Get current username from userState
    const currentUsername = window.userState?.value?.username || 'You';

    // Convert RxDB messages to the format expected by message-list
    const formattedMessages = messages.map((msg) => ({
      messageId: msg.id,
      name: msg.isSelf ? currentUsername : currentP2PChat,
      message: msg.text,
      timestamp: msg.timestamp,
      channel: dmChannel, // Use dm-username format
      replyToId: null, // P2P doesn't support threads yet
      editedAt: null,
      encrypted: false, // Already decrypted in RxDB
    }));

    console.log('✅ Formatted messages for Reef:', formattedMessages);

    // CRITICAL: For Reef.js signal(), we need to trigger reactivity
    // Debug: Listen for the signal event
    const eventFired = new Promise((resolve) => {
      document.addEventListener(
        'reef:signal-messagesSignal',
        () => resolve(true),
        { once: true },
      );
      setTimeout(() => resolve(false), 1000);
    });

    // Method 1: Update properties individually (triggers event per property)
    const oldVersion = messagesSignal.version;
    messagesSignal.items = formattedMessages;
    messagesSignal.tempItems = [];
    messagesSignal.loading = false;
    messagesSignal.error = null;
    messagesSignal.version = oldVersion + 1;

    console.log('✅ Signal updated, version:', messagesSignal.version);

    // Check if event was fired
    eventFired.then((fired) => {
      console.log('🎯 reef:signal-messagesSignal event fired:', fired);
    });

    // Force scroll to bottom after render
    setTimeout(() => {
      const messageList = document.getElementById('message-list');
      if (messageList) {
        messageList.scrollTop = messageList.scrollHeight;
      }
    }, 50);
  },

  /**
   * Send a P2P message
   */
  async sendMessage(text) {
    if (!currentP2PChat || !text.trim()) return;

    console.log(
      '📤 Sending P2P message to:',
      currentP2PChat,
      'text:',
      text.trim(),
    );

    try {
      // Add to RxDB
      const msg = await addMessage(currentP2PChat, text.trim(), true);
      console.log('✅ Message added to RxDB:', msg);

      // Send via WebRTC if connected
      if (window.webRTCManager) {
        const dc = window.webRTCManager.getDataChannel(currentP2PChat);
        if (dc && dc.readyState === 'open') {
          dc.send(
            JSON.stringify({
              type: 'p2p-message',
              text: text.trim(),
              timestamp: Date.now(),
            }),
          );
          console.log('✅ Message sent via WebRTC');
        } else {
          console.warn('⚠️ WebRTC data channel not ready:', dc?.readyState);
        }
      }
    } catch (error) {
      console.error('❌ Failed to send P2P message:', error);
      throw error;
    }
  },

  /**
   * Close P2P chat and return to general channel
   */
  close() {
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }

    currentP2PChat = null;

    chatState.switchChannel('general');
  },

  /**
   * Check if currently in a P2P chat
   */
  isActive() {
    return currentP2PChat !== null;
  },

  /**
   * Get current P2P chat username
   */
  getCurrentChat() {
    return currentP2PChat;
  },
};

window.P2PChat = P2PChat;
