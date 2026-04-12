/**
 * RxDB Database Setup
 *
 * Replaces TinyBase's MergeableStore + IndexedDbPersister + WsSynchronizer
 * with RxDB + Dexie storage + WebSocket replication.
 */

import { createRxDatabase, addRxPlugin } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';
import ReconnectingWebSocket from '@opensumi/reconnecting-websocket';
import { api } from '../api.mjs';
import {
  messagesSchema,
  reactionsSchema,
  channelsSchema,
  pinsSchema,
  roomSettingsSchema,
} from './schemas.mjs';

addRxPlugin(RxDBLeaderElectionPlugin);

/**
 * @typedef {import('rxdb').RxDatabase} RxDatabase
 * @typedef {import('rxdb').RxCollection} RxCollection
 */

/** @type {RxDatabase|null} */
let db = null;

/**
 * Get the current RxDB database instance
 * @returns {RxDatabase}
 */
export function getDb() {
  return db;
}

/**
 * Get the messages collection
 * @returns {RxCollection}
 */
export function getMessagesCollection() {
  return db?.messages;
}

/**
 * Get the reactions collection
 * @returns {RxCollection}
 */
export function getReactionsCollection() {
  return db?.reactions;
}

/**
 * Get the channels collection
 * @returns {RxCollection}
 */
export function getChannelsCollection() {
  return db?.channels;
}

/**
 * Get the pins collection
 * @returns {RxCollection}
 */
export function getPinsCollection() {
  return db?.pins;
}

/**
 * Get the room_settings collection
 * @returns {RxCollection}
 */
export function getRoomSettingsCollection() {
  return db?.room_settings;
}

// Collection names for iteration
export const CollectionNames = {
  Messages: 'messages',
  Reactions: 'reactions',
  Channels: 'channels',
  Pins: 'pins',
  RoomSettings: 'room_settings',
};

/**
 * Set up WebSocket replication for a collection using RxDB's replication plugin
 * with a custom backend (Durable Object).
 *
 * The protocol matches what the RxDB websocket-server plugin expects:
 * - Client sends: { id, collection, method, params }
 * - Server responds: { id, collection, result }
 * - Server streams: { id: 'stream', collection, result }
 */
function setupWebSocketReplication(collection, wsUrl) {
  const collectionName = collection.name;
  const pullStream$ = new Subject();
  let ws = null;
  let requestCounter = 0;
  const pendingRequests = new Map();

  function connect() {
    ws = new ReconnectingWebSocket(wsUrl);

    ws.addEventListener('open', () => {
      console.log(`🔗 WS connected for ${collectionName}`);
      // Subscribe to the change stream
      const streamRequest = {
        id: 'stream',
        collection: collectionName,
        method: 'masterChangeStream$',
        params: [],
      };
      ws.send(JSON.stringify(streamRequest));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 'stream' && msg.collection === collectionName) {
        // Stream event from server - push to pull stream
        pullStream$.next(msg.result);
      } else if (pendingRequests.has(msg.id)) {
        // Response to a request
        const resolve = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        resolve(msg.result);
      }
    });

    ws.addEventListener('close', () => {
      console.log(`🔌 WS disconnected for ${collectionName}`);
    });
  }

  function sendRequest(method, params) {
    return new Promise((resolve) => {
      const id = `${collectionName}-${requestCounter++}`;
      pendingRequests.set(id, resolve);
      const request = {
        id,
        collection: collectionName,
        method,
        params,
      };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(request));
      } else {
        // Wait for connection
        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.send(JSON.stringify(request));
        };
        ws.addEventListener('open', onOpen);
      }
    });
  }

  connect();

  const replicationState = replicateRxCollection({
    collection,
    replicationIdentifier: `ws-replication-${collectionName}`,
    live: true,
    retryTime: 3000,
    pull: {
      async handler(checkpointOrNull, batchSize) {
        const result = await sendRequest('masterChangesSince', [
          checkpointOrNull,
          batchSize,
        ]);
        return result;
      },
      batchSize: 100,
      stream$: pullStream$.asObservable(),
    },
    push: {
      async handler(changeRows) {
        const result = await sendRequest('masterWrite', [changeRows]);
        return result;
      },
      batchSize: 50,
    },
  });

  // Re-sync on reconnect
  ws.addEventListener('open', () => {
    replicationState.reSync();
    // Re-subscribe to stream
    const streamRequest = {
      id: 'stream',
      collection: collectionName,
      method: 'masterChangeStream$',
      params: [],
    };
    ws.send(JSON.stringify(streamRequest));
  });

  return { replicationState, ws };
}

/**
 * Create and initialize the RxDB database with all collections
 * and set up WebSocket replication for syncing with the server.
 *
 * @param {string} roomName - The room name to sync with
 * @returns {Promise<{db: RxDatabase, destroy: Function}>}
 */
