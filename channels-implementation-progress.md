# Channels System Implementation Progress

**Date**: November 1, 2025  
**Feature**: Convert hashtag system to Discord-style channels  
**Reason**: E2EE encryption breaks server-side hashtag parsing from message content  
**Status**: ✅ **Core Implementation Complete - Ready for Testing**

---

## Implementation Status

### ✅ Phase 1: Backend Implementation (100% Complete)

#### 1. Channel Manager Module (`src/api/channel.mjs`)

- [x] Created `ChannelManager` class (refactored from `HashtagManager`)
- [x] Added `validateChannelName()` function
- [x] Changed storage key prefixes: `hashtag:` → `channel:`
- [x] Modified `removeMessageFromChannel()` to preserve empty channels
- [x] Added `deleteAllChannels()` for room destruction
- [x] Storage structure:
  - `channel:{name}` - message index array
  - `channel_meta:{name}` - {count, firstUsed, lastUsed}
  - `channels:all` - global channel list

#### 2. Chat Room Backend (`src/api/chat.mjs`)

- [x] Replaced imports: `HashtagManager` → `ChannelManager`, removed `extractHashtags`
- [x] Updated constructor: `this.hashtagManager` → `this.channelManager`
- [x] HTTP endpoints renamed:
  - `GET /hashtags` → `GET /channels`
  - `GET /hashtag?tag=` → `GET /channel?channel=`
  - `GET /hashtag/search` → `GET /channel/search`
- [x] WebSocket message handling:
  - Accept `data.channel` field (plaintext, not encrypted)
  - Validate with `validateChannelName()`
  - Default to `'general'` if not provided
  - Index message: `channelManager.indexMessage(key, channel, timestamp)`
- [x] Message deletion:
  - Remove from channel index only
  - Don't delete empty channels (persist until room destruction)
  - Removed `hashtagsUpdated` broadcast
- [x] Message editing:
  - Channel field doesn't change on edit
  - Removed hashtag re-indexing logic
- [x] Export endpoint:
  - `hashtags` → `channels` in export data
- [x] Legacy message migration:
  - Auto-add `channel: 'general'` to old messages without channel field

#### 3. API Client (`src/ui/api.mjs`)

- [x] Renamed `getHashtags()` → `getChannels()`
- [x] Updated endpoint URL: `/hashtags` → `/channels`

---

### ✅ Phase 2: Frontend Core (100% Complete)

#### 4. Message Sending Logic (`src/ui/index.mjs`)

- [x] Added state variables:
  - `currentChannel = 'general'` - current channel for sending messages
  - `currentChannelFilter = null` - active filter
  - `allChannels = []` - channel list cache
- [x] Updated `sendMessage()` payload to include `channel` field
- [x] Channel sent as plaintext alongside encrypted message content

#### 5. Channel Panel Functions (`src/ui/index.mjs`)

- [x] `loadChannels()` - fetch channels from server
- [x] `renderChannelList()` - render channel items (filters hidden channels)
- [x] `switchToChannel(channel)` - set as current & filter messages
- [x] `filterByChannel(channel)` - filter messages by channel attribute
- [x] `clearChannelFilter()` - show all messages
- [x] `showChannelContextMenu(event, channel)` - right-click menu
- [x] `hideChannel(channel)` - add to hidden list
- [x] `getHiddenChannels()` - read from localStorage
- [x] `saveHiddenChannels(channels)` - write to localStorage
- [x] `updateChannelsOnNewMessage(channel)` - reload channel list

#### 6. Channel State Management

- [x] localStorage key: `hiddenChannels:{roomName}`
- [x] URL parameter: `?channel=` (replaces `?tag=`)
- [x] CSS classes:
  - `.channel-item` - channel list item
  - `.channel-item.active` - filtered channel
  - `.channel-item.current` - current sending channel

---

### ✅ Phase 3: Frontend Integration (100% Complete)

