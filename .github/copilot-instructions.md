# Copilot Instructions for Workers Chat

## Project Overview

This is a real-time chat application running 100% on Cloudflare's edge using **Workers**, **Durable Objects**, **R2 storage**, and **SQLite** (via Durable Objects SQL API). The key architectural insight: **Durable Objects coordinate WebSocket connections and manage per-room state** without traditional servers.

`Local First` principles are applied to the frontend with **E2EE (End-to-End Encryption)** via Web Crypto API.

### UI Design Principles

- Simple, efficient, and visually appealing
- Responsive design for desktop and mobile (see `src/ui/mobile.mjs` for mobile-specific patterns)
- Compact styling (no bold titles, conscious spacing)
- All icons use [Remix Icon](https://remixicon.com/) library (use `remix-icon` MCP to get icon info)

## Core Architecture

### 1. Durable Objects Pattern (Critical)

**Each chat room is a separate Durable Object instance** (`ChatRoom` class in `src/api/chat.mjs`):

- Single-threaded, strongly consistent per-room state
- **SQLite storage** via `state.storage.sql` (migrated from KV storage - see `wrangler.toml` migrations)
- WebSocket connections use **Hibernation API** to reduce duration billing
- Sessions survive hibernation via `serializeAttachment()`/`deserializeAttachment()`

**Storage Schema**:

- Messages stored in `messages` table with indexes on `timestamp`, `channel`, `message_id`
- Thread replies tracked in `threads` table
- Hashtag indexes in `hashtags` table
- Room metadata (channels, user settings) in separate tables

**Key insight**: The Worker (`src/api/chat.mjs` export default) routes requests to Durable Object stubs:

```javascript
// Room ID routing logic (line ~75-90)
let id = name.match(/^[0-9a-f]{64}$/)
  ? env.rooms.idFromString(name) // Private rooms: 64-char hex ID
  : env.rooms.idFromName(name); // Public rooms: derive ID from name
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

### 5. Frontend Architecture

All network request logic must be written in `src/ui/api.mjs` (`ChatAPI` class):

- Uses Fetch API for REST, WebSocket API for real-time
- Handles message sending, file uploads, room joining
- Use Water.css for simple, clean styling

### 6. Reef.js Reactive Framework (Critical for New UI)

**All new UI components MUST use Reef.js** (https://reefjs.com/) - a lightweight reactive UI library:

- **Version**: v13 (loaded from CDN: `https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js`)
- **Core Concepts**:
  - `store()` - Create reactive state with actions (like Redux)
  - `component()` - Reactive components that auto-update when state changes
  - Template functions return HTML strings (not JSX)
  - Event delegation via container listeners (not inline handlers)

**Key Pattern Example** (see `src/ui/mobile/channel-info.mjs`):

```javascript
import {
  store,
  component,
} from 'https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js';

// 1. Create reactive store with actions
const myState = store(
  {
    isOpen: false,
    activeTab: 'messages',
    data: [],
  },
  {
    // Actions mutate state
    open(state, param) {
      state.isOpen = true;
    },
    switchTab(state, tabName) {
      state.activeTab = tabName;
    },
  },
  'myStateSignal', // Signal name for component subscription
);

// 2. Template function (returns HTML string)
function myTemplate() {
  const state = myState.value;
  if (!state.isOpen) return '';

  return `
    <div class="my-component">
      <button data-action="close">Close</button>
      <div class="content">${state.data.map((item) => `...`).join('')}</div>
    </div>
  `;
}

// 3. Create component (auto-renders on state change)
const myComponent = component(containerElement, myTemplate, {
  signals: ['myStateSignal'],
});

// 4. Event delegation (outside component)
containerElement.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action="close"]');
  if (btn) {
    event.preventDefault();
    myState.close(); // Call action
  }
});
```

**Critical Rules**:

- **Never use inline event handlers** in templates (`onclick="..."` breaks after re-render)
- **Use data attributes** for event delegation (`data-action`, `data-tab`, `data-message-id`)
- **Call actions to mutate state**, never mutate directly
- **Template functions must be pure** - no side effects
- **Signal names** must match between store and component for reactivity

**Mobile UI Pattern** (see `src/ui/mobile/channel-info.mjs` for reference):

- Full-screen overlay pages (z-index: 2000)
- URL-based state management (`?info=open&tab=pins`)
- Browser history integration (`pushState`/`popstate`)
- Tab navigation with data loading
- Loading/error/empty states in templates

### 7. URL State Management (Critical for Sharing)

**All important UI state MUST be reflected in the URL** - this enables deep linking and sharing:

**Why URL State?**

- Users can share specific views (room, channel, thread, pinned message)
- Browser back/forward buttons work naturally
- State persists across page refreshes
- Mobile-friendly navigation patterns

**URL Structure Pattern**:

```
/room/{roomName}?channel={channelName}&tab={tabName}&thread={messageId}&msg={messageId}
```

**URL State Sync Utility** (`src/ui/utils/url-state-sync.mjs`):

**Automatic bidirectional sync** between Reef.js store and URL params. Use this for all new features:

```javascript
import { syncUrlState } from '../utils/url-state-sync.mjs';
import { store } from 'reefjs';

