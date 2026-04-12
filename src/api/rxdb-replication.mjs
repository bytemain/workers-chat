/**
 * RxDB Replication Durable Object
 *
 * Implements the RxDB WebSocket replication protocol on the server side
 * using Cloudflare Durable Object with SQLite storage.
 *
 * Protocol:
 * - Client sends: { id, collection, method, params }
 *   Methods: 'masterChangesSince', 'masterWrite', 'masterChangeStream$', 'auth'
 * - Server responds: { id, collection, result }
 * - Server streams changes: { id: 'stream', collection, result }
 */

/**
 * SQL table schema for each RxDB collection.
 * Each collection gets its own table with:
 *  - id: primary key (the document's primary key value)
 *  - data: JSON blob of the full document
 *  - _deleted: soft-delete flag
 *  - _meta_lwt: last-write-time for checkpoint ordering
 *  - _rev: revision string for conflict detection
 */
const COLLECTIONS = [
  'messages',
  'reactions',
  'channels',
  'pins',
  'room_settings',
];

/**
 * Initialize SQLite tables for all collections
 * @param {SqlStorage} sql
 */
function initTables(sql) {
  for (const collection of COLLECTIONS) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS "${collection}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        _deleted INTEGER NOT NULL DEFAULT 0,
        _meta_lwt REAL NOT NULL DEFAULT 0,
        _rev TEXT NOT NULL DEFAULT ''
      )
    `);
    sql.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${collection}_lwt"
        ON "${collection}" (_meta_lwt, id)
    `);
  }
}

/**
 * RxDB Replication Durable Object
 *
 * Handles WebSocket connections and implements the replication protocol.
 */
export class RxDBReplicationDurableObject {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.env = env;

    // Initialize tables
    this.state.blockConcurrencyWhile(async () => {
      initTables(this.sql);
    });

