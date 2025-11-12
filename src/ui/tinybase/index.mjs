import { createStore } from 'tinybase';
import { createMergeableStore } from 'tinybase';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';
import { api } from '../api.mjs';

export async function createTinybaseStorage(roomName) {
  const tinybaseStore = createMergeableStore();
  const syncUrl = api.getTinybaseSyncUrl(roomName);
  const syncer = await createWsSynchronizer(
    tinybaseStore,
    new WebSocket(syncUrl),
  );
  syncer.startSync();
  return tinybaseStore;
}
