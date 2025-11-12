import { createStore } from 'tinybase';
import { createMergeableStore } from 'tinybase';
import { createLocalPersister } from 'tinybase/persisters/persister-browser';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';
import { api } from '../api.mjs';
import { run } from 'ruply';
import ReconnectingWebSocket from '@opensumi/reconnecting-websocket';

export async function createTinybaseStorage(roomName) {
  const store = createMergeableStore();
  const syncUrl = api.getTinybaseSyncUrl(roomName);
  await run(
    createLocalPersister(store, 'local://tinybase_storage/' + roomName),
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
  return store;
}
