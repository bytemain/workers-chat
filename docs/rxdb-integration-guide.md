# RxDB + Cloudflare Workers Integration Quick Reference

## Quick Start

This guide provides code snippets and configuration for integrating RxDB with Cloudflare Durable Objects.

---

## Installation

```bash
npm install rxdb rxjs
```

---

## Basic Setup

### 1. Database Schema

```javascript
// src/ui/db/schema.mjs
export const messageSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    messageId: { type: 'string' },
    timestamp: { 
      type: 'number',
      minimum: 0,
      maximum: 10000000000000,
      multipleOf: 1 
    },
    username: { type: 'string' },
    message: { type: 'string' }, // E2EE encrypted
    channel: { type: 'string' },
    replyToId: { type: 'string' },
    editedAt: { type: 'number' }
  },
  required: ['id', 'messageId', 'timestamp', 'username', 'message', 'channel'],
  indexes: [
    'timestamp',
    'channel',
    ['channel', 'timestamp'] // Compound index
  ]
};
```

### 2. Initialize Database

```javascript
// src/ui/db/init.mjs
import { createRxDatabase } from 'rxdb';
import { getRxStorageIndexedDB } from 'rxdb/plugins/storage-indexeddb';
import { messageSchema } from './schema.mjs';

export async function initDatabase(roomName) {
  const db = await createRxDatabase({
    name: `chat_${roomName}`,
    storage: getRxStorageIndexedDB(),
    multiInstance: true, // Multi-tab support
    eventReduce: true // Performance optimization
  });

  await db.addCollections({
    messages: { 
      schema: messageSchema,
      methods: {
        // Custom method: Decrypt message
        async getPlaintext(roomKey) {
          return await decryptMessage(this.message, roomKey);
        }
      }
    }
  });

  return db;
}
```

### 3. Replication Setup

