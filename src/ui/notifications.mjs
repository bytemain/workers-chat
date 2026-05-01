import { component, signal } from 'reefjs';
import { getCurrentChannel } from './utils/chat-state.mjs';

const SETTINGS_KEY = 'workersChat.notificationSettings';
const SignalName = 'notificationSettingsSignal';

const DEFAULT_SETTINGS = {
  mentions: true,
  directMessages: true,
  newMessages: false,
};

const notificationState = signal(
  {
    supported: false,
    permission: 'default',
    settings: { ...DEFAULT_SETTINGS },
  },
  SignalName,
);

let notificationComponent = null;
let initialized = false;
let knownMessageIds = new Set();
let startedAt = 0;
let listenerId = null;
let currentRoomName = '';
let getCurrentUsername = () => window.currentUsername || '';
const mentionPatternCache = new Map();
let lastCheckedTimestamp = 0;

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function updatePermissionState() {
  notificationState.supported = 'Notification' in window;
  notificationState.permission = notificationState.supported
    ? Notification.permission
    : 'unsupported';
}

function getDisplayText(message) {
  if (!message) return '';
  if (message.startsWith('FILE:')) return 'Shared a file';
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMention(message, username) {
  if (!message || !username) return false;
  let mentionPattern = mentionPatternCache.get(username);
  if (!mentionPattern) {
    mentionPattern = new RegExp(`(^|\\s)@${escapeRegex(username)}\\b`, 'i');
    mentionPatternCache.set(username, mentionPattern);
  }
  return mentionPattern.test(message);
}

function isDirectMessage(message) {
  return (message.channel || '').startsWith('dm-');
}

function shouldNotify(message, username) {
  if (!message || message.username === username) return false;

  const mention = isMention(message.text, username);
  const dm = isDirectMessage(message);

  if (mention && notificationState.settings.mentions) {
    return { type: 'mention', priority: 'high' };
  }

  if (dm && notificationState.settings.directMessages) {
    return { type: 'dm', priority: 'high' };
  }

  if (notificationState.settings.newMessages) {
    const channel = message.channel || 'general';
    const currentChannel = getCurrentChannel();
    if (document.hidden || !currentChannel || channel !== currentChannel) {
      return { type: 'message', priority: 'normal' };
    }
  }

  return null;
}

async function showDesktopNotification(message, notificationType) {
  updatePermissionState();
  if (notificationState.permission !== 'granted') return;

  const channel = message.channel || 'general';
  const isHighPriority = notificationType.priority === 'high';
  const title =
    notificationType.type === 'mention'
      ? `${message.username} mentioned you`
      : notificationType.type === 'dm'
        ? `Direct message from ${message.username}`
        : `New message in #${channel}`;

  const options = {
    body: getDisplayText(message.text),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: `${currentRoomName}:${notificationType.type}:${message.messageId}`,
    renotify: isHighPriority,
    requireInteraction: isHighPriority,
    data: {
      roomName: currentRoomName,
      channel,
      messageId: message.messageId,
    },
  };

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      if (window.jumpToMessage) {
        window.jumpToMessage(message.messageId, channel);
      }
      notification.close();
    };
  } catch (error) {
    console.warn('Unable to show notification:', error);
  }
}

function normalizeMessage(messageId, data) {
  return {
    messageId,
    text: data.text || '',
    username: data.username || 'Anonymous',
    channel: data.channel || 'general',
    timestamp: data.timestamp || 0,
  };
}

async function getNewMessages(store) {
  const db = window.rxdb;
  if (db?.messages) {
    const docs = await db.messages
      .find({
        selector: {
          timestamp: {
            $gte: lastCheckedTimestamp || startedAt,
          },
        },
        sort: [{ timestamp: 'asc' }],
      })
      .exec();

    return docs.map((doc) => {
      const data = doc.toJSON();
      return normalizeMessage(data.messageId, data);
    });
  }

  const table = store.getTable('messages') || {};
  return Object.entries(table).map(([messageId, row]) =>
    normalizeMessage(messageId, row),
  );
}

