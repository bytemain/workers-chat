/**
 * P2P Database Module using RxDB
 * Manages P2P messages with WebRTC replication
 */
import { createRxDatabase } from 'rxdb/plugins/core';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import {
  replicateWebRTC,
  getConnectionHandlerSimplePeer,
} from 'rxdb/plugins/replication-webrtc';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { addRxPlugin } from 'rxdb/plugins/core';
import { disableWarnings } from 'rxdb/plugins/dev-mode';

disableWarnings();

// Add migration plugin
addRxPlugin(RxDBMigrationSchemaPlugin);

// Enable dev mode in development
if (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) {
  addRxPlugin(RxDBDevModePlugin);
}

let database = null;
let databaseInitPromise = null; // Promise that resolves when database is initialized
const replicationPools = new Map(); // username -> replicationPool

/**
 * Message schema
 */
const messageSchema = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 100,
    },
    peerUsername: {
      type: 'string', // The peer user this message is with
      maxLength: 100,
    },
    text: {
      type: 'string',
    },
    isSelf: {
      type: 'boolean',
    },
    timestamp: {
      type: 'number',
      multipleOf: 1, // Required for indexed number fields
      minimum: 0,
    },
    // RxDB requires updatedAt for replication
    updatedAt: {
      type: 'number',
      multipleOf: 1,
      minimum: 0,
    },
  },
  required: ['id', 'peerUsername', 'text', 'isSelf', 'timestamp', 'updatedAt'],
  indexes: ['peerUsername'],
};

/**
 * Contact schema
 */
const contactSchema = {
  version: 1,
  primaryKey: 'username',
  type: 'object',
  properties: {
    username: {
      type: 'string',
      maxLength: 100,
    },
    lastMessageTime: {
      type: 'number',
      multipleOf: 1,
      minimum: 0,
    },
    unreadCount: {
      type: 'number',
      default: 0,
      multipleOf: 1,
      minimum: 0,
    },
    updatedAt: {
      type: 'number',
      multipleOf: 1,
      minimum: 0,
    },
  },
  required: ['username', 'lastMessageTime', 'unreadCount', 'updatedAt'],
  indexes: [], // No indexes needed for contacts, we sort in memory
};

/**
 * Initialize RxDB database
 */
export async function initDatabase(currentUsername) {
  // Return existing promise if initialization is already in progress
  if (databaseInitPromise) return databaseInitPromise;

  if (database) return database;

  // Store the initialization promise
  databaseInitPromise = (async () => {
    // Create storage with validation
    const storage = wrappedValidateAjvStorage({
      storage: getRxStorageLocalstorage(),
    });

    // Create database (unique per user)
    database = await createRxDatabase({
      name: `p2p_chat_${currentUsername}`,
      storage,
    });

    // Add collections with migration strategies
    await database.addCollections({
      messages: {
        schema: messageSchema,
        migrationStrategies: {
          // Migration from version 0 to 1 (no-op, just schema version bump)
          1: (oldDoc) => oldDoc,
        },
      },
      contacts: {
        schema: contactSchema,
        migrationStrategies: {
          // Migration from version 0 to 1 (no-op, just schema version bump)
          1: (oldDoc) => oldDoc,
        },
      },
    });

    console.log('✅ RxDB P2P Database initialized');
    return database;
  })();

  return databaseInitPromise;
}

/**
 * Get the database instance
 */
export function getDatabase() {
  return database;
}

/**
 * Wait for database to be initialized
 * Returns immediately if already initialized, otherwise waits for initialization
 */
export async function waitForDatabase() {
  if (database && database.messages && database.contacts) {
    return database;
  }
  if (databaseInitPromise) {
    await databaseInitPromise;
    return database;
  }
  throw new Error(
    'Database initialization not started. Call initDatabase() first.',
  );
}

/**
 * Add a contact
 */
export async function addContact(username) {
  await waitForDatabase();
  if (!database || !database.contacts)
    throw new Error('Database not initialized');

  try {
    const existingContact = await database.contacts.findOne(username).exec();
    if (existingContact) {
      // Update timestamp using incrementalModify to handle conflicts
      await existingContact.incrementalModify((docData) => {
        docData.updatedAt = Date.now();
        return docData;
      });
      return existingContact;
    }

    // Create new contact
    const contact = await database.contacts.insert({
      username,
      lastMessageTime: Date.now(),
      unreadCount: 0,
      updatedAt: Date.now(),
    });
    return contact;
  } catch (error) {
    console.error('Failed to add contact:', error);
    throw error;
  }
}

/**
 * Remove a contact
 */
export async function removeContact(username) {
  await waitForDatabase();
  if (!database) throw new Error('Database not initialized');

  try {
    const contact = await database.contacts.findOne(username).exec();
    if (contact) {
      await contact.remove();
    }

    // Also remove all messages with this contact
    const messages = await database.messages
      .find({
        selector: {
          peerUsername: username,
        },
      })
      .exec();

    await Promise.all(messages.map((msg) => msg.remove()));
  } catch (error) {
    console.error('Failed to remove contact:', error);
    throw error;
  }
}

/**
 * Get all contacts query (reactive)
 */
export async function getAllContactsQuery() {
  await waitForDatabase();
  if (!database || !database.contacts)
    throw new Error('Database not initialized');
  // Get all contacts and sort in memory by lastMessageTime
  return database.contacts.find();
}

/**
 * Update contact unread count
 */
