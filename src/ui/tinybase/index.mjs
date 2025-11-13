import { createStore } from 'tinybase';
import { createMergeableStore } from 'tinybase';
import { createIndexes } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';
import { api } from '../api.mjs';
import { run } from 'ruply';
import ReconnectingWebSocket from '@opensumi/reconnecting-websocket';

export async function createTinybaseStorage(roomName) {
  const storeName = 'messages';
  const store = createMergeableStore();
  const syncUrl = api.getTinybaseSyncUrl(`${storeName}/${roomName}`);

  // Create indexes for efficient querying
  const indexes = createIndexes(store);

  // Index 1: Messages by channel (for filtering)
  // Index 2: Sort by timestamp within each channel (for chronological order)
  indexes.setIndexDefinition(
    'messagesByChannel', // indexId
    'messages', // tableId to index
    'channel', // cellId to slice by (group by channel)
    'timestamp', // cellId to sort by (chronological order)
  );

  console.log('📇 Created TinyBase indexes: messagesByChannel');

  await run(
    createIndexedDbPersister(store, `tinybase-${storeName}-${roomName}`),
    async (persister) => {
      await persister.startAutoLoad();
      await persister.startAutoSave();
    },
  );
  await run(
    createWsSynchronizer(store, new ReconnectingWebSocket(syncUrl), 1),
    async (synchronizer) => {
      await synchronizer.startSync();

      // If the websocket reconnects in the future, do another explicit sync.
      synchronizer.getWebSocket().addEventListener('open', () => {
        synchronizer.load().then(() => synchronizer.save());
      });
    },
  );

  return { store, indexes };
}