async function handleMessagesTableChange(store) {
  const messages = await getNewMessages(store);
  const username = getCurrentUsername();

  for (const message of messages) {
    if (knownMessageIds.has(message.messageId)) continue;
    knownMessageIds.add(message.messageId);

    if (message.timestamp < startedAt) continue;
    lastCheckedTimestamp = Math.max(lastCheckedTimestamp, message.timestamp);

    const notificationType = shouldNotify(message, username);
    if (notificationType) {
      showDesktopNotification(message, notificationType);
    }
  }
}

function notificationSettingsTemplate() {
  const state = notificationState;
  const settings = state.settings;

  if (!state.supported) {
    return `
      <div class="modal-section">
        <h4><i class="ri-notification-off-line"></i> Notifications</h4>
        <p style="font-size: 0.9em; color: var(--text-muted);">
          Desktop notifications are not supported in this browser.
        </p>
      </div>
    `;
  }

  const permissionLabel =
    state.permission === 'granted'
      ? 'Allowed'
      : state.permission === 'denied'
        ? 'Blocked in browser settings'
        : 'Not requested';

  return `
    <div class="modal-section" id="notification-settings-section">
      <h4><i class="ri-notification-3-line"></i> Notifications</h4>
      <p style="font-size: 0.9em; color: var(--text-muted); margin-bottom: var(--spacing-sm)">
        Permission: ${permissionLabel}
      </p>
      ${
        state.permission === 'granted'
          ? ''
          : `<button id="btn-enable-notifications" class="channel-action-btn" style="width: auto; padding: 6px 10px; margin-bottom: var(--spacing-sm)">
              <i class="ri-notification-3-line"></i> Enable notifications
            </button>`
      }
      <label style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input id="notify-mentions" type="checkbox" data-notification-setting="mentions" ${settings.mentions ? 'checked' : ''} />
        <span id="notify-mentions-label">@mention notifications (high priority)</span>
      </label>
      <label style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input id="notify-direct-messages" type="checkbox" data-notification-setting="directMessages" ${settings.directMessages ? 'checked' : ''} />
        <span id="notify-direct-messages-label">Direct message notifications</span>
      </label>
      <label style="display: flex; gap: 8px; align-items: center;">
        <input id="notify-new-messages" type="checkbox" data-notification-setting="newMessages" ${settings.newMessages ? 'checked' : ''} />
        <span id="notify-new-messages-label">All new message notifications</span>
      </label>
    </div>
  `;
}

function initNotificationSettingsUI() {
  let container = document.getElementById('notifications-settings');
  const modalBody = document.querySelector('#room-settings-modal .modal-body');
  if (!container && modalBody) {
    container = document.createElement('div');
    container.id = 'notifications-settings';
    modalBody.prepend(container);
  }
  if (!container || notificationComponent) return;

  notificationComponent = component(container, notificationSettingsTemplate, {
    signals: [SignalName],
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('#btn-enable-notifications');
    if (!button) return;

    event.preventDefault();
    const permission = await Notification.requestPermission();
    notificationState.permission = permission;
  });

  container.addEventListener('change', (event) => {
    const input = event.target.closest('[data-notification-setting]');
    if (!input) return;

    const key = input.dataset.notificationSetting;
    notificationState.settings = {
      ...notificationState.settings,
      [key]: input.checked,
    };
    saveSettings(notificationState.settings);
  });
}

export async function initNotifications(options = {}) {
  if (initialized) return;

  const { store, roomName, getUsername } = options;
  if (!store) return;

  currentRoomName = roomName || '';
  getCurrentUsername = getUsername || getCurrentUsername;
  startedAt = Date.now();
  lastCheckedTimestamp = startedAt;
  knownMessageIds = new Set(Object.keys(store.getTable('messages') || {}));

  notificationState.settings = loadSettings();
  updatePermissionState();
  initNotificationSettingsUI();

  listenerId = store.addTableListener('messages', () => {
    handleMessagesTableChange(store);
  });
  initialized = true;
}

export function cleanupNotifications(store) {
  if (store && listenerId !== null) {
    store.delListener(listenerId);
  }
  listenerId = null;
  initialized = false;
  knownMessageIds = new Set();
  startedAt = 0;
  lastCheckedTimestamp = 0;
  currentRoomName = '';
  mentionPatternCache.clear();
}
