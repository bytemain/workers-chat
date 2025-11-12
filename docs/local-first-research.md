# Local-First Architecture Research: RxDB + Cloudflare Workers

## Executive Summary

This document explores the feasibility of implementing a **local-first architecture** for the Workers Chat application using **RxDB** (a reactive, offline-first database) synchronized with **Cloudflare Workers Durable Objects** (with SQLite storage).

### Key Findings

✅ **Technically Feasible**: RxDB can be integrated with Cloudflare Durable Objects using HTTP replication protocol  
✅ **Good Fit**: The current architecture already has many local-first principles (E2EE, WebSockets)  
⚠️ **Moderate Complexity**: Requires significant architectural changes and careful implementation  
⚠️ **Trade-offs**: Adds client complexity and storage overhead for improved offline capabilities

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [What is Local-First?](#what-is-local-first)
3. [RxDB Overview](#rxdb-overview)
4. [Integration Architecture](#integration-architecture)
5. [Benefits](#benefits)
6. [Challenges & Limitations](#challenges--limitations)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Comparison: Current vs Local-First](#comparison-current-vs-local-first)
9. [Recommendations](#recommendations)
10. [References](#references)

---

## Current Architecture Analysis

### Existing Components

**Backend (Cloudflare Workers + Durable Objects)**:
- ✅ Each chat room is a Durable Object with SQLite storage
- ✅ Real-time communication via WebSocket Hibernation API
- ✅ Messages stored in SQLite tables (`messages`, `threads`, `pinned_messages`, etc.)
- ✅ File storage via R2 buckets
- ✅ Rate limiting via separate Durable Objects

**Frontend**:
- ✅ End-to-End Encryption (E2EE) using Web Crypto API
- ✅ Client-side encryption/decryption (zero-knowledge server)
- ✅ Message caching in memory (Map-based)
- ❌ No persistent client-side database
- ❌ No offline capabilities (requires constant connection)
- ❌ Full reload = loss of message cache

### Local-First Principles Already Present

1. **E2EE**: Messages encrypted client-side before sending to server
2. **Key Management**: LocalStorage-based key persistence with TTL
3. **Crypto Worker Pool**: Multi-threaded encryption for performance
4. **Real-time Sync**: WebSocket-based message broadcasting

### Gaps

1. **No Offline Support**: Cannot read/write messages without connection
2. **No Client Persistence**: Refresh = reload all messages from server
3. **No Conflict Resolution**: Server is source of truth
4. **No Client-Side Querying**: All data queries go through server

---

## What is Local-First?

**Local-First** is a software architecture pattern where:

1. **Local Storage First**: Data is stored on the client device (IndexedDB, SQLite)
2. **Instant UI Updates**: All interactions happen against local data (zero latency)
3. **Sync in Background**: Changes sync to server asynchronously
4. **Offline-Capable**: Full app functionality without internet connection
5. **Conflict Resolution**: Client and server states can diverge and reconcile

### Core Principles

```
┌─────────────────┐
│   User Action   │
└────────┬────────┘
         │ (1) Write to local DB (instant)
         ▼
┌─────────────────┐
│   RxDB (Local)  │ ◄──► Observable UI (instant update)
└────────┬────────┘
         │ (2) Sync to server (async)
         ▼
┌─────────────────┐
│  Cloudflare DO  │
│   (SQLite)      │
└─────────────────┘
```

**Key Insight**: User never waits for network. UI updates instantly from local database.

---

## RxDB Overview

### What is RxDB?

**RxDB** is a reactive, offline-first database for JavaScript applications:

- **Storage**: Built on IndexedDB (browser) or other adapters
- **Reactive**: Uses RxJS observables for real-time data updates
- **Schema Validation**: JSON Schema for type safety
- **Replication**: Built-in protocols for syncing with remote servers
- **Encryption**: Web Crypto API for at-rest encryption
- **Multi-Tab**: Automatic synchronization across browser tabs
- **Conflict Resolution**: CRDTs or custom resolution strategies

### RxDB Architecture

```javascript
// 1. Create database
const db = await createRxDatabase({
  name: 'chatdb',
  storage: getRxStorageIndexedDB()
});

// 2. Add collections with schema
await db.addCollections({
  messages: {
    schema: messageSchema,
    encryption: ['message'] // Encrypt specific fields
  }
});

// 3. Query reactively
db.messages
  .find({ channel: 'general' })
  .sort({ timestamp: 'desc' })
  .$ // Observable
  .subscribe(messages => {
    // UI auto-updates when data changes
  });

// 4. Insert/update (instant local write)
await db.messages.insert({
  id: 'msg-123',
  message: 'Hello',
  timestamp: Date.now()
});

// 5. Replication (background sync)
await db.messages.syncHTTP({
  url: 'https://api.example.com/replicate',
  push: { handler: pushHandler },
  pull: { handler: pullHandler }
});
```

### Key Features for Our Use Case

1. **IndexedDB Storage**: Large storage (hundreds of MB), structured data
2. **Encryption Plugin**: Field-level encryption using Web Crypto API
3. **HTTP Replication**: Sync with Cloudflare DO via REST endpoints
4. **Multi-Tab Sync**: All browser tabs share same local database
5. **Reactive Queries**: UI components subscribe to data changes
6. **Conflict Resolution**: Last-write-wins or custom strategies

---

## Integration Architecture

### Proposed Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Browser (Client)                       │
│                                                            │
│  ┌────────────┐      ┌──────────────┐                     │
│  │   UI (Reef) │◄────►│ RxDB Database│                     │
│  │  Components │      │  (IndexedDB)  │                     │
│  └────────────┘      └───────┬──────┘                     │
│                              │                             │
│                              │ Reactive Queries            │
│                              ▼                             │
│                      ┌──────────────┐                      │
│                      │ Collections:  │                      │
│                      │ - messages    │                      │
│                      │ - threads     │                      │
│                      │ - channels    │                      │
│                      │ - pins        │                      │
│                      └───────┬──────┘                      │
│                              │                             │
│                              │ HTTP Replication            │
└──────────────────────────────┼─────────────────────────────┘
                               │
                               │ REST API (/replicate/pull, /push)
                               ▼
┌──────────────────────────────────────────────────────────┐
│              Cloudflare Worker (Router)                   │
└───────────────────────────┬──────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│         Durable Object: ChatRoom (per room)               │
│                                                            │
│  ┌────────────────────────────────────────┐              │
│  │  SQLite Database                        │              │
│  │  - messages table                       │              │
│  │  - threads table                        │              │
│  │  - channels table                       │              │
│  │  - pins table                           │              │
│  └────────────────────────────────────────┘              │
│                                                            │
│  HTTP Endpoints:                                          │
│  - GET  /replicate/pull?checkpoint={...}                  │
│  - POST /replicate/push (batch of changes)                │
│  - GET  /replicate/pull/stream (SSE for live updates)     │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

#### **Read Flow** (Local-First)

```
User opens chat → RxDB queries IndexedDB → UI renders instantly
                         ↓
                  Background: Sync with server
                         ↓
                  New messages pulled → RxDB updates → UI auto-refreshes
```

#### **Write Flow** (Optimistic Updates)

```
User sends message → RxDB writes to IndexedDB → UI updates instantly
                              ↓
                       Background: Push to server
                              ↓
                       Server persists → Broadcast to other users
```

#### **Sync Protocol** (RxDB HTTP Replication)

**Pull (Client → Server)**:
```http
GET /api/room/{roomName}/replicate/pull?checkpoint={lastTimestamp}&batchSize=50

Response:
{
  "documents": [
    { "id": "msg-123", "message": "...", "timestamp": 1699999999 },
    ...
  ],
  "checkpoint": { "timestamp": 1700000000 }
}
```

**Push (Server → Client)**:
```http
POST /api/room/{roomName}/replicate/push

Body:
[
  { "id": "msg-456", "message": "...", "timestamp": 1700000001 },
  ...
]
```

**Stream (Real-Time Updates)**:
```http
GET /api/room/{roomName}/replicate/pull/stream

Response (Server-Sent Events):
data: {"id": "msg-789", "message": "...", "timestamp": 1700000002}
```

---

## Benefits

### 1. **Instant UI Responsiveness** ⚡
- **Current**: Message send → Network round-trip → UI update (100-500ms latency)
- **Local-First**: Message send → IndexedDB write → UI update (1-10ms latency)
- **Impact**: 10-50x faster perceived performance

### 2. **Offline Support** 📴
- **Current**: No connection = app unusable
- **Local-First**: Full read/write capability offline, sync when reconnected
- **Use Cases**:
  - Poor network (mobile, rural areas)
  - Intermittent connectivity (tunnels, flights)
  - Deliberate offline work (drafting messages)

### 3. **Reduced Server Load** 🚀
- **Current**: Every message view = WebSocket or HTTP request to server
- **Local-First**: Reads from local IndexedDB, only sync deltas
- **Impact**: 
  - ~70-90% reduction in read requests
  - Lower Durable Object duration costs (fewer wake-ups)
  - Better scalability for large chat rooms

### 4. **Better Multi-Tab Experience** 🖥️
- **Current**: Each tab = separate WebSocket connection, separate state
- **Local-First**: All tabs share same RxDB instance
- **Impact**: Unified state, automatic cross-tab sync

### 5. **Progressive Enhancement** 📈
- **Current**: Binary online/offline state
- **Local-First**: Graceful degradation (always usable, sync when possible)

### 6. **Faster Page Load** 🏎️
- **Current**: Load → Fetch all messages from server → Decrypt → Render
- **Local-First**: Load → Read from IndexedDB → Render (cached decrypted data)
- **Impact**: ~50-80% faster initial render for returning users

### 7. **Data Persistence** 💾
- **Current**: Page refresh = reload all data
- **Local-First**: Persistent local cache across sessions

---

## Challenges & Limitations

### 1. **Encryption Complexity** 🔐

**Current System**:
- Messages encrypted client-side before sending
- Server stores ciphertext
- Client decrypts on receive

**With RxDB**:
- RxDB has encryption plugin, BUT:
  - **Problem**: RxDB encrypts fields at rest in IndexedDB
  - **Our Need**: Encrypt before sending to server (E2EE)
  - **Solution**: Two-layer encryption:
    1. **E2EE Layer**: Encrypt message content for server (current system)
    2. **RxDB Layer**: Encrypt IndexedDB storage (RxDB plugin)

**Implementation Approach**:
```javascript
// Before insert into RxDB
const e2eeEncrypted = await encryptMessage(plaintext, roomKey);

// RxDB stores with additional at-rest encryption
await db.messages.insert({
  id: 'msg-123',
  message: e2eeEncrypted, // Already encrypted for E2EE
  timestamp: Date.now()
  // RxDB plugin encrypts entire document for IndexedDB
});

// On read
const doc = await db.messages.findOne('msg-123').exec();
// RxDB plugin decrypts IndexedDB storage
const plaintext = await decryptMessage(doc.message, roomKey);
// Decrypt E2EE layer
```

**Limitations**:
- ❌ **Cannot query encrypted fields efficiently** in RxDB
- ❌ **Full-text search** requires decrypting all messages
- ✅ **Can query by**: id, timestamp, channel (unencrypted indexes)

### 2. **Storage Quotas** 💽

**IndexedDB Limits**:
- **Chrome**: ~60% of available disk (can be ~20-80GB)
- **Firefox**: ~2GB default
- **Safari/iOS**: ~1GB (strict eviction policies)
- **Mobile**: Often much lower, aggressive eviction

**Implications**:
- Large chat rooms (10k+ messages) may hit limits on mobile
- Need eviction/pruning strategy (e.g., keep only recent 1000 messages locally)
- Users must be notified if quota exceeded

**Mitigation**:
```javascript
// Implement local pruning
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
```

### 3. **Sync Complexity** 🔄

**Challenges**:
- **Conflict Resolution**: Multiple devices editing same message
- **Checkpoint Management**: Tracking last synced state per client
- **Network Failures**: Retry logic, partial sync recovery
- **Deletion Handling**: Tombstones vs hard deletes

**RxDB Provides**:
- ✅ Checkpoint-based pull replication
- ✅ Push batching
- ✅ Conflict detection (last-write-wins by default)
- ⚠️ Custom conflict resolution requires implementation

**Our Implementation**:
```javascript
// Define conflict handler
const replication = db.messages.syncHTTP({
  url: '/api/room/myroom/replicate',
  pull: { ... },
  push: { ... },
  conflictHandler: async (conflicts) => {
    // Strategy: Server always wins (since it's E2EE, we trust timestamps)
    return conflicts.map(conflict => ({
      isEqual: false,
      documentData: conflict.remoteDocumentState
    }));
  }
});
```

### 4. **Initial Sync Performance** 🐌

**Problem**: Large rooms (10k+ messages) = slow initial sync

**Solutions**:
1. **Pagination**: Pull in batches of 100-500 messages
2. **Lazy Loading**: Only sync recent messages initially
3. **Background Sync**: Use Web Workers for sync operations
4. **Incremental Indexing**: Build indexes progressively

```javascript
// Phased sync strategy
async function initialSync(db, roomName) {
  // Phase 1: Recent messages (last 100)
  await syncRecent(db, roomName, 100);
  
  // Phase 2: Background sync of history
  requestIdleCallback(async () => {
    await syncHistory(db, roomName);
  });
}
```

### 5. **Migration Complexity** 🔧

**Current Users**:
- No local database
- All data on server

**Migration Path**:
1. Deploy with RxDB as optional (feature flag)
2. On first load: Initial sync from server
3. Subsequent loads: Use local + incremental sync
4. Gradual rollout with monitoring

### 6. **Debugging & Observability** 🔍

**Challenges**:
- Client-side database state harder to inspect than server logs
- Sync failures may be silent
- Conflict resolution issues hard to reproduce

**Solutions**:
- RxDB has built-in dev tools
- Add telemetry for sync errors
- Server-side logging of replication requests

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goals**: Set up RxDB infrastructure without breaking existing functionality

1. **Add RxDB Dependencies**
   ```bash
   npm install rxdb rxjs
   ```

2. **Create RxDB Schema**
   ```javascript
   // src/ui/db/schema.mjs
   export const messageSchema = {
     version: 0,
     primaryKey: 'id',
     type: 'object',
     properties: {
       id: { type: 'string', maxLength: 100 },
       messageId: { type: 'string' },
       timestamp: { type: 'number' },
       username: { type: 'string' },
       message: { type: 'string' }, // Encrypted
       channel: { type: 'string' },
       replyToId: { type: 'string' }
     },
     required: ['id', 'timestamp', 'username', 'message', 'channel'],
     indexes: ['timestamp', 'channel']
   };
   ```

3. **Initialize Database**
   ```javascript
   // src/ui/db/init.mjs
   import { createRxDatabase } from 'rxdb';
   import { getRxStorageIndexedDB } from 'rxdb/plugins/storage-indexeddb';
   import { messageSchema } from './schema.mjs';
   
   export async function initDatabase(roomName) {
     const db = await createRxDatabase({
       name: `chat_${roomName}`,
       storage: getRxStorageIndexedDB()
     });
     
     await db.addCollections({
       messages: { schema: messageSchema }
     });
     
     return db;
   }
   ```

4. **Feature Flag**
   ```javascript
   // Enable local-first mode via URL param
   const useLocalFirst = new URLSearchParams(location.search).get('localFirst') === 'true';
   ```

### Phase 2: Read Path (Week 3-4)

**Goals**: Use RxDB for reading messages, fallback to WebSocket

1. **Implement Pull Replication Endpoint**
   ```javascript
   // src/api/chat.mjs (Durable Object)
   app.get('/replicate/pull', async (c) => {
     const { checkpoint, batchSize } = c.req.query;
     const lastTimestamp = checkpoint ? JSON.parse(checkpoint).timestamp : 0;
     
     const messages = this.sql
       .exec(`
         SELECT * FROM messages 
         WHERE timestamp > ?
         ORDER BY timestamp ASC
         LIMIT ?
       `, [lastTimestamp, batchSize || 100])
       .toArray();
     
     const newCheckpoint = messages.length > 0
       ? { timestamp: messages[messages.length - 1].timestamp }
       : checkpoint;
     
     return c.json({ documents: messages, checkpoint: newCheckpoint });
   });
   ```

2. **Client-Side Pull Logic**
   ```javascript
   // src/ui/db/replication.mjs
   export async function setupPullReplication(db, roomName) {
     const pullHandler = async (checkpoint, batchSize) => {
       const url = `/api/room/${roomName}/replicate/pull?` +
         `checkpoint=${encodeURIComponent(JSON.stringify(checkpoint || {}))}&` +
         `batchSize=${batchSize}`;
       
       const response = await fetch(url);
       return await response.json();
     };
     
     return db.messages.syncHTTP({
       url: `/api/room/${roomName}/replicate`,
       pull: { handler: pullHandler, batchSize: 100 }
     });
   }
   ```

3. **Update UI to Read from RxDB**
   ```javascript
   // src/ui/index.mjs
   if (useLocalFirst) {
     // Reactive query
     db.messages
       .find({ channel: currentChannel })
       .sort({ timestamp: 'desc' })
       .limit(100)
       .$
       .subscribe(messages => {
         renderMessages(messages);
       });
   } else {
     // Existing WebSocket-based rendering
   }
   ```

### Phase 3: Write Path (Week 5-6)

**Goals**: Write messages to RxDB first, sync to server

1. **Implement Push Replication Endpoint**
   ```javascript
   // src/api/chat.mjs
   app.post('/replicate/push', async (c) => {
     const docs = await c.req.json();
     
     for (const doc of docs) {
       // Upsert into SQLite
       this.sql.exec(`
         INSERT INTO messages (message_id, timestamp, username, message, channel)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           message = excluded.message,
           edited_at = excluded.timestamp
       `, [doc.messageId, doc.timestamp, doc.username, doc.message, doc.channel]);
     }
     
     // Broadcast to WebSocket clients
     this.broadcast({ type: 'new_messages', messages: docs });
     
     return c.json({ success: true });
   });
   ```

2. **Client-Side Push Logic**
   ```javascript
   export async function setupPushReplication(db, roomName) {
     const pushHandler = async (docs) => {
       await fetch(`/api/room/${roomName}/replicate/push`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(docs)
       });
     };
     
     return db.messages.syncHTTP({
       url: `/api/room/${roomName}/replicate`,
       push: { handler: pushHandler, batchSize: 50 }
     });
   }
   ```

3. **Optimistic Message Sending**
   ```javascript
   // User sends message
   async function sendMessage(message) {
     const doc = {
       id: generateUUID(),
       messageId: generateUUID(),
       timestamp: Date.now(),
       username: currentUser,
       message: await encryptMessage(message, roomKey),
       channel: currentChannel
     };
     
     // Write to RxDB (instant UI update)
     await db.messages.insert(doc);
     
     // Replication will handle syncing to server
   }
   ```

### Phase 4: Real-Time Sync (Week 7-8)

**Goals**: Live updates via Server-Sent Events

1. **Server-Side SSE Endpoint**
   ```javascript
   app.get('/replicate/pull/stream', async (c) => {
     const stream = new ReadableStream({
       start: (controller) => {
         // Listen for new messages on this DO
         const listener = (data) => {
           const message = `data: ${JSON.stringify(data)}\n\n`;
           controller.enqueue(new TextEncoder().encode(message));
         };
         
         this.addEventListener('new_message', listener);
         
         // Cleanup
         c.req.signal.addEventListener('abort', () => {
           this.removeEventListener('new_message', listener);
           controller.close();
         });
       }
     });
     
     return new Response(stream, {
       headers: {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-cache'
       }
     });
   });
   ```

2. **Client-Side SSE Consumer**
   ```javascript
   export function setupLiveReplication(db, roomName) {
     const eventSource = new EventSource(
       `/api/room/${roomName}/replicate/pull/stream`
     );
     
     eventSource.onmessage = async (event) => {
       const doc = JSON.parse(event.data);
       
       // Upsert into RxDB
       await db.messages.upsert(doc);
     };
   }
   ```

### Phase 5: Optimization (Week 9-10)

1. **Add Encryption Plugin**
   ```javascript
   import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';
   
   const db = await createRxDatabase({
     name: `chat_${roomName}`,
     storage: wrappedKeyEncryptionCryptoJsStorage({
       storage: getRxStorageIndexedDB()
     }),
     password: await deriveStoragePassword(roomName) // Separate from E2EE key
   });
   ```

2. **Implement Pruning Strategy**
3. **Add Telemetry/Monitoring**
4. **Performance Testing & Tuning**

---

## Comparison: Current vs Local-First

| Feature | Current Architecture | Local-First with RxDB |
|---------|---------------------|----------------------|
| **Message Read** | WebSocket/HTTP → Server | IndexedDB (instant) |
| **Message Write** | WebSocket → Server → Broadcast | IndexedDB → Sync background |
| **Offline Support** | ❌ None | ✅ Full read/write |
| **Page Load** | Fetch all from server | Load from IndexedDB cache |
| **Multi-Tab** | Separate connections | Shared IndexedDB |
| **Latency (Read)** | 100-500ms (network) | 1-10ms (local) |
| **Latency (Write)** | 100-500ms (network) | 1-10ms (local) + async sync |
| **Storage** | Server only | Client (IndexedDB) + Server |
| **Complexity** | Low | Medium-High |
| **Server Load** | High (all reads) | Low (sync only) |
| **E2EE** | ✅ Yes | ✅ Yes (two-layer) |
| **Conflict Resolution** | N/A (server is source) | Required (timestamp-based) |

---

## Recommendations

### ✅ **Recommended: Hybrid Approach**

Implement local-first **progressively** with fallbacks:

1. **Phase 1 (MVP)**: 
   - Add RxDB for read-side caching
   - Keep WebSocket for writes
   - Benefits: Faster load, reduced server reads
   - Complexity: Low

2. **Phase 2**:
   - Enable optimistic writes to RxDB
   - Sync via HTTP push/pull
   - Benefits: Offline writes, instant UI
   - Complexity: Medium

3. **Phase 3**:
   - Add SSE for real-time sync
   - Full conflict resolution
   - Benefits: Complete local-first experience
   - Complexity: High

### 🎯 **Target Use Cases**

**High Priority**:
- Mobile users with poor connectivity
- Users who frequently refresh/reload
- Power users with large message history

**Lower Priority**:
- Desktop users with stable connection
- Small chat rooms (<100 messages)

### ⚠️ **Not Recommended If**:

- Team size < 3 developers (maintenance burden)
- Chat rooms mostly ephemeral (no need for history)
- Users primarily on iOS Safari (strict storage limits)

---

## Alternative Approaches

### Option 1: **Dexie.js** (Simpler than RxDB)

**Pros**:
- Lightweight wrapper over IndexedDB
- No reactive layer (simpler)
- Better TypeScript support

**Cons**:
- No built-in replication
- Manual sync implementation needed
- Less features (no encryption plugin, etc.)

### Option 2: **PouchDB** (Mature, CouchDB-compatible)

**Pros**:
- Battle-tested replication protocol
- Large ecosystem
- Compatible with CouchDB backends

**Cons**:
- Not reactive (requires manual observers)
- Larger bundle size
- Revision tracking overhead

### Option 3: **IndexedDB + Custom Sync** (Full Control)

**Pros**:
- Minimal dependencies
- Full customization
- Smallest bundle size

**Cons**:
- Most implementation work
- Need to solve all problems RxDB solves
- Higher maintenance burden

---

## Technical Considerations

### Bundle Size Impact

| Library | Minified + Gzipped | Notes |
|---------|-------------------|-------|
| RxDB Core | ~45KB | Basic functionality |
| + IndexedDB Plugin | +12KB | Storage adapter |
| + Replication Plugin | +18KB | HTTP sync |
| + Encryption Plugin | +25KB | Field encryption |
| **Total** | **~100KB** | Significant but acceptable |

**Mitigation**:
- Code-split RxDB (load only when needed)
- Use tree-shaking
- Lazy-load replication features

### Performance Characteristics

**IndexedDB Read Performance**:
- Single document: 1-5ms
- Query 100 documents: 10-50ms
- Query 1000 documents: 50-200ms

**RxDB Overhead**:
- Schema validation: +1-2ms per operation
- Observable emission: +0.5ms
- Encryption: +5-20ms per document

**Network Savings**:
- Typical message: ~500 bytes
- 100 messages: ~50KB
- Saved per page load: ~50KB - 500KB (depending on history)

---

## Security Considerations

### 1. **Two-Layer Encryption**

```
Plaintext Message
    ↓ E2EE Encryption (current system)
Ciphertext for Server
    ↓ RxDB Storage Encryption
Encrypted IndexedDB Entry
```

**Keys**:
- **E2EE Key**: Derived from room password (shared across devices)
- **Storage Key**: Device-specific (derived from room ID + device ID)

**Rationale**: 
- E2EE protects data in transit and at rest on server
- Storage encryption protects IndexedDB from local attacks (malware, browser extensions)

### 2. **Key Management**

**Current**: Keys in LocalStorage with 5min TTL  
**Proposed**: Keep same system, but also derive storage key

```javascript
// E2EE key (existing)
const e2eeKey = await deriveKeyFromPassword(password, roomId);

// Storage key (new, device-specific)
const deviceId = localStorage.getItem('deviceId') || generateUUID();
const storageKey = await deriveKey(roomId + deviceId);
```

### 3. **Quota Exhaustion Attacks**

**Risk**: Malicious actor floods chat with messages to exhaust client storage

**Mitigation**:
- Server-side rate limiting (already exists)
- Client-side pruning (keep only N messages)
- User notification on quota pressure

---

## Open Questions & Decisions Needed

### 1. **Scope of Local Storage**

**Option A**: Store all messages  
**Pros**: Full offline access  
**Cons**: Storage quota issues

**Option B**: Store recent messages (e.g., last 1000)  
**Pros**: Controlled storage usage  
**Cons**: Incomplete history offline

**Recommendation**: Option B with user-configurable limit

### 2. **Conflict Resolution Strategy**

**Option A**: Last-write-wins (timestamp)  
**Option B**: Server always wins  
**Option C**: Manual merge UI

**Recommendation**: Option A for most fields, Option B for critical data (pins, etc.)

### 3. **Backwards Compatibility**

**Option A**: Dual-mode (feature flag)  
**Option B**: Gradual rollout (% of users)  
**Option C**: Hard cutover

**Recommendation**: Option A for 1-2 months, then Option C

---

## References

### RxDB Documentation
- [Official Docs](https://rxdb.info/)
- [HTTP Replication Guide](https://rxdb.info/replication-http.html)
- [Encryption Plugin](https://rxdb.info/encryption.html)
- [Zero Latency Local-First](https://rxdb.info/articles/zero-latency-local-first.html)

### Cloudflare Resources
- [Durable Objects SQLite Storage](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [Durable Objects SQL API](https://developers.cloudflare.com/durable-objects/api/storage/sql/)
- [One Database Per User Pattern](https://boristane.com/blog/durable-objects-database-per-user/)

### Related Discussions
- [RxDB + Cloudflare DO Issue](https://github.com/pubkey/rxdb/issues/7435)
- [Local-First Software Principles](https://www.inkandswitch.com/local-first/)

---

## Next Steps

### Immediate (This Week)
1. ✅ Complete research document
2. ⬜ Share with team for feedback
3. ⬜ Decide on implementation scope (MVP vs full)

### Short-Term (Next 2 Weeks)
1. ⬜ Spike: Build minimal RxDB integration in feature branch
2. ⬜ Performance testing with large message sets
3. ⬜ Evaluate bundle size impact

### Long-Term (Next Quarter)
1. ⬜ Phased rollout plan
2. ⬜ Monitoring/telemetry strategy
3. ⬜ Migration guide for existing users

---

## Conclusion

Implementing a local-first architecture with RxDB and Cloudflare Durable Objects is **technically feasible** and offers significant benefits for user experience (instant UI, offline support, reduced latency). However, it requires careful implementation to handle:

1. **Two-layer encryption** (E2EE + storage encryption)
2. **Storage quota management** (pruning, eviction)
3. **Sync complexity** (conflict resolution, checkpoints)
4. **Migration path** (for existing users)

**Recommended Approach**: Start with a **hybrid model** (RxDB for read-side caching, WebSocket for writes) and progressively add optimistic writes and full sync as the system matures. This minimizes risk while delivering immediate benefits.

**Decision Point**: Team should evaluate:
- Available engineering resources (2-3 months initial implementation)
- User pain points (offline usage, poor connectivity)
- Long-term maintenance commitment
- Trade-offs vs. alternative improvements (better caching, service worker, etc.)

---

**Document Version**: 1.0  
**Last Updated**: 2025-11-12  
**Author**: Copilot Workspace Research  
**Status**: Draft for Review
