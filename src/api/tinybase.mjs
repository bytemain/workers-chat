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