#### 7. HTML Structure & CSS (`src/ui/index.html`) - COMPLETE

- [x] Added `<div id="channel-panel">` between left-sidebar and chatroom
- [x] Width: 180px
- [x] Structure:
  ```html
  <div id="channel-panel">
    <div id="channel-header">Channels</div>
    <div id="channel-list"></div>
  </div>
  ```
- [x] CSS styles:
  - `#channel-panel` - panel layout with flex column
  - `#channel-header` - header styling
  - `#channel-list` - scrollable list container
  - `.channel-item` - item styling with hover effects
  - `.channel-item.current` - bold + left border indicator
  - `.channel-item.active` - blue background when filtered
  - `.channel-context-menu` - right-click menu styling
  - `.channel-name`, `.channel-count` - text styling
  - Mobile: Hidden on screens <600px

#### 8. Message Receiving Logic (`src/ui/index.mjs`) - COMPLETE

- [x] Extract `data.channel` from incoming WebSocket messages (line ~3714)
- [x] Set `channel` attribute on `<chat-message>` elements (line ~1791)
- [x] Update message display logic to respect channel attribute
- [x] Call `updateChannelsOnNewMessage(data.channel)` on new messages (line ~4151)
- [x] Call `loadChannels()` on initial connection (line ~3697)
- [x] Update `processPendingMessages()` to handle channel field (line ~3389)
- [x] Update message filtering to use channel attribute instead of text search (line ~4078)

#### 9. ChatMessage Component - COMPLETE