export async function updateUnreadCount(username, count) {
  await waitForDatabase();
  if (!database || !database.contacts)
    throw new Error('Database not initialized');

  try {
    const contact = await database.contacts.findOne(username).exec();
    if (contact) {
      // Use incrementalModify to handle conflicts automatically
      await contact.incrementalModify((docData) => {
        docData.unreadCount = count;
        docData.updatedAt = Date.now();
        return docData;
      });
    }
  } catch (error) {
    console.error('Failed to update unread count:', error);
  }
}

/**
 * Add a message
 */
export async function addMessage(peerUsername, text, isSelf) {
  await waitForDatabase();
  if (!database || !database.messages)
    throw new Error('Database not initialized');

  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    const message = await database.messages.insert({
      id,
      peerUsername,
      text,
      isSelf,
      timestamp: now,
      updatedAt: now,
    });

    // Update contact
    const contact = await database.contacts.findOne(peerUsername).exec();
    if (contact) {
      // Use incrementalModify to handle conflicts automatically
      await contact.incrementalModify((docData) => {
        docData.lastMessageTime = now;
        docData.unreadCount = isSelf
          ? docData.unreadCount
          : docData.unreadCount + 1;
        docData.updatedAt = now;
        return docData;
      });
    } else {
      // Create contact if doesn't exist
      await addContact(peerUsername);
    }

    return message;
  } catch (error) {
    console.error('Failed to add message:', error);
    throw error;
  }
}

/**
 * Get messages query for a contact (reactive)
 */
export async function getMessagesQuery(peerUsername, limit = 100) {
  await waitForDatabase();
  if (!database || !database.messages)
    throw new Error('Database not initialized');
  return database.messages.find({
    selector: {
      peerUsername,
    },
    sort: [{ timestamp: 'asc' }],
    limit,
  });
}

/**
 * Start WebRTC replication with a peer
 * Uses existing WebRTC connection (Data Channel) as signaling
 */
export async function startP2PReplication(peerUsername, dataChannel) {
  await waitForDatabase();
  if (!database || !database.messages)
    throw new Error('Database not initialized');
  if (replicationPools.has(peerUsername)) {
    console.log(`P2P replication with ${peerUsername} already active`);
    return replicationPools.get(peerUsername);
  }

  try {
    // Create a custom connection handler that uses our existing Data Channel
    const connectionHandler = createDataChannelConnectionHandler(
      dataChannel,
      peerUsername,
    );

    // Start replication for messages collection
    const replicationPool = await replicateWebRTC({
      collection: database.messages,
      // Topic is unique per peer pair (alphabetically sorted for consistency)
      topic: [peerUsername, database.name].sort().join('-'),
      connectionHandlerCreator: connectionHandler,
      pull: {},
      push: {},
    });

    // Observe errors
    replicationPool.error$.subscribe((err) => {
      console.error(`WebRTC Replication Error with ${peerUsername}:`, err);
    });

    replicationPools.set(peerUsername, replicationPool);
    console.log(`✅ Started P2P replication with ${peerUsername}`);

    return replicationPool;
  } catch (error) {
    console.error(
      `Failed to start P2P replication with ${peerUsername}:`,
      error,
    );
    throw error;
  }
}

/**
 * Stop WebRTC replication with a peer
 */
export async function stopP2PReplication(peerUsername) {
  const replicationPool = replicationPools.get(peerUsername);
  if (replicationPool) {
    await replicationPool.cancel();
    replicationPools.delete(peerUsername);
    console.log(`Stopped P2P replication with ${peerUsername}`);
  }
}

/**
 * Create a connection handler that uses existing WebRTC Data Channel
 * This integrates RxDB replication with our existing WebRTC infrastructure
 */
function createDataChannelConnectionHandler(dataChannel, peerUsername) {
  return () => {
    return {
      connect: () => {
        // Return a connection object that wraps our Data Channel
        return Promise.resolve({
          peer: {
            id: peerUsername,
          },
          send: (data) => {
            if (dataChannel.readyState === 'open') {
              // Prefix RxDB replication messages
              dataChannel.send(
                JSON.stringify({
                  type: 'rxdb-replication',
                  data,
                }),
              );
            }
          },
          // RxDB expects 'data' and 'error' event listeners
          addEventListener: (event, handler) => {
            if (event === 'data') {
              // Store handler to call when we receive RxDB messages
              dataChannel._rxdbDataHandler = handler;
            }
          },
          close: () => {
            // Don't actually close the Data Channel, just cleanup
            delete dataChannel._rxdbDataHandler;
          },
        });
      },
      destroy: () => {
        // Cleanup
        delete dataChannel._rxdbDataHandler;
      },
    };
  };
}

/**
 * Handle incoming Data Channel message
 * Call this from your WebRTC message handler
 */
export function handleDataChannelMessage(dataChannel, message) {
  try {
    const parsed = JSON.parse(message);
    if (parsed.type === 'rxdb-replication' && dataChannel._rxdbDataHandler) {
      // Route to RxDB replication handler
      dataChannel._rxdbDataHandler({ data: parsed.data });
      return true; // Handled
    }
  } catch (e) {
    // Not a JSON message or not for RxDB
  }
  return false; // Not handled
}

/**
 * Cleanup on app shutdown
 */
export async function cleanup() {
  // Stop all replications
  for (const [username, pool] of replicationPools.entries()) {
    await pool.cancel();
  }
  replicationPools.clear();

  // Close database
  if (database) {
    await database.destroy();
    database = null;
  }
}