const myState = store({ isOpen: false, tab: 'messages' }, actions, 'mySignal');

// Set up automatic URL sync
const sync = syncUrlState(myState, {
  // Map state keys to URL param names
  stateToUrl: {
    isOpen: 'info',
    tab: 'tab',
  },

  // Serialize: convert state value to URL param
  serialize: {
    isOpen: (value) => (value ? 'open' : null), // null = remove from URL
    tab: (value) => (value === 'messages' ? null : value), // default omitted
  },

  // Deserialize: convert URL param to state value
  deserialize: {
    isOpen: (value) => value === 'open',
    tab: (value) => value || 'messages',
  },

  // Optional: only sync when condition is true
  shouldSync: (state) => state.isOpen,

  // Optional: use pushState (true) or replaceState (false)
  pushState: false,

  // Optional: custom popstate handler
  onPopState: (event, store) => {
    // Handle browser back/forward
    const urlParams = new URLSearchParams(window.location.search);
    // Update state based on URL...
  },
});

// Now just update state - URL syncs automatically!
myState.isOpen = true; // URL updates to ?info=open
myState.tab = 'pins'; // URL updates to ?info=open&tab=pins
```

**Key Benefits**:

- 🔄 **Automatic sync**: Change state → URL updates, browser back/forward → state updates
- 🎯 **Declarative mapping**: Define state-to-URL mapping once
- 🧹 **Clean code**: No manual `pushState`/`replaceState` calls scattered everywhere
- 🔧 **Flexible**: Custom serializers, conditional sync, custom popstate handlers
- ⚠️ **Conflict detection**: Throws error if multiple stores try to use same URL param (fail-fast development)

**Conflict Detection** (Development Safety):

The utility prevents multiple stores from syncing to the same URL param:

```javascript
// Store 1: Uses 'tab' param
const sidebar = store({ tab: 'home' }, {}, 'sidebar');
syncUrlState(sidebar, { stateToUrl: { tab: 'sidebarTab' } });

// Store 2: Tries to use same param - THROWS ERROR!
const panel = store({ tab: 'info' }, {}, 'panel');
syncUrlState(panel, { stateToUrl: { tab: 'sidebarTab' } });
// ❌ Error: URL param "sidebarTab" is already used by store "signal:sidebar"

// Fix: Use different param names
syncUrlState(panel, { stateToUrl: { tab: 'panelTab' } }); // ✅ Works!
```

**Debug Utilities** (available in development):

```javascript
import { getRegisteredUrlParams, debugUrlRegistry } from './url-state-sync.mjs';

// Get all registered params
console.log(getRegisteredUrlParams());
// → { sidebarTab: 'signal:sidebar', panelTab: 'signal:panel' }

// Print debug table
debugUrlRegistry();
// → Console table showing all URL param registrations

// Or use browser console (localhost only):
window.__urlStateSync.debug();
```

**URL State Guidelines**:

- **DO persist**: Room, channel, active tab, selected message, thread view, search query
- **DON'T persist**: Transient UI (tooltips, dropdowns, loading states, error messages)
- **Use `pushState: true`** for new navigation (creates history entry)
- **Use `pushState: false`** for in-place updates (no history entry)
- **Always sync URL ↔ UI state** automatically with `syncUrlState()`
- **Handle missing params gracefully** with sensible defaults in `deserialize`

**Shareable State Examples**:

```
# Share specific channel
/room/myroom?channel=general

# Share pinned messages view
/room/myroom?channel=general&tab=pins

# Share specific thread
/room/myroom?channel=general&thread=msg-123

