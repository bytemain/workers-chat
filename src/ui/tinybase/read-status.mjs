import { createStore } from 'tinybase';
import { createLocalPersister } from 'tinybase/persisters/persister-browser';
import { run } from 'ruply';

/**
 * Create a local-only TinyBase store to track read message status
 * Schema:
 *   Table: readMessages
 *   Row ID: {roomName}:{messageId}
 *   Cells: { channel: string, readAt: number }
 */
export async function createReadStatusStore() {
  const store = createStore();

  // Local persistence only (no sync to server)
  await run(
    createLocalPersister(store, 'local://tinybase/read-status'),
    async (persister) => {
      await persister.startAutoLoad();
      await persister.startAutoSave();
    },
  );

  return store;
}

/**
 * Mark a message as read
 * @param {Store} readStatusStore - TinyBase store for read status
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {string} messageId - Message ID
 */
export function markMessageAsRead(readStatusStore, roomName, channel, messageId) {
  const rowId = `${roomName}:${messageId}`;
  readStatusStore.setRow('readMessages', rowId, {
    channel,
    readAt: Date.now(),
  });
}

/**
 * Mark all messages in a channel as read
 * @param {Store} readStatusStore - TinyBase store for read status
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {Array<{messageId: string}>} messages - Array of messages
 */
export function markChannelAsRead(readStatusStore, roomName, channel, messages) {
  messages.forEach((msg) => {
    markMessageAsRead(readStatusStore, roomName, channel, msg.messageId);
  });
}

/**
 * Check if a message has been read
 * @param {Store} readStatusStore - TinyBase store for read status
 * @param {string} roomName - Room name
 * @param {string} messageId - Message ID
 * @returns {boolean}
 */
export function isMessageRead(readStatusStore, roomName, messageId) {
  const rowId = `${roomName}:${messageId}`;
  return readStatusStore.hasRow('readMessages', rowId);
}

/**
 * Get unread message count for a channel
 * @param {Store} readStatusStore - TinyBase store for read status
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {Array<{messageId: string, channel: string}>} allMessages - All messages from TinyBase
 * @returns {number}
 */
export function getUnreadCount(readStatusStore, roomName, channel, allMessages) {
  const channelMessages = allMessages.filter(
    (msg) => msg.channel.toLowerCase() === channel.toLowerCase(),
  );

  let unreadCount = 0;
  channelMessages.forEach((msg) => {
    if (!isMessageRead(readStatusStore, roomName, msg.messageId)) {
      unreadCount++;
    }
  });

  return unreadCount;
}

/**
 * Clear all read status for a room (e.g., when leaving)
 * @param {Store} readStatusStore - TinyBase store for read status
 * @param {string} roomName - Room name
 */
export function clearRoomReadStatus(readStatusStore, roomName) {
  const allRows = readStatusStore.getTable('readMessages');
  Object.keys(allRows).forEach((rowId) => {
    if (rowId.startsWith(`${roomName}:`)) {
      readStatusStore.delRow('readMessages', rowId);
    }
  });
}