export async function createRxDBStorage(roomName) {
  // Clean up existing database if any
  if (db) {
    await db.close();
    db = null;
  }

  const dbName = `workerschat-${roomName}`;

  db = await createRxDatabase({
    name: dbName,
    storage: getRxStorageDexie(),
    multiInstance: true,
    eventReduce: true,
    ignoreDuplicate: true,
  });

  // Add collections
  await db.addCollections({
    messages: { schema: messagesSchema },
    reactions: { schema: reactionsSchema },
    channels: { schema: channelsSchema },
    pins: { schema: pinsSchema },
    room_settings: { schema: roomSettingsSchema },
  });

  // Set up WebSocket replication for each collection
  const wsUrl = api.getRxdbSyncUrl(roomName);
  const replications = [];

  for (const collectionName of Object.values(CollectionNames)) {
    const collection = db[collectionName];
    const { replicationState, ws } = setupWebSocketReplication(
      collection,
      wsUrl,
    );
    replications.push({ replicationState, ws });
  }

  // Store references globally for access from other modules
  window.rxdb = db;
  window.store = createStoreCompat(db);

  console.log('✅ RxDB database initialized with collections and replication');

  const destroy = async () => {
    console.log('🧹 Cleaning up RxDB resources...');
    for (const { replicationState, ws } of replications) {
      await replicationState.cancel();
      if (ws && ws.close) {
        ws.close();
      }
    }
    if (db) {
      await db.close();
      db = null;
    }
    console.log('✅ RxDB resources cleaned up');
  };

  window.rxdbDestroy = destroy;

  window.storeUtils = {
    show: () => {
      if (db) {
        console.log('🔄 RxDB collections:', Object.keys(db.collections));
      } else {
        console.warn('⚠️ RxDB is not initialized yet.');
      }
    },
    debug: () => {
      setInterval(() => {
        window.storeUtils.show();
      }, 5000);
    },
  };

  return { db, destroy };
}

/**
 * Create a TinyBase-compatible store adapter on top of RxDB.
 * This provides backward-compatible methods so existing code
 * (like pinned-messages, channel-list, etc.) can work without
 * major rewrites.
 *
 * Uses an in-memory cache populated by RxDB reactive queries
 * for synchronous access (matching TinyBase's sync API).
 *
 * @param {RxDatabase} database - The RxDB database instance
 * @returns {Object} A store-like object with compatible methods
 */
