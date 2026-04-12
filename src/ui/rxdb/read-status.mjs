/**
 * Read Status Store - RxDB local-only store
 *
 * Replaces TinyBase's local-only store for tracking read messages.
 * Uses a simple RxDB database with Dexie storage (IndexedDB).
 * This data is NOT synced to the server.
 */

import { createRxDatabase } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

const readStatusSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 200 },
    channel: { type: 'string' },
    readAt: { type: 'number' },
  },
  required: ['id', 'channel', 'readAt'],
};

let readStatusDb = null;

/**
 * Create a local-only RxDB database to track read message status
 * @returns {Promise<Object>} Store-compatible object
 */
export async function createReadStatusStore() {
  if (readStatusDb) {
    await readStatusDb.close();
  }

  readStatusDb = await createRxDatabase({
    name: 'workers-chat-read-status',
    storage: getRxStorageDexie(),
    multiInstance: false,
    closeDuplicates: true,
  });

  await readStatusDb.addCollections({
    read_messages: { schema: readStatusSchema },
  });

  // Return a TinyBase-compatible interface
  return createReadStatusCompat(readStatusDb);
}

function createReadStatusCompat(database) {
  // In-memory cache populated by reactive subscription
  const cache = new Map(); // rowId -> { channel, readAt }

  // Subscribe to changes and keep cache in sync
  database.read_messages.find().$.subscribe((docs) => {
    cache.clear();
    docs.forEach((doc) => {
      cache.set(doc.id, {
        channel: doc.channel,
        readAt: doc.readAt,
      });
    });
  });

  return {
    hasRow(tableId, rowId) {
      return cache.has(rowId);
    },

    getTable(tableId) {
      const result = {};
      for (const [id, data] of cache.entries()) {
        result[id] = { ...data };
      }
      return result;
    },

    async setRow(tableId, rowId, data) {
      await database.read_messages.upsert({
        id: rowId,
        channel: data.channel,
        readAt: data.readAt,
      });
    },

    async delRow(tableId, rowId) {
      const doc = await database.read_messages.findOne(rowId).exec();
      if (doc) {
        await doc.remove();
      }
    },
  };
}

/**
 * Mark a message as read
 * @param {Object} readStatusStore - Read status store
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {string} messageId - Message ID
 */
export function markMessageAsRead(
  readStatusStore,
  roomName,
  channel,
  messageId,
) {
  const rowId = `${roomName}:${messageId}`;
  readStatusStore.setRow('readMessages', rowId, {
    channel,
    readAt: Date.now(),
  });
}

/**
 * Mark all messages in a channel as read
 * @param {Object} readStatusStore - Read status store
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {Array<{messageId: string}>} messages - Array of messages
 */
export function markChannelAsRead(
  readStatusStore,
  roomName,
  channel,
  messages,
) {
  messages.forEach((msg) => {
    markMessageAsRead(readStatusStore, roomName, channel, msg.messageId);
  });
}

/**
 * Check if a message has been read
 * @param {Object} readStatusStore - Read status store
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
 * @param {Object} readStatusStore - Read status store
 * @param {string} roomName - Room name
 * @param {string} channel - Channel name
 * @param {Array<{messageId: string, channel: string}>} allMessages - All messages
 * @returns {number}
 */
export function getUnreadCount(
  readStatusStore,
  roomName,
  channel,
  allMessages,
) {
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
 * Clear all read status for a room
 * @param {Object} readStatusStore - Read status store
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
