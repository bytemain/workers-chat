import { createMergeableStore } from 'tinybase';
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage';
import {
  WsServerDurableObject,
  getWsServerDurableObjectFetch,
} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';

export class TinyBaseStorageDurableObject extends WsServerDurableObject {
  onPathId(pathId, addedOrRemoved) {
    console.info((addedOrRemoved ? 'Added' : 'Removed') + ` path ${pathId}`);
  }

  onClientId(pathId, clientId, addedOrRemoved) {
    console.info(
      (addedOrRemoved ? 'Added' : 'Removed') +
        ` client ${clientId} on path ${pathId}`,
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'DELETE' && url.pathname === '/clear') {
      return this.clearAllData();
    }
    return super.fetch(request);
  }

  async clearAllData() {
    try {
      const sql = this.ctx.storage.sql;

      // Drop all TinyBase tables (fragmented mode uses workers_chat_* prefix)
      const tables = [
        ...sql.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'workers_chat%'",
        ),
      ];
      const validName = /^workers_chat[_a-zA-Z0-9]*$/;
      for (const row of tables) {
        if (validName.test(row.name)) {
          sql.exec(`DROP TABLE IF EXISTS "${row.name}"`);
        }
      }

      // Close all active WebSocket connections so clients reconnect with clean state
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'Data cleared');
        } catch (_) {}
      }

      console.info('TinyBase data cleared successfully');
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Failed to clear TinyBase data:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  createPersister() {
    const store = createMergeableStore();
    const persister = createDurableObjectSqlStoragePersister(
      store,
      this.ctx.storage.sql,
      {
        storeTableName: 'workers_chat',
        storagePrefix: 'workers_chat_',
        mode: 'fragmented',
      },
      (sql, params) => console.log('SQL:', sql, params),
      (error) => console.error('Persistence error:', error),
    );
    return persister;
  }
}
export const fetch = getWsServerDurableObjectFetch('tinybase');