function createStoreCompat(database) {
  const tableListeners = new Map(); // tableId -> Set<callback>
  const valueListeners = new Map(); // valueId -> Set<callback>
  let listenerCounter = 0;

  // In-memory cache for synchronous access
  // Populated by reactive subscriptions to RxDB collections
  const tableCache = new Map(); // collectionName -> Map<docId, docData>
  const subscriptions = [];

  // In-memory values store (for room settings like roomName)
  const valuesCache = {};

  // Initialize cache and subscriptions for each collection
  for (const [name, collection] of Object.entries(database.collections)) {
    tableCache.set(name, new Map());

    // Subscribe to collection changes and keep cache in sync
    const sub = collection.find().$.subscribe((docs) => {
      const cache = tableCache.get(name);
      cache.clear();
      docs.forEach((doc) => {
        const data = doc.toJSON();
        delete data._rev;
        delete data._attachments;
        delete data._meta;
        delete data._deleted;
        const pk = collection.schema.primaryPath;
        cache.set(data[pk], data);
      });
      notifyTableListeners(name);
    });
    subscriptions.push(sub);
  }

  // Load initial values from room_settings collection
  async function loadValues() {
    const docs = await database.room_settings.find().exec();
    docs.forEach((doc) => {
      valuesCache[doc.key] = doc.value;
    });
  }
  loadValues();

  // Subscribe to room_settings changes
  const settingsSub = database.room_settings.find().$.subscribe((docs) => {
    docs.forEach((doc) => {
      const oldValue = valuesCache[doc.key];
      const newValue = doc.toJSON().value;
      valuesCache[doc.key] = newValue;
      if (oldValue !== newValue) {
        notifyValueListeners(doc.key, newValue);
      }
    });
  });
  subscriptions.push(settingsSub);

  function notifyTableListeners(tableId) {
    const listeners = tableListeners.get(tableId);
    if (listeners) {
      listeners.forEach((cb) => {
        try {
          cb();
        } catch (e) {
          console.error('Table listener error:', e);
        }
      });
    }
  }

  function notifyValueListeners(valueId, newValue) {
    const listeners = valueListeners.get(valueId);
    if (listeners) {
      listeners.forEach((cb) => {
        try {
          cb(compat, valueId, newValue);
        } catch (e) {
          console.error('Value listener error:', e);
        }
      });
    }
  }

  const compat = {
    /**
     * Check if a row exists in a collection (sync via cache)
     */
    hasRow(tableId, rowId) {
      const cache = tableCache.get(tableId);
      return cache ? cache.has(rowId) : false;
    },

    /**
     * Get a row from a collection (sync via cache)
     */
    getRow(tableId, rowId) {
      const cache = tableCache.get(tableId);
      if (!cache) return {};
      const data = cache.get(rowId);
      return data ? { ...data } : {};
    },

    /**
     * Get a cell (field) from a row
     */
    getCell(tableId, rowId, cellId) {
      const row = this.getRow(tableId, rowId);
      return row[cellId] ?? undefined;
    },

    /**
     * Set a row in a collection (upsert)
     */
    async setRow(tableId, rowId, data) {
      const collection = database[tableId];
      if (!collection) {
        console.error(`Collection ${tableId} not found`);
        return;
      }
      const primaryKey = collection.schema.primaryPath;
      const doc = { ...data, [primaryKey]: rowId };
      await collection.upsert(doc);
    },

    /**
     * Set a single cell in a row
     */
    async setCell(tableId, rowId, cellId, value) {
      const collection = database[tableId];
      if (!collection) return;
      const primaryKey = collection.schema.primaryPath;
      const existing = await collection.findOne(rowId).exec();
      if (existing) {
        await existing.patch({ [cellId]: value });
      } else {
        await collection.upsert({
          [primaryKey]: rowId,
          [cellId]: value,
        });
      }
    },

    /**
     * Delete a row from a collection
     */
    async delRow(tableId, rowId) {
      const collection = database[tableId];
      if (!collection) return;
      const doc = await collection.findOne(rowId).exec();
      if (doc) {
        await doc.remove();
      }
    },

    /**
     * Get all rows in a collection as an object { rowId: rowData } (sync via cache)
     */
    getTable(tableId) {
      const cache = tableCache.get(tableId);
      if (!cache) return {};
      const result = {};
      for (const [id, data] of cache.entries()) {
        result[id] = { ...data };
      }
      return result;
    },

    /**
     * Get all row IDs in a collection
     */
    getRowIds(tableId) {
      const cache = tableCache.get(tableId);
      return cache ? Array.from(cache.keys()) : [];
    },

    /**
     * Set a value (key-value pair in room_settings)
     */
    async setValue(key, value) {
      valuesCache[key] = value;
      await database.room_settings.upsert({
        key,
        value: String(value),
      });
    },

    /**
     * Get a value
     */
    getValue(key) {
      return valuesCache[key] ?? undefined;
    },

    /**
     * Get all values
     */
    getValues() {
      return { ...valuesCache };
    },

    /**
     * Get all tables (collections data)
     */
    getTables() {
      const result = {};
      for (const name of Object.keys(database.collections)) {
        result[name] = this.getTable(name);
      }
      return result;
    },

    /**
     * Add a table listener
     */
    addTableListener(tableId, callback) {
      const id = ++listenerCounter;
      if (!tableListeners.has(tableId)) {
        tableListeners.set(tableId, new Map());
      }
      tableListeners.get(tableId).set(id, callback);
      return id;
    },

    /**
     * Add a value listener
     */
    addValueListener(valueId, callback) {
      const id = ++listenerCounter;
      if (!valueListeners.has(valueId)) {
        valueListeners.set(valueId, new Map());
      }
      valueListeners.get(valueId).set(id, callback);
      return id;
    },

    /**
     * Add a row listener (listens to changes in individual rows)
     */
    addRowListener(tableId, rowId, callback) {
      const id = ++listenerCounter;
      const collection = database[tableId];
      if (!collection) return id;

      // Subscribe to the specific row or all rows
      const query = rowId
        ? collection.findOne(rowId)
        : collection.find();

      const sub = query.$.subscribe(() => {
        callback(compat, tableId, rowId, () => ({}));
      });

      // Store subscription for cleanup
      if (!tableListeners.has(`__row_${tableId}_${id}`)) {
        tableListeners.set(`__row_${tableId}_${id}`, sub);
      }

      return id;
    },

    /**
     * Remove a listener
     */
    delListener(id) {
      // Try to find and remove from all listener maps
      for (const [key, listeners] of tableListeners.entries()) {
        if (listeners instanceof Map && listeners.has(id)) {
          listeners.delete(id);
          return;
        }
        // Handle subscription cleanup
        if (
          key.startsWith('__row_') &&
          listeners?.unsubscribe
        ) {
          listeners.unsubscribe();
          tableListeners.delete(key);
          return;
        }
      }
      for (const listeners of valueListeners.values()) {
        if (listeners.has(id)) {
          listeners.delete(id);
          return;
        }
      }
    },

    /**
     * Transaction helper - runs operations together
     */
    async transaction(fn) {
      // RxDB doesn't have explicit transactions in the same way,
      // but we can batch operations
      await fn();
    },

    /**
     * Clean up all subscriptions
     */
    destroy() {
      subscriptions.forEach((sub) => sub.unsubscribe());
      subscriptions.length = 0;
      tableCache.clear();
      tableListeners.clear();
      valueListeners.clear();
    },
  };

  return compat;
}
