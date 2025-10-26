# Copilot Instructions for Workers Chat

## Project Overview

This is a real-time chat application running 100% on Cloudflare's edge using **Workers**, **Durable Objects**, and **R2 storage**. The key architectural insight: **Durable Objects coordinate WebSocket connections and manage per-room state** without traditional servers.

## Core Architecture

### 1. Durable Objects Pattern (Critical)

**Each chat room is a separate Durable Object instance** (`ChatRoom` class in `src/api/chat.mjs`):
- Single-threaded, strongly consistent per-room state
- WebSocket connections use **Hibernation API** to reduce duration billing
- Sessions survive hibernation via `serializeAttachment()`/`deserializeAttachment()`
- Storage is simple KV: timestamps as keys, message JSON as values

**Key insight**: The Worker (`src/api/chat.mjs` export default) routes requests to Durable Object stubs:
```javascript
// Room ID routing logic (line ~75-90)
let id = name.match(/^[0-9a-f]{64}$/) 
  ? env.rooms.idFromString(name)  // Private rooms: 64-char hex ID
  : env.rooms.idFromName(name);   // Public rooms: derive ID from name
```

### 2. WebSocket Hibernation Pattern

Unlike typical WebSocket servers, idle connections don't keep the DO in memory:
- `state.acceptWebSocket(webSocket)` - accept with hibernation support
- `webSocketMessage()`, `webSocketClose()`, `webSocketError()` - lifecycle handlers
- Session metadata attached via `serializeAttachment()` (must be structured-cloneable)
- DO wakes up only when messages arrive, dramatically reducing costs

**Important**: Don't store non-cloneable objects (functions, DO stubs) in attachments. Store limiter ID as string, recreate stub on wake.

### 3. File Upload Flow

Files go to **R2 bucket** (`CHAT_FILES` binding), not Durable Object storage:
1. Client uploads to `/api/room/:name/upload` (POST with FormData)
2. Worker generates UUID filename, stores in R2
3. Message sent as `FILE:{url}|{name}|{type}` format
4. Client renders with lazy-loading custom element (`<lazy-img>`)

**Critical**: Rate limiter checks happen BEFORE R2 upload to prevent abuse.

### 4. Rate Limiting Architecture

Each IP gets its own `RateLimiter` Durable Object (separate namespace):
- Uses "cooldown" pattern: allows burst, then enforces delay
- 10 messages/second baseline, 300-second grace period
- State stored in memory only (resets on eviction = acceptable)
- Multiple rooms share same limiter (global IP rate limit)

## Development Workflows

### Local Development
```bash
npm run dev          # Start Wrangler dev server (Workers + DO + R2 local)
npm run ui           # Build UI (RNA bundler, outputs to dist/ui/)
npm run ui:prod      # Build minified UI for production
```

**Important**: Wrangler automatically runs `npm run ui` on file changes (configured in `wrangler.toml` `[build]` section).

### Deployment
```bash
wrangler deploy      # Deploy to Cloudflare (requires auth)
```

**Note**: First-time setup requires enabling Durable Objects in Cloudflare dashboard.

## Key Code Patterns

### Adding New Message Types

Messages are JSON strings sent over WebSocket. To add a new type:

1. **Client sends** (in `src/ui/index.mjs`):
```javascript
webSocket.send(JSON.stringify({
  message: "YOUR_PREFIX:data",
  messageId: generateUUID(),
  replyTo: {...}  // optional
}));
```

2. **Server receives** (in `ChatRoom.webSocketMessage()`):
```javascript
// Parse, validate, add timestamp
data.timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
// Broadcast to all sessions
this.broadcast(JSON.stringify(data));
// Store in DO storage
await this.storage.put(new Date(data.timestamp).toISOString(), data);
```

3. **Client renders** (extend `ChatMessage.renderTextMessage()` or add new method):
```javascript
if (message.startsWith("YOUR_PREFIX:")) {
  // Custom rendering logic
}
```

### Thread System (Example of Complex Feature)

Threads are stored as **separate indexes** in DO storage:
- Message keys: ISO timestamps (e.g., `2025-10-26T10:00:00.000Z`)
- Thread indexes: `thread:{messageId}` → array of reply keys
- Messages cache: `Map` of messageId → message data (client-side)

**Critical pattern**: Use GET endpoint for initial load, WebSocket for real-time updates.

## Testing & Debugging

### Inspect Durable Object State
Use `wrangler dev` + DevTools console:
```javascript
// In browser console, messages are logged
// Server logs show DO lifecycle events
```

### Common Issues

1. **WebSocket closes immediately**: Check rate limiter isn't blocking your IP
2. **Messages not persisting**: DO storage.put() must await, key must be valid
3. **Files 404**: R2 binding name must match `wrangler.toml` (`CHAT_FILES`)
4. **Hibernation issues**: Don't store functions/objects in `serializeAttachment()`

## Critical Files

- `src/api/chat.mjs` - Worker entry + ChatRoom/RateLimiter DO classes (~1000 lines)
- `src/ui/index.mjs` - Client-side app logic (~2500 lines, heavily documented)
- `wrangler.toml` - Deployment config (DO bindings, R2 bucket, assets)
- `rna.config.mjs` - RNA bundler config for UI build

## Conventions

- **Error handling**: `handleErrors()` wrapper catches exceptions, returns 500 or closes WebSocket with error frame
- **Message IDs**: UUIDs for new messages, `{timestamp}-{username}` for legacy messages
- **Storage keys**: ISO timestamps for messages, prefixes for indexes (`thread:`, `hashtag:`, etc.)
- **Custom elements**: Used extensively for UI components (`<chat-message>`, `<lazy-img>`, `<chat-input-component>`)
- **No framework**: Vanilla JS with Web Components, no React/Vue

## External Dependencies (Minimal)

- `hono` - HTTP routing framework (used in Worker and DO)
- `@zip.js/zip.js` - Export feature (ZIP all messages + R2 files)
- `@chialab/rna` - UI bundler (dev dependency)

## E2EE Plan (Future)

See `E2EE_PRD.md` for detailed end-to-end encryption design:
- Client-side encryption using Web Crypto API
- Server stores/forwards ciphertext only
- Room password → AES-256-GCM key derivation (PBKDF2)
- Verification data for password validation (client-side decryption test)
- **Important**: No server-side crypto code - server is "zero-knowledge"

## Key Design Decisions

1. **Why Durable Objects?** Per-room state coordination + WebSocket hibernation = infinite scalability at low cost
2. **Why R2 for files?** DO storage is KV, not suited for large blobs; R2 provides cheap object storage
3. **Why no database?** DO storage IS the database (strongly consistent, per-room isolation)
4. **Why custom elements?** Vanilla JS approach, no build complexity for components, progressive enhancement
5. **Why Hono?** Lightweight routing, works in both Worker and DO contexts, better DX than raw fetch()

## Performance Patterns

- **Lazy load images**: `<lazy-img>` with IntersectionObserver (reduces initial data transfer)
- **Message batching**: Load last 100 messages on join, use WebSocket for real-time
- **IndexedDB caching**: (Planned for E2EE) Store encryption keys client-side
- **Smart scrolling**: `isAtBottom` flag to prevent scroll jumps when images load

---

**Remember**: This is an edge-first architecture. Think "coordination objects" not "servers". Each DO is single-threaded but globally distributed. Embrace the constraints for massive scale.
