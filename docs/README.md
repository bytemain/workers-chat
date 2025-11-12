# Workers Chat Documentation

This directory contains research, guides, and documentation for the Workers Chat project.

## Contents

### Research Documents

- **[local-first-research.md](./local-first-research.md)** - Comprehensive research on implementing local-first architecture with RxDB and Cloudflare Workers (English)
- **[local-first-research-zh.md](./local-first-research-zh.md)** - Local-first 可行性研究总结 (Chinese summary)

### Implementation Guides

- **[rxdb-integration-guide.md](./rxdb-integration-guide.md)** - Quick reference guide for RxDB integration with code examples

## Local-First Architecture Research

### Overview

Investigation into the feasibility of implementing a local-first architecture for Workers Chat using:
- **RxDB**: Reactive, offline-first database for the client
- **Cloudflare Durable Objects**: Server-side SQLite storage with HTTP replication

### Key Findings

✅ **Technically Feasible**: RxDB can integrate with Cloudflare Durable Objects using HTTP replication protocol

**Benefits**:
- ⚡ 10-50x faster UI responsiveness (1-10ms vs 100-500ms)
- 📴 Full offline read/write capabilities
- 🚀 ~70-90% reduction in server read requests
- 💾 Persistent client-side cache across sessions

**Challenges**:
- 🔐 Dual-layer encryption complexity (E2EE + IndexedDB)
- 💽 Browser storage quota management (especially mobile)
- 🔄 Sync protocol and conflict resolution
- 🐌 Initial sync performance for large rooms

### Recommended Approach

**Hybrid Progressive Implementation**:

1. **Phase 1** (Low complexity): RxDB for read-side caching, WebSocket for writes
2. **Phase 2** (Medium complexity): Optimistic writes to RxDB with HTTP sync
3. **Phase 3** (High complexity): Server-Sent Events for real-time sync

### Quick Links

- [Full Research Document](./local-first-research.md) - Detailed analysis, architecture diagrams, code examples
- [中文总结](./local-first-research-zh.md) - Chinese summary and recommendations
- [Integration Guide](./rxdb-integration-guide.md) - Code snippets and implementation reference

## Architecture Diagrams

### Proposed Data Flow

```
Browser (Client)
├── UI Components (Reef.js)
│   └── Subscribe to RxDB queries (reactive updates)
├── RxDB Database (IndexedDB)
│   ├── messages collection
│   ├── threads collection
│   └── channels collection
└── HTTP Replication Protocol
    ├── GET /replicate/pull (fetch changes)
    ├── POST /replicate/push (send changes)
    └── GET /replicate/pull/stream (real-time SSE)
        ↓
Cloudflare Worker (Router)
        ↓
Durable Object: ChatRoom (per room)
└── SQLite Database
    ├── messages table
    ├── threads table
    └── other tables
```

### Read Flow (Zero Latency)

```
User opens chat 
  → RxDB queries IndexedDB 
  → UI renders instantly (1-10ms)
  → Background sync from server
  → RxDB updates 
  → UI auto-refreshes
```

### Write Flow (Optimistic Updates)

```
User sends message 
  → RxDB writes to IndexedDB 
  → UI updates instantly (1-10ms)
  → Background push to server
  → Server persists and broadcasts
```

## Implementation Roadmap

### Phase 1: Foundation (1-2 weeks)
- Add RxDB dependencies
- Create database schemas
- Initialize RxDB instance
- Add feature flag

### Phase 2: Read Path (3-4 weeks)
- Implement server pull endpoint
- Configure client pull replication
- UI reads from RxDB (reactive)
- Keep WebSocket as fallback

### Phase 3: Write Path (5-6 weeks)
- Implement server push endpoint
- Configure client push replication
- Optimistic updates: write RxDB first, sync background

### Phase 4: Real-Time Sync (7-8 weeks)
- Server-Sent Events (SSE) for live updates
- Client listens to SSE and updates RxDB

### Phase 5: Optimization (9-10 weeks)
- Add encryption plugin (dual-layer)
- Implement message pruning strategy
- Monitoring and telemetry
- Performance testing and tuning

## Technical Considerations

### Bundle Size Impact

| Library | Minified + Gzipped | Notes |
|---------|-------------------|-------|
| RxDB Core | ~45KB | Basic functionality |
| + IndexedDB Plugin | +12KB | Storage adapter |
| + Replication Plugin | +18KB | HTTP sync |
| + Encryption Plugin | +25KB | Field encryption |
| **Total** | **~100KB** | Significant but acceptable |

### Performance Characteristics

**IndexedDB Read Performance**:
- Single document: 1-5ms
- Query 100 documents: 10-50ms
- Query 1000 documents: 50-200ms

**Network Savings**:
- Typical message: ~500 bytes
- 100 messages: ~50KB
- Saved per page load: 50KB - 500KB (depending on history)

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

**Document Version**: 1.0  
**Last Updated**: 2025-11-12  
**Status**: Research complete, awaiting team decision on implementation
