# Local-First Architecture Diagrams

## Current vs Proposed Architecture

### Current Architecture (WebSocket-Based)

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│                                                           │
│  ┌──────────────────┐                                    │
│  │  UI Components   │                                    │
│  │   (Reef.js)      │                                    │
│  └────────┬─────────┘                                    │
│           │                                               │
│           │ Direct render from WebSocket events          │
│           ▼                                               │
│  ┌──────────────────┐                                    │
│  │  Memory Cache    │◄─── Temporary, lost on refresh    │
│  │   (Map-based)    │                                    │
│  └────────┬─────────┘                                    │
│           │                                               │
│           │ WebSocket (real-time)                        │
│           │ + HTTP (initial load)                        │
└───────────┼─────────────────────────────────────────────┘
            │
            │ Network latency: 100-500ms
            ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Worker                           │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│         Durable Object: ChatRoom                         │
│                                                           │
│  ┌────────────────────────────────────────────────────┐ │
│  │  SQLite Database (Source of Truth)                  │ │
│  │  - messages                                         │ │
│  │  - threads                                          │ │
│  │  - channels                                         │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  WebSocket Sessions (Hibernation API)                    │
└─────────────────────────────────────────────────────────┘

Characteristics:
✅ Simple architecture
✅ Real-time updates
❌ No offline support
❌ High latency for reads/writes
❌ All data lost on refresh
❌ High server load (every read = network request)
```

### Proposed Architecture (Local-First with TinyBase + Workbox)

```
┌──────────────────────────────────────────────────────────┐
│                    Browser (Client)                       │
│                                                            │
│  ┌──────────────────┐                                     │
│  │  UI Components   │                                     │
│  │   (Reef.js)      │                                     │
│  └────────┬─────────┘                                     │
│           │                                                │
│           │ Reactive subscriptions (instant)              │
│           ▼                                                │
│  ┌──────────────────┐                                     │
│  │   TinyBase Store │◄─── Persistent across sessions     │
│  │   (IndexedDB)    │                                     │
│  │                  │                                     │
│  │  Collections:    │                                     │
│  │  - messages      │                                     │
│  │  - threads       │                                     │
│  │  - channels      │                                     │
│  │  - pins          │                                     │
│  └────────┬─────────┘                                     │
│           │                                                │
│           │ Local read/write: 1-10ms                      │
│           │ Background sync (HTTP + SSE)                  │
└───────────┼────────────────────────────────────────────────┘
            │
            │ Sync protocol (pull/push)
            │ Network latency: only for sync, not UI
            ▼
┌──────────────────────────────────────────────────────────┐
│              Cloudflare Worker (Router)                   │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│         Durable Object: ChatRoom (per room)               │
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  SQLite Database (Sync Target)                      │  │
│  │  - messages                                         │  │
│  │  - threads                                          │  │
│  │  - channels                                         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  Replication Endpoints:                                   │
│  - GET  /replicate/pull (checkpoint-based)                │
│  - POST /replicate/push (batch changes)                   │
│  - GET  /replicate/pull/stream (SSE live updates)         │
└──────────────────────────────────────────────────────────┘

Characteristics:
✅ Instant UI updates (1-10ms)
✅ Full offline support
✅ Persistent cache
✅ Multi-tab sync
✅ Reduced server load (~70-90%)
⚠️ More complex (dual-layer encryption)
⚠️ Storage quota management needed
```

---

## Data Flow Comparison

### Current: Read Message Flow

```
User scrolls to view messages
        ↓
Check memory cache
        ↓
Cache miss → WebSocket/HTTP request
        ↓
Wait for network (100-500ms)
        ↓
Receive encrypted messages
        ↓
Decrypt in main thread
        ↓
Render UI
        ↓
Update memory cache

Total: 100-500ms
```

### Proposed: Read Message Flow

```
User scrolls to view messages
        ↓
Query TinyBase (IndexedDB)
        ↓
Retrieve encrypted messages (1-10ms)
        ↓
Decrypt in main thread
        ↓
Render UI (instant)
        ↓
        │
        └──→ Background: Check for updates
                ↓
            Pull from server (if online)
                ↓
            Update TinyBase
                ↓
            UI auto-refreshes (reactive)

Total: 1-10ms (perceived instant)
Background sync: async, no user wait
```

### Current: Write Message Flow

```
User types message
        ↓
Encrypt message
        ↓
Send via WebSocket
        ↓
Wait for server (100-500ms)
        ↓
Server persists to SQLite
        ↓
Server broadcasts to all clients
        ↓
UI updates

Total: 100-500ms user wait
```

### Proposed: Write Message Flow

```
User types message
        ↓
Encrypt message
        ↓
Insert into TinyBase (local)
        ↓
UI updates immediately (1-10ms)
        ↓
        │
        └──→ Background: Sync to server
                ↓
            Push via HTTP
                ↓
            Server persists to SQLite
                ↓
            Server broadcasts to other clients
                ↓
            Other clients pull update via SSE
                ↓
            Other clients update TinyBase
                ↓
            Other UIs auto-refresh