```javascript
// src/ui/db/replication.mjs
import { replicateRxCollection } from 'rxdb/plugins/replication';

export async function setupReplication(db, roomName) {
  const replicationState = await replicateRxCollection({
    collection: db.messages,
    replicationIdentifier: `chat-${roomName}`,
    live: true, // Enable live sync
    
    // Pull from server
    pull: {
      async handler(lastCheckpoint, batchSize) {
        const checkpoint = lastCheckpoint || { timestamp: 0 };
        const url = `/api/room/${roomName}/replicate/pull?` +
          `checkpoint=${encodeURIComponent(JSON.stringify(checkpoint))}&` +
          `batchSize=${batchSize}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        return {
          documents: data.documents,
          checkpoint: data.checkpoint
        };
      },
      batchSize: 100
    },
    
    // Push to server
    push: {
      async handler(docs) {
        await fetch(`/api/room/${roomName}/replicate/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(docs)
        });
      },
      batchSize: 50
    }
  });

  // Monitor replication state
  replicationState.active$.subscribe(active => {
    console.log('Replication active:', active);
  });

  replicationState.error$.subscribe(error => {
    console.error('Replication error:', error);
  });

  return replicationState;
}
```

---

## Server-Side Endpoints (Durable Object)

### Pull Endpoint

```javascript
// src/api/chat.mjs
app.get('/replicate/pull', async (c) => {
  const checkpointParam = c.req.query('checkpoint');
  const batchSizeParam = c.req.query('batchSize');
  
  const checkpoint = checkpointParam 
    ? JSON.parse(checkpointParam) 
    : { timestamp: 0 };
  const batchSize = parseInt(batchSizeParam) || 100;
  
  // Query messages since checkpoint
  const messages = this.sql
    .exec(`
      SELECT 
        message_id as id,
        message_id as messageId,
        timestamp,
        username,
        message,
        channel,
        reply_to_id as replyToId,
        edited_at as editedAt
      FROM messages
      WHERE timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?
    `, [checkpoint.timestamp, batchSize])
    .toArray();
  
  // New checkpoint
  const newCheckpoint = messages.length > 0
    ? { timestamp: messages[messages.length - 1].timestamp }
    : checkpoint;
  
  return c.json({
    documents: messages,
    checkpoint: newCheckpoint
  });
});
```

### Push Endpoint

```javascript
app.post('/replicate/push', async (c) => {
  const docs = await c.req.json();
  
  // Validate and insert/update
  for (const doc of docs) {
    this.sql.exec(`
      INSERT INTO messages (
        message_id, timestamp, username, message, 
        channel, reply_to_id, edited_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        message = excluded.message,
        edited_at = excluded.edited_at
    `, [
      doc.messageId,
      doc.timestamp,
      doc.username,
      doc.message,
      doc.channel,
      doc.replyToId || null,
      doc.editedAt || null,
      doc.timestamp
    ]);
  }
  
  // Broadcast to WebSocket clients
  this.broadcast({
    type: 'replicate_push',
    messages: docs
  });
  
  return c.json({ success: true, count: docs.length });
});
```

### Stream Endpoint (SSE)

```javascript
app.get('/replicate/pull/stream', async (c) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  // Handler for new messages
  const messageHandler = (data) => {
    if (data.type === 'new_message' || data.type === 'replicate_push') {
      const messages = Array.isArray(data.messages) 
        ? data.messages 
        : [data];
      
      for (const msg of messages) {
        const sseMessage = `data: ${JSON.stringify(msg)}\n\n`;
        writer.write(encoder.encode(sseMessage));
      }
    }
  };
  
  // Subscribe to broadcasts
  this.on('broadcast', messageHandler);
  
  // Cleanup on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    this.off('broadcast', messageHandler);
    writer.close();
  });
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
});
```

---

## Client-Side Usage

### Query Messages (Reactive)

```javascript
// src/ui/index.mjs
import { initDatabase } from './db/init.mjs';
import { setupReplication } from './db/replication.mjs';

// Initialize
const db = await initDatabase('my-room-123');
const replication = await setupReplication(db, 'my-room-123');

// Reactive query - UI auto-updates when data changes
db.messages
  .find({ channel: 'general' })
  .sort({ timestamp: 'desc' })
  .limit(100)
  .$ // Observable
  .subscribe(messages => {
    renderMessages(messages);
  });
```

### Send Message (Optimistic)

```javascript
async function sendMessage(text, channel) {
  const encrypted = await encryptMessage(text, roomKey);
  
  // Write to local DB first (instant UI update)
  await db.messages.insert({
    id: generateUUID(),
    messageId: generateUUID(),
    timestamp: Date.now(),
    username: currentUser,
    message: encrypted,
    channel: channel,
    replyToId: null,
    editedAt: null
  });
  
  // Replication will sync to server automatically
}
```

### Edit Message

```javascript
async function editMessage(messageId, newText) {
  const encrypted = await encryptMessage(newText, roomKey);
  
  const message = await db.messages.findOne(messageId).exec();
  
  await message.update({
    $set: {
      message: encrypted,
      editedAt: Date.now()
    }
  });
  
  // Replication will sync to server
}
```

### Delete Message

```javascript
async function deleteMessage(messageId) {
  const message = await db.messages.findOne(messageId).exec();
  await message.remove();
  
  // Replication will sync to server
}
```

---

## Advanced Features

### Storage Pruning

```javascript
// Keep only recent messages to avoid quota issues
async function pruneOldMessages(db, maxMessages = 1000) {
  const count = await db.messages.count().exec();
  
  if (count > maxMessages) {
    const toDelete = count - maxMessages;
    const oldMessages = await db.messages
      .find()
      .sort({ timestamp: 'asc' })
      .limit(toDelete)
      .exec();
    
    await Promise.all(oldMessages.map(msg => msg.remove()));
  }
}

// Run periodically
setInterval(() => pruneOldMessages(db), 60000); // Every minute
```

### Encryption Plugin

```javascript
import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';

const db = await createRxDatabase({
  name: `chat_${roomName}`,
  storage: wrappedKeyEncryptionCryptoJsStorage({
    storage: getRxStorageIndexedDB()
  }),
  password: await deriveStoragePassword(roomName)
});
```

### Conflict Resolution

```javascript
const replicationState = await replicateRxCollection({
  collection: db.messages,
  replicationIdentifier: `chat-${roomName}`,
  // ... other config ...
  
  conflictHandler: async (conflicts) => {
    // Strategy: Server always wins
    return conflicts.map(conflict => ({
      isEqual: false,
      documentData: conflict.remoteDocumentState
    }));
    
    // Alternative: Last-write-wins
    // return conflicts.map(conflict => {
    //   const localTime = conflict.localDocumentState.timestamp;
    //   const remoteTime = conflict.remoteDocumentState.timestamp;
    //   return {
    //     isEqual: false,
    //     documentData: remoteTime > localTime 
    //       ? conflict.remoteDocumentState 
    //       : conflict.localDocumentState
    //   };
    // });
  }
});
```

---

## Monitoring & Debugging

### Replication State

```javascript
// Monitor sync status
replication.active$.subscribe(active => {
  if (active) {
    console.log('Syncing...');
    showSyncIndicator();
  } else {
    console.log('Sync complete');
    hideSyncIndicator();
  }
});

// Monitor errors
replication.error$.subscribe(error => {
  console.error('Sync error:', error);
  showErrorNotification(error.message);
});

// Monitor received documents
replication.received$.subscribe(docs => {
  console.log(`Received ${docs.length} documents from server`);
});

// Monitor sent documents
replication.sent$.subscribe(docs => {
  console.log(`Sent ${docs.length} documents to server`);
});
```

### Database Events

```javascript
// Listen to all inserts
db.messages.insert$.subscribe(change => {
  console.log('Message inserted:', change.documentData);
});

// Listen to all updates
db.messages.update$.subscribe(change => {
  console.log('Message updated:', change.documentData);
});

// Listen to all removes
db.messages.remove$.subscribe(change => {
  console.log('Message removed:', change.documentId);
});
```

### RxDB DevTools

```javascript
// Enable in development
if (process.env.NODE_ENV === 'development') {
  import('rxdb/plugins/dev-mode').then(module => {
    const { addRxPlugin } = await import('rxdb');
    addRxPlugin(module);
  });
}
```

---

## Performance Tips

### 1. Batch Operations

```javascript
// Bad: Multiple individual inserts
for (const msg of messages) {
  await db.messages.insert(msg);
}

// Good: Bulk insert
await db.messages.bulkInsert(messages);
```

### 2. Lazy Queries

```javascript
// Only query when needed
const lazyQuery$ = db.messages
  .find({ channel })
  .sort({ timestamp: 'desc' })
  .limit(100)
  .$;

// Subscribe only when user opens channel
if (channelIsVisible) {
  const subscription = lazyQuery$.subscribe(renderMessages);
  
  // Unsubscribe when user leaves
  onChannelClose(() => subscription.unsubscribe());
}
```

### 3. Index Optimization

```javascript
// Use compound indexes for common queries
const messageSchema = {
  // ...
  indexes: [
    'timestamp',
    'channel',
    ['channel', 'timestamp'], // For channel-specific time queries
    ['username', 'timestamp'] // For user-specific time queries
  ]
};
```

---

## Migration Strategy

### Feature Flag Approach

```javascript
// Enable via URL parameter
const params = new URLSearchParams(location.search);
const useLocalFirst = params.get('localFirst') === 'true';

if (useLocalFirst) {
  // Use RxDB
  const db = await initDatabase(roomName);
  const replication = await setupReplication(db, roomName);
  // ... RxDB-based rendering
} else {
  // Use existing WebSocket approach
  const ws = new WebSocket(getWebSocketUrl(roomName));
  // ... WebSocket-based rendering
}
```

### Gradual Rollout

```javascript
// Enable for percentage of users
const userId = getUserId();
const hash = hashCode(userId);
const enableForUser = (hash % 100) < 10; // 10% of users

if (enableForUser) {
  // Use RxDB
}
```

---

## Troubleshooting

### Common Issues

**1. Quota Exceeded**
```javascript
db.messages.insert(doc).catch(error => {
  if (error.name === 'QuotaExceededError') {
    // Prune old messages
    await pruneOldMessages(db, 500);
    // Retry
    await db.messages.insert(doc);
  }
});
```

**2. Sync Not Working**
```javascript
// Check replication state
console.log('Active:', await replication.active$.pipe(first()).toPromise());
console.log('Error:', await replication.error$.pipe(first()).toPromise());

// Manually trigger sync
await replication.reSync();
```

**3. Schema Migration**
```javascript
// When schema changes, increment version
const messageSchema = {
  version: 1, // Incremented from 0
  // ...
  migrationStrategies: {
    // Migrate from version 0 to 1
    1: (oldDoc) => {
      oldDoc.newField = 'default value';
      return oldDoc;
    }
  }
};
```

---

## References

- [RxDB Documentation](https://rxdb.info/)
- [Replication Guide](https://rxdb.info/replication-http.html)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Full Research Document](./local-first-research.md)
- [中文研究文档](./local-first-research-zh.md)
