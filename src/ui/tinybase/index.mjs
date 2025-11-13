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

  // Create indexes for efficient querying with O(log n) performance
  const indexes = createIndexes(store);

  // Index 1: Messages by channel (for fast channel switching)
  // Groups messages by channel and sorts by timestamp
  indexes.setIndexDefinition(
    'messagesByChannel', // indexId
    'messages', // tableId
    'channel', // sliceId (group by channel)
    'timestamp', // sort by timestamp (chronological order)
  );

  // Index 2: Thread replies by parent message ID
  // Groups all replies to the same parent message, sorted by timestamp
  indexes.setIndexDefinition(
    'repliesByParent', // indexId
    'messages', // tableId
    'replyToId', // sliceId (group by parent message ID)
    'timestamp', // sort by timestamp (chronological order in thread)
  );

  // Index 3: Messages by user (for user-specific views)
  indexes.setIndexDefinition(
    'messagesByUser', // indexId
    'messages', // tableId
    'username', // sliceId (group by user)
    'timestamp', // sort by timestamp
  );

  console.log(
    '📇 Created TinyBase indexes: messagesByChannel, repliesByParent, messagesByUser',
  );

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