# Share specific message (jump to message)
/room/myroom?channel=general&msg=msg-456
```

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
if (message.startsWith('YOUR_PREFIX:')) {
  // Custom rendering logic
}
```

### Thread System (Example of Complex Feature)

Threads are stored in **SQLite tables** (migrated from KV indexes):

- Messages in `messages` table with `reply_to_id` foreign key
- Thread relationships tracked in `threads` table: `parent_message_id` → array of `reply_message_id`
- Messages cache: `Map` of messageId → message data (client-side)

**Critical pattern**: Use GET endpoint for initial load, WebSocket for real-time updates.

## Crypto Architecture (E2EE)

**All encryption happens client-side** - server is zero-knowledge:

### 1. Key Derivation (`src/common/crypto-utils.js`)

- Password → AES-256-GCM key via PBKDF2-SHA256 (100k iterations)
- Room ID used as salt (ensures different rooms = different keys)
- Keys cached in `KeyManager` (LocalStorage + in-memory cache, 5min TTL)

### 2. Message Encryption

- Each message gets unique IV (12 bytes random)
- Format: `{iv: Uint8Array, ciphertext: Uint8Array, version: "1.0"}`
- Server stores/forwards ciphertext, never sees plaintext

### 3. File Encryption (`src/common/file-crypto.js`)

- **Streaming encryption** via Worker Pool (avoids main thread blocking)
- Files split into 2MB chunks, each encrypted separately
- Metadata header: `{originalName, originalType, totalChunks, version: "2.0"}`
- Encrypted blob stored in R2, URL shared in chat

### 4. Crypto Worker Pool (`src/ui/crypto-worker-pool.js`)

- **Multi-threaded encryption** for performance (2-8 workers based on CPU cores)
- Auto-scaling: adds workers at 80% load, removes at 30% idle
- Task queue with load balancing (max 5 tasks/worker)
- Worker lifecycle: 30s idle timeout, dynamic spawn/terminate

**Key files**:

- `src/common/key-manager.js` - LocalStorage-based key persistence
- `src/ui/crypto.worker.js` - Web Worker for off-thread crypto operations
- `src/common/crypto-compat.js` - Browser compatibility shims

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
- **Reef.js for new UI**: All new interactive UI features must use Reef.js store/component pattern (see `src/ui/mobile/channel-info.mjs`)
- **Reactive state**: `src/ui/react/state.mjs` provides simple Proxy-based reactivity pattern (legacy, prefer Reef.js for new code)
- **Mobile-first**: Dedicated mobile module (`src/ui/mobile.mjs`) handles page navigation, touch gestures
- **URL state management**: All shareable UI state must be reflected in URL query parameters (room, channel, tab, message, thread)
- **Reactive state**: `src/ui/react/state.mjs` provides simple Proxy-based reactivity pattern (legacy, prefer Reef.js for new code)
- **Mobile-first**: Dedicated mobile module (`src/ui/mobile.mjs`) handles page navigation, touch gestures

## External Dependencies (Minimal)

- `hono` - HTTP routing framework (used in Worker and DO)
- `@zip.js/zip.js` - Export feature (ZIP all messages + R2 files)
- `@chialab/rna` - UI bundler (dev dependency)
- `reefjs` (v13) - Reactive UI library (CDN import, no build step)

## Key Design Decisions

1. **Why Durable Objects?** Per-room state coordination + WebSocket hibernation = infinite scalability at low cost
2. **Why R2 for files?** DO storage is KV, not suited for large blobs; R2 provides cheap object storage
3. **Why SQLite?** Migrated from KV for better query patterns (indexes, joins, complex filters)
4. **Why custom elements?** Vanilla JS approach, no build complexity for components, progressive enhancement
5. **Why Hono?** Lightweight routing, works in both Worker and DO contexts, better DX than raw fetch()
6. **Why Worker Pool for crypto?** Avoids blocking main thread during encryption, scales with CPU cores

## Performance Patterns

- **Lazy load images**: `<lazy-img>` with IntersectionObserver (reduces initial data transfer)
- **Message batching**: Load last 100 messages on join, use WebSocket for real-time
- **IndexedDB caching**: (Planned for E2EE) Store encryption keys client-side
- **Smart scrolling**: `isAtBottom` flag to prevent scroll jumps when images load

---

**Remember**: This is an edge-first architecture. Think "coordination objects" not "servers". Each DO is single-threaded but globally distributed. Embrace the constraints for massive scale.