Total: 1-10ms user wait
Background sync: async, reliable
```

---

## Sync Protocol Details

### Pull Replication (Client pulls from Server)

```
Client                                  Server
  │                                       │
  │  GET /replicate/pull?                 │
  │  checkpoint={"timestamp": 1699999999} │
  │  batchSize=100                        │
  │──────────────────────────────────────→│
  │                                       │
  │                      Query SQLite     │
  │                      WHERE timestamp  │
  │                      > checkpoint     │
  │                      LIMIT 100        │
  │                                       │
  │  {                                    │
  │    "documents": [                     │
  │      {...}, {...}, ...                │
  │    ],                                 │
  │    "checkpoint": {                    │
  │      "timestamp": 1700000000          │
  │    }                                  │
  │  }                                    │
  │←──────────────────────────────────────│
  │                                       │
  │  Insert/update in TinyBase               │
  │  (IndexedDB)                          │
  │                                       │
  │  UI auto-refreshes                   │
  │  (reactive subscription)             │
  │                                       │
```

### Push Replication (Client pushes to Server)

```
Client                                  Server
  │                                       │
  │  User creates/edits message          │
  │  ↓                                    │
  │  Insert into TinyBase                    │
  │  ↓                                    │
  │  UI updates (instant)                │
  │  ↓                                    │
  │  POST /replicate/push                 │
  │  [                                    │
  │    {                                  │
  │      "id": "msg-123",                 │
  │      "message": "...",                │
  │      "timestamp": 1700000001          │
  │    },                                 │
  │    ...                                │
  │  ]                                    │
  │──────────────────────────────────────→│
  │                                       │
  │                      Validate         │
  │                      ↓                │
  │                      Insert/update    │
  │                      SQLite           │
  │                      ↓                │
  │                      Broadcast to     │
  │                      other clients    │
  │                                       │
  │  { "success": true }                  │
  │←──────────────────────────────────────│
  │                                       │
```

### Live Sync (Server-Sent Events)

```
Client                                  Server
  │                                       │
  │  GET /replicate/pull/stream           │
  │──────────────────────────────────────→│
  │                                       │
  │  Connection open (SSE)                │
  │←──────────────────────────────────────│
  │                                       │
  │                         Listen for    │
  │                         new messages  │
  │                                       │
  │         ╔══════════════╗              │
  │         ║ New message  ║              │
  │         ║ arrives from ║              │
  │         ║ other client ║              │
  │         ╚══════════════╝              │
  │                                       │
  │  data: {"id": "msg-456", ...}         │
  │←──────────────────────────────────────│
  │                                       │
  │  Upsert into TinyBase                    │
  │  ↓                                    │
  │  UI auto-refreshes                   │
  │  (reactive)                           │
  │                                       │
```

---

## Encryption Layers

### Current System (Single-Layer E2EE)

```
Plaintext Message: "Hello World"
        ↓
    E2EE Encryption (Web Crypto API)
    Key: Room password derived
        ↓
Ciphertext: "xK9mP2..."
        ↓
    Send to Server (WebSocket)
        ↓
Server stores ciphertext (zero-knowledge)
        ↓
    Broadcast to other clients
        ↓
Client receives ciphertext
        ↓
    E2EE Decryption
        ↓
Plaintext Message: "Hello World"
```

### Proposed System (Dual-Layer Encryption)

```
Plaintext Message: "Hello World"
        ↓
    Layer 1: E2EE Encryption (Web Crypto API)
    Key: Room password derived (shared)
        ↓
E2EE Ciphertext: "xK9mP2..."
        ↓
    Store in TinyBase
        ↓
    Layer 2: TinyBase Storage Encryption
    Key: Device-specific derived key
        ↓
Storage Ciphertext: "aB3cD4..."
        ↓
    Write to IndexedDB
        ↓
        │
        └──→ Sync to server: Send E2EE ciphertext
                ↓
            Server stores E2EE ciphertext
                ↓
            Other clients receive E2EE ciphertext
                ↓
            Layer 1: E2EE Decryption
                ↓
            Plaintext Message: "Hello World"
                ↓
            Layer 2: TinyBase Storage Encryption
                ↓
            Write to their IndexedDB

Benefits:
- E2EE protects data in transit and on server
- Storage encryption protects local IndexedDB from:
  * Malicious browser extensions
  * Local malware
  * Physical device access
```

---

## Storage Quota Management

### Problem: IndexedDB Limits

```
Browser             Quota           Notes
─────────────────────────────────────────────────────────
Chrome              ~60% disk       20-80GB typical
Firefox             ~2GB            Default limit
Safari/iOS          ~1GB            Aggressive eviction
Mobile Chrome       ~1-5GB          Varies by device
Mobile Safari       ~50-500MB       Very strict
```

### Solution: Automatic Pruning

```
┌─────────────────────────────────────────┐
│  TinyBase Database                           │
│                                          │
│  Current: 1200 messages                 │
│  Limit:   1000 messages                 │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ Pruning Strategy:                  │ │
│  │                                    │ │
│  │ 1. Count messages                  │ │
│  │    → 1200 > 1000                   │ │
│  │                                    │ │
│  │ 2. Sort by timestamp (oldest)      │ │
│  │                                    │ │
│  │ 3. Delete oldest 200 messages      │ │
│  │    → Keep most recent 1000         │ │
│  │                                    │ │
│  │ 4. User can still access full      │ │
│  │    history from server (HTTP)      │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Result: 1000 messages (within quota)   │
└─────────────────────────────────────────┘

