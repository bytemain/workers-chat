import { createStore } from 'tinybase';
import { createMergeableStore } from 'tinybase';
import { createIndexes } from 'tinybase';
import { createRelationships } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';
import { api } from '../api.mjs';
import ReconnectingWebSocket from '@opensumi/reconnecting-websocket';

/**
 * @typedef {import('tinybase').MergeableStore} MergeableStore
 * @typedef {import('tinybase').Indexes} Indexes
 * @typedef {import('tinybase').Relationships} Relationships
 */

/**
 * @returns {MergeableStore} TinyBase store instance
 */
export function getStore() {
  return window.store;
}

/**
 * @returns {Indexes} TinyBase indexes instance
 */
export function getIndexes() {
  return window.indexes;
}

/**
 * @returns {Relationships} TinyBase relationships instance
 */
export function getRelationships() {
  return window.relationships;
}

export const IndexesIds = {
  MessagesByChannel: 'messagesByChannel',
  RepliesByParent: 'repliesByParent',
  MessagesByUser: 'messagesByUser',
};

export const TableIds = {
  Messages: 'messages',
};

export async function createTinybaseStorage(roomName) {
  const storeName = TableIds.Messages;
  const store = createMergeableStore();
  window.store = store;

  const syncUrl = api.getTinybaseSyncUrl(`${storeName}/${roomName}`);

  // Create indexes for efficient querying with O(log n) performance
  const indexes = createIndexes(store);

  window.indexes = indexes;
  // Index 1: Messages by channel (for fast channel switching)
  // Groups messages by channel and sorts by timestamp
  indexes.setIndexDefinition(
    IndexesIds.MessagesByChannel, // indexId
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

  // Index 4: Reactions by message (for displaying reactions on messages)
  indexes.setIndexDefinition(
    'reactionsByMessage', // indexId
    'reaction_instances', // tableId
    'messageId', // sliceId (group by message)
    'timestamp', // sort by timestamp
  );

  // Index 5: Reactions by message + type + user (for checking if user reacted)
  indexes.setIndexDefinition(
    'reactionsByMessageAndType', // indexId
    'reaction_instances', // tableId
    (getCell) => {
      const messageId = getCell('messageId');
      const reactionId = getCell('reactionId');
      const username = getCell('username');
      return `${messageId}:${reactionId}:${username}`;
    },
  );
  console.log(
    '📇 Created TinyBase indexes: messagesByChannel, repliesByParent, messagesByUser, reactionsByMessage, reactionsByMessageAndType',
  );
  console.log(indexes.getIndexIds());

  // Create relationships for foreign key constraints
  const relationships = createRelationships(store);
  window.relationships = relationships;

  // Relationship: reaction_instances.messageId -> messages
  relationships.setRelationshipDefinition(
    'messageReactions', // relationshipId
    'reaction_instances', // localTableId (child table - reactions)
    'messages', // remoteTableId (parent table - messages)
    'messageId', // localCellId (foreign key column)
  );

  console.log('🔗 Created TinyBase relationship: messageReactions');

  // Create persister and keep reference for cleanup
  const persister = createIndexedDbPersister(
    store,
    `tinybase-${storeName}-${roomName}`,
  );
  await persister.startAutoLoad();
  await persister.startAutoSave();

  // Create synchronizer and keep reference for cleanup
  const synchronizer = await createWsSynchronizer(
    store,
    new ReconnectingWebSocket(syncUrl),
    1,
  );
  await synchronizer.startSync();

  // If the websocket reconnects in the future, do another explicit sync.
  synchronizer.getWebSocket().addEventListener('open', () => {
    synchronizer.load().then(() => synchronizer.save());
  });

  // Return cleanup function along with store
  const destroy = async () => {
    console.log('🧹 Cleaning up TinyBase resources...');
    await synchronizer.destroy();
    await persister.destroy();
    console.log('✅ TinyBase resources cleaned up');
  };

  window.tinybaseDestroy = destroy; // Save cleanup function

  window.storeUtils = {
    show: () => {
      if (window.store) {
        console.log('🔄 TinyBase store values:', window.store.getValues());
        console.log('🔄 TinyBase store tables:', window.store.getTables());
      } else {
        console.warn('⚠️ TinyBase store is not initialized yet.');
      }
    },
    debug: () => {
      // Test: Print TinyBase store tables every 5 seconds
      setInterval(() => {
        window.storeUtils.show();
      }, 5000);
    },
  };
  return { store, indexes, relationships, destroy };
}