    // Track WebSocket sessions for broadcasting
    this.sessions = new Map(); // WebSocket -> Set<collectionName>
    this.state.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment();
      this.sessions.set(ws, new Set(meta?.collections || []));
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      await this.handleSession(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  async handleSession(webSocket) {
    this.state.acceptWebSocket(webSocket);
    const subscribedCollections = new Set();
    this.sessions.set(webSocket, subscribedCollections);
    webSocket.serializeAttachment({ collections: [] });
  }

  async webSocketMessage(ws, messageStr) {
    try {
      const message = JSON.parse(messageStr);
      const { id, collection, method, params } = message;

      if (method === 'auth') {
        // Auth not implemented - just acknowledge
        return;
      }

      if (!COLLECTIONS.includes(collection)) {
        ws.send(
          JSON.stringify({
            id,
            collection,
            result: { error: `Unknown collection: ${collection}` },
          }),
        );
        return;
      }

      if (method === 'masterChangeStream$') {
        // Subscribe to change stream for this collection
        const subs = this.sessions.get(ws);
        if (subs) {
          subs.add(collection);
          ws.serializeAttachment({
            collections: Array.from(subs),
          });
        }
        return;
      }

      if (method === 'masterChangesSince') {
        const result = this.handleMasterChangesSince(
          collection,
          params[0],
          params[1],
        );
        ws.send(JSON.stringify({ id, collection, result }));
        return;
      }

      if (method === 'masterWrite') {
        const result = this.handleMasterWrite(collection, params[0]);
        ws.send(JSON.stringify({ id, collection, result }));

        // Broadcast changes to other subscribed clients
        this.broadcastChanges(ws, collection, params[0]);
        return;
      }

      ws.send(
        JSON.stringify({
          id,
          collection,
          result: { error: `Unknown method: ${method}` },
        }),
      );
    } catch (error) {
      console.error('Error handling WS message:', error);
      ws.send(
        JSON.stringify({
          id: 'error',
          collection: '',
          result: { error: error.message },
        }),
      );
    }
  }

  webSocketClose(ws, code, reason) {
    this.sessions.delete(ws);
  }

  webSocketError(ws, error) {
    console.error('WebSocket error:', error);
    this.sessions.delete(ws);
  }

  /**
   * Handle masterChangesSince request
   *
   * Returns documents that changed after the given checkpoint.
   * Checkpoint format: { lwt: number, id: string } or null
   *
   * @param {string} collectionName
   * @param {Object|null} checkpoint
   * @param {number} batchSize
   * @returns {{ documents: Array, checkpoint: Object|null }}
   */
  handleMasterChangesSince(collectionName, checkpoint, batchSize) {
    let rows;

    if (!checkpoint) {
      // First sync - get all documents
      rows = this.sql
        .exec(
          `SELECT id, data, _deleted, _meta_lwt, _rev
           FROM "${collectionName}"
           ORDER BY _meta_lwt ASC, id ASC
           LIMIT ?`,
          batchSize || 100,
        )
        .toArray();
    } else {
      // Incremental sync - get documents after checkpoint
      rows = this.sql
        .exec(
          `SELECT id, data, _deleted, _meta_lwt, _rev
           FROM "${collectionName}"
           WHERE (_meta_lwt > ?) OR (_meta_lwt = ? AND id > ?)
           ORDER BY _meta_lwt ASC, id ASC
           LIMIT ?`,
          checkpoint.lwt,
          checkpoint.lwt,
          checkpoint.id,
          batchSize || 100,
        )
        .toArray();
    }

    const documents = rows.map((row) => {
      const doc = JSON.parse(row.data);
      doc._deleted = !!row._deleted;
      doc._meta = { lwt: row._meta_lwt };
      doc._rev = row._rev;
      return doc;
    });

    const newCheckpoint =
      documents.length > 0
        ? {
            lwt: rows[rows.length - 1]._meta_lwt,
            id: rows[rows.length - 1].id,
          }
        : checkpoint;

    return {
      documents,
      checkpoint: newCheckpoint,
    };
  }

  /**
   * Handle masterWrite request
   *
   * Accepts an array of write rows from the client.
   * Each row has: { newDocumentState, assumedMasterState }
   * Returns an array of conflict documents (empty if no conflicts).
   *
   * @param {string} collectionName
   * @param {Array} rows - Array of { newDocumentState, assumedMasterState }
   * @returns {Array} Array of conflict documents
   */
  handleMasterWrite(collectionName, rows) {
    const conflicts = [];

    for (const row of rows) {
      const newDoc = row.newDocumentState;
      const assumedMaster = row.assumedMasterState;

      // Get the primary key from the document
      const primaryKey = this.getPrimaryKey(collectionName);
      const docId = newDoc[primaryKey];

      // Check current state in database
      const existing = this.sql
        .exec(
          `SELECT id, data, _deleted, _meta_lwt, _rev
           FROM "${collectionName}"
           WHERE id = ?`,
          docId,
        )
        .toArray();

      if (existing.length > 0) {
        const currentDoc = JSON.parse(existing[0].data);
        const currentRev = existing[0]._rev;

        // Check for conflict: if assumed master state doesn't match current
        if (assumedMaster) {
          const assumedRev = assumedMaster._rev;
          if (currentRev && assumedRev && currentRev !== assumedRev) {
            // Conflict! Return the current state
            currentDoc._deleted = !!existing[0]._deleted;
            currentDoc._meta = { lwt: existing[0]._meta_lwt };
            currentDoc._rev = currentRev;
            conflicts.push(currentDoc);
            continue;
          }
        } else {
          // No assumed master state but document exists - conflict
          // Unless it was deleted
          if (!existing[0]._deleted) {
            currentDoc._deleted = false;
            currentDoc._meta = { lwt: existing[0]._meta_lwt };
            currentDoc._rev = currentRev;
            conflicts.push(currentDoc);
            continue;
          }
        }
      }

      // No conflict - write the document
      const lwt = newDoc._meta?.lwt || Date.now();
      const rev = newDoc._rev || `${lwt}-${docId}`;
      const deleted = newDoc._deleted ? 1 : 0;

      // Clean document data (remove internal fields before storing)
      const cleanDoc = { ...newDoc };
      delete cleanDoc._meta;
      delete cleanDoc._rev;
      delete cleanDoc._deleted;
      delete cleanDoc._attachments;

      this.sql.exec(
        `INSERT OR REPLACE INTO "${collectionName}"
         (id, data, _deleted, _meta_lwt, _rev)
         VALUES (?, ?, ?, ?, ?)`,
        docId,
        JSON.stringify(cleanDoc),
        deleted,
        lwt,
        rev,
      );
    }

    return conflicts;
  }

  /**
   * Broadcast changes to all subscribed WebSocket clients except the sender
   */
  broadcastChanges(senderWs, collectionName, rows) {
    const event = {
      documents: rows.map((row) => {
        const doc = row.newDocumentState;
        return doc;
      }),
      checkpoint: {
        lwt: Date.now(),
        id: rows[rows.length - 1]?.newDocumentState?.[
          this.getPrimaryKey(collectionName)
        ],
      },
    };

    for (const [ws, subs] of this.sessions.entries()) {
      if (ws !== senderWs && subs.has(collectionName)) {
        try {
          ws.send(
            JSON.stringify({
              id: 'stream',
              collection: collectionName,
              result: event,
            }),
          );
        } catch (e) {
          // Client disconnected
          this.sessions.delete(ws);
        }
      }
    }
  }

  /**
   * Get the primary key field name for a collection
   */
  getPrimaryKey(collectionName) {
    const keys = {
      messages: 'messageId',
      reactions: 'id',
      channels: 'channel',
      pins: 'messageId',
      room_settings: 'key',
    };
    return keys[collectionName] || 'id';
  }
}

/**
 * Fetch handler for routing to the RxDB DO
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export function getRxdbReplicationFetch(bindingName) {
  return async (request, env) => {
    const url = new URL(request.url);
    // Extract path after /api/rxdb/ to use as DO name
    const pathParts = url.pathname
      .replace(/^\/api\/rxdb\/?/, '')
      .split('/')
      .filter(Boolean);
    const roomName = pathParts[0] || 'default';

    const id = env[bindingName].idFromName(roomName);
    const stub = env[bindingName].get(id);

    const newUrl = new URL(request.url);
    newUrl.pathname = '/' + pathParts.slice(1).join('/');

    return stub.fetch(new Request(newUrl.toString(), request));
  };
}