Benefits:
✅ Never exceed quota
✅ Most relevant (recent) data cached
✅ Full history still available on server
✅ Configurable by user preference
```

---

## Conflict Resolution

### Scenario: Offline Edit Conflict

```
Device A (Online)          Server           Device B (Offline → Online)
    │                        │                       │
    │                        │                       │
    │  Edit msg-123          │                       │ Goes offline
    │  "Hello" → "Hi"        │                       │
    │────────────────────────→│                       │
    │                        │                       │
    │                   Update DB                    │
    │                   timestamp: 100               │
    │                        │                       │
    │                        │                       │ Edit msg-123
    │                        │                       │ "Hello" → "Hey"
    │                        │                       │ Local timestamp: 99
    │                        │                       │
    │                        │                       │ Comes back online
    │                        │                       │ Push changes
    │                        │←──────────────────────│
    │                        │                       │
    │                   Conflict!                    │
    │                   Server: "Hi" @ 100           │
    │                   Client: "Hey" @ 99           │
    │                        │                       │
    │                   Resolution:                  │
    │                   Last-write-wins              │
    │                   (timestamp)                  │
    │                   → Keep "Hi" @ 100            │
    │                        │                       │
    │                   Reject "Hey"                 │
    │                        │──────────────────────→│
    │                        │   Send "Hi" @ 100     │
    │                        │                       │
    │                        │                       │ Update local DB
    │                        │                       │ "Hey" → "Hi"
    │                        │                       │ UI auto-refreshes

Strategies:
1. Last-write-wins (timestamp) - Default
2. Server-always-wins - For critical data
3. Manual merge UI - For important conflicts
```

---

## Performance Impact

### Latency Comparison

```
Operation          Current (WebSocket)    Proposed (TinyBase)    Improvement
─────────────────────────────────────────────────────────────────────
Read message       100-500ms              1-10ms             10-50x
Write message      100-500ms              1-10ms             10-50x
Page load          2-5s (fetch all)       0.5-1s (cache)     2-5x
Search/filter      500ms (server)         10-50ms (local)    10-50x
Offline access     ❌ Not possible        ✅ Full access      ∞
```

### Network Traffic Reduction

```
Scenario: User opens chat room with 500 messages

Current Architecture:
─────────────────────────────────────────────
Initial load:  500 messages × 500 bytes  = 250KB
Every reload:  500 messages × 500 bytes  = 250KB
10 reloads:    10 × 250KB               = 2.5MB

Proposed Architecture:
─────────────────────────────────────────────
Initial load:  500 messages × 500 bytes  = 250KB (IndexedDB)
Reload 1:      0 messages (from cache)   = 0KB
Reload 2:      5 new messages            = 2.5KB (sync only)
Reload 3:      3 new messages            = 1.5KB (sync only)
...
10 reloads:    ~20KB (only new messages) = 20KB

Total savings: 2.5MB - 20KB = ~99% reduction
```

### Server Load Reduction

```
Current: All reads go to server
─────────────────────────────────────────
100 users × 10 reads/min = 1000 requests/min
→ Durable Object wakes up 1000 times/min
→ High duration costs

Proposed: Only syncs go to server
─────────────────────────────────────────
100 users × 1 sync/5min = 20 requests/min
→ Durable Object wakes up 20 times/min
→ ~98% reduction in wake-ups
→ ~98% reduction in duration costs
```

---

## Migration Strategy

### Phase 1: Feature Flag (Week 1-2)

```
User visits chat
    ↓
Check URL param: ?localFirst=true
    ↓
    ├─→ Yes: Initialize TinyBase
    │        Set up replication
    │        Render with reactive queries
    │
    └─→ No:  Use existing WebSocket
             Render with current code

Benefits:
✅ Zero risk (fallback always available)
✅ Can test with subset of users
✅ Easy rollback
```

### Phase 2: Gradual Rollout (Week 3-4)

```
function shouldEnableLocalFirst(userId) {
  const hash = hashCode(userId);
  
  // Enable for 10% of users
  if (hash % 100 < 10) return true;
  
  // Enable for beta testers
  if (betaUsers.includes(userId)) return true;
  
  return false;
}

Benefits:
✅ Monitor performance/errors
✅ Gather user feedback
✅ Identify edge cases
```

### Phase 3: Full Rollout (Week 5+)

```
All users → TinyBase enabled by default
    ↓
Monitor metrics:
- IndexedDB quota errors
- Sync failures
- Performance improvements
    ↓
Remove feature flag code
    ↓
Deploy as standard

Benefits:
✅ All users get benefits
✅ Simplified codebase
✅ No fallback needed
```

---

**Document Version**: 1.0  
**Last Updated**: 2025-11-12  
**For**: Workers Chat Local-First Research