- [x] Store `channel` as element attribute
- [x] Parse `#channelName` in text using regex from `../common/hashtag.mjs`
- [x] Convert `#xxx` to clickable links: `<a class="channel-link" data-channel="xxx">#xxx</a>`
- [x] Add click handler to call `window.switchToChannel()`
- [x] Style: blue text (#1da1f2), hover background, hover underline
- [x] Combined regex pattern for both URLs and #channel references

#### 10. Global Cleanup - COMPLETE

- [x] Removed hashtag DOM references:
  - `#hashtag-list` - removed variable declaration
  - `#hashtag-filter-banner` - removed element and variable
  - `#active-hashtag` - removed element and variable
  - `#hashtag-container` - removed from HTML and CSS
  - `.hashtag-item`, `.hashtag-name`, `.hashtag-count` - removed CSS
  - `a.hashtag` - removed CSS (replaced by `a.channel-link`)
- [x] Removed hashtags attribute rendering from ChatMessage component
- [x] Removed hashtags update from messageEdited handler
- [x] Cleaned up all hashtag-related CSS styles

---

## Testing Checklist

### Backend Tests

- [ ] Create message with explicit channel → stored correctly
- [ ] Create message without channel → defaults to 'general'
- [ ] Delete message → removed from channel index, channel persists
- [ ] Edit message → channel doesn't change
- [ ] List channels → returns all channels with metadata
- [ ] Get channel messages → filters by channel correctly
- [ ] Export data → includes channels array

### Frontend Tests

- [ ] Load room → channel list displays
- [ ] Send message → goes to currentChannel
- [ ] Switch channel → updates UI and filters messages
- [ ] Click #xxx link → switches to that channel
- [ ] Right-click channel → shows context menu
- [ ] Hide channel → disappears from list
- [ ] Refresh page → hidden channels stay hidden
- [ ] E2EE message → channel field is plaintext, content is encrypted
- [ ] Multiple tabs → channel list syncs

### Edge Cases

- [ ] Channel with 0 messages → still displays in list
- [ ] Delete all messages in channel → channel persists
- [ ] Destroy room → all channels deleted
- [ ] Invalid channel name → validation error
- [ ] Long channel name (>100 chars) → rejected
- [ ] Special characters in channel name → handled correctly

---

## Key Architecture Decisions

1. **Plaintext Channel Metadata**
   - Channel is NOT encrypted (unlike message content)
   - Server can index and filter by channel
   - Enables server-side channel list without breaking E2EE

2. **One Channel Per Message**
   - Aligns with Discord model
   - Simplifies indexing (no multi-tag logic)
   - #xxx in text are navigation links, not message categories

3. **Channel Persistence**
   - Channels never auto-delete (even when empty)
   - Only deleted on room destruction
   - Client-side hiding via localStorage

4. **Client-Side Hiding**
   - Right-click "Remove from list" doesn't delete channel
   - Stored in localStorage per room
   - Other users still see the channel
   - Can un-hide by switching rooms or clearing localStorage

---

## Next Steps

1. **HTML/CSS** (Task 7) - Add channel-panel structure and styles
2. **Message Receiving** (Task 8) - Extract channel from data, set attribute
3. **#xxx Parsing** (Task 9) - ChatMessage component link conversion
4. **Global Cleanup** (Task 10) - Replace all hashtag references
5. **Testing** - Full integration testing with E2EE

---

## Known Issues / Future Enhancements

- [x] ~~No channel creation UI~~ - **IMPLEMENTED**:
  - ✅ "+ New Channel" button at bottom of channel panel
  - ✅ Prompt for channel name with validation (2-32 chars, alphanumeric + underscore/hyphen)
  - ✅ Auto-switch to new channel after creation
  - ✅ Channels also auto-create on click/URL (frontend temporary) and persist on first message (backend)
- [ ] No channel rename/delete UI (only hide)
- [ ] No channel permissions (all users can post to any channel)
- [ ] No channel descriptions/topics
- [ ] No channel sorting options
- [ ] Consider: Drag-and-drop channel reordering?
- Consider: Pin favorite channels to top?
- Consider: Channel search/filter when list is long?

---

## Channel Creation Workflow (Implemented)

**Current Implementation**: Two ways to create channels

### Method 1: Explicit Creation via UI

1. **Click "+ New Channel" button** → Prompt appears
2. **Enter channel name** → Validates format (2-32 characters, a-z0-9\_-)
3. **Auto-switches to channel** → Frontend creates temporary channel (count=0)
4. **Send first message** → Backend persists channel with real data

### Method 2: Implicit Creation via Links/URL

1. **Type `#channelname` in a message** → Clickable link appears
2. **Click the link** → Frontend creates temporary channel (count=0)
3. **Or visit `?channel=channelname` URL** → Same as above
4. **Send first message** → Backend persists channel with real data

---

## Files Modified

### Backend

- `src/api/channel.mjs` - NEW FILE (ChannelManager class)
- `src/api/chat.mjs` - Updated imports, endpoints, WebSocket handling
- `src/api/hashtag.mjs` - DEPRECATED (kept for reference, not used)

### Frontend

- `src/ui/api.mjs` - Updated getChannels() method
- `src/ui/index.mjs` - Added channel functions, updated message sending
- `src/ui/index.html` - TO BE UPDATED (channel panel structure)

### Common

- `src/common/hashtag.mjs` - Still used for #xxx regex pattern in client

---

**Status**: ✅ **Implementation 95% Complete** - Core functionality ready, testing required

## Summary

### What Works Now

✅ Backend channel system with persistence  
✅ Frontend channel panel with UI  
✅ Message sending with channel field (plaintext)  
✅ Message filtering by channel  
✅ #xxx clickable links to switch channels  
✅ Right-click context menu to hide channels  
✅ localStorage persistence of hidden channels  
✅ E2EE compatibility (channel is plaintext metadata)

### What Needs Testing

🧪 Full end-to-end workflow  
🧪 Multi-user scenarios  
🧪 Edge cases (empty channels, long names, special characters)  
🧪 Mobile responsiveness  
🧪 Refresh and reconnection handling

### Minor Cleanup (Optional)

🔧 Rename remaining `.hashtag-*` CSS classes for consistency  
🔧 Remove old hashtag UI elements (banner, filter display)
