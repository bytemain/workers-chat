# PRD: Hashtags 到 Channels 系统改造

**版本**: 1.0  
**日期**: 2025-11-01  
**状态**: 草案

---

## 1. 背景与问题陈述

### 1.1 当前问题

由于系统默认启用 E2EE（端到端加密），服务端无法解析消息内容中的 `#hashtag` 标记，导致现有的 hashtag 功能完全失效：

- **服务端盲区**: 消息内容为密文，`extractHashtags(data.message)` 无法提取标签
- **索引失败**: `HashtagManager` 无法建立索引
- **功能瘫痪**: 右侧边栏的 hashtag 列表始终为空

### 1.2 解决方案概述

将 **Hashtags** 改造为 **Channels**（频道），完全对齐 Discord 的设计：

```
┌──────────┬─────────────────────────┬─────────────────────────────────┬──────────────┐
│          │                         │                                 │              │
│  Rooms   │  Channels (NEW!)       │  Chat Messages (E2EE)          │  Room Info   │
│          │                         │                                 │              │
│  🏠 R1   │  # general             │  User: Hello world!            │  👥 Members  │
│  🏠 R2   │  # design              │  User: Check #design ← 可点击  │              │
│  🏠 R3   │  # feedback            │  ...                            │  📊 Stats    │
│          │  # random              │                                 │              │
│          │  ─────────             │                                 │              │
│          │  + New Channel         │                                 │              │
│          │                         │                                 │              │
└──────────┴─────────────────────────┴─────────────────────────────────┴──────────────┘
```

**核心设计原则**:

1. **消息只属于一个 channel**（当前激活的 channel）
2. **消息内的 `#xxx` 是可点击的引用链接**，点击跳转到对应 channel
3. **Channels 是明文元数据**，不参与 E2EE 加密
4. **独立的 Channel Panel**，位于 Room List 和 Chat Area 之间
5. **默认 channel 为 `general`**

**与 Discord 对齐的关键行为**:

- 在 `#design` channel 中发送 "Check #feedback" → 消息只属于 `#design`
- 消息中的 `#feedback` 是蓝色可点击链接，点击后跳转到 `#feedback` channel
- **不是**将消息同时发送到多个 channels（这是旧 hashtag 的行为）

---

## 2. 核心架构设计

### 2.1 加密边界划分

| 数据类型           | 加密状态 | 理由                           |
| ------------------ | -------- | ------------------------------ |
| 消息内容 (message) | ✅ 加密  | 隐私核心，端到端加密           |
| Channel (单个)     | ❌ 明文  | 消息所属的频道，服务端需要索引 |
| Username           | ❌ 明文  | 现有设计（身份识别）           |
| Timestamp          | ❌ 明文  | 现有设计（消息排序）           |
| MessageId          | ❌ 明文  | 现有设计（消息引用）           |

**类比**:

- **Email**: 邮件内容加密，但收件人地址必须明文（否则无法路由）
- **Discord**: 消息内容可见，但 channel 结构是服务端管理的元数据

### 2.2 数据流设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          客户端发送流程                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. 用户在 #general channel 输入: "Hello world! Check #design"

2. 前端处理:
   - 当前激活 channel: "general"
   - 加密消息: "Hello world! Check #design" → "<ciphertext>"
   - 注意: #design 是消息内容的一部分，会被加密！

3. WebSocket 发送:
   {
     message: "<ciphertext>",           // 加密（包含 #design 文本）
     channel: "general",                // 明文 - 消息所属的 channel
     messageId: "uuid-xxx",
     timestamp: 1698765432000,
     name: "Alice"
   }

┌─────────────────────────────────────────────────────────────────────────┐
│                          服务端处理流程                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. 接收 WebSocket 消息
2. 读取 data.channel（明文字符串）
3. 验证和规范化:
   - 检查是否为有效字符串
   - 转小写
   - 验证格式（2-32 字符，只允许字母数字下划线中文）
4. 如果 channel 为空或无效 → 默认 "general"
5. 更新 ChannelManager 索引（将消息添加到该 channel）
6. 广播给所有客户端（保留 channel 字段）

┌─────────────────────────────────────────────────────────────────────────┐
│                          客户端接收流程                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. 收到消息 + channel 元数据（单个 channel）
2. 解密 message 内容 → "Hello world! Check #design"
3. 解析解密后的文本，找到所有 #xxx 引用
4. 渲染消息:
   - 将 #design 渲染为可点击的蓝色链接
   - 点击 #design → 切换到 design channel
5. 如果当前激活的 channel 与消息的 channel 匹配 → 显示消息
6. 否则隐藏该消息（过滤）
7. 更新 Channel Panel 的列表和计数
```

---

## 3. UI/UX 详细设计

### 3.1 布局结构

#### 桌面端布局

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    Titlebar                                         │
│                           [Room Name - Editable]                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌──────────┬───────────────────┬──────────────────────────────────────┬──────────────┐
│          │                   │                                      │              │
│  Rooms   │  Channels        │         Chat Messages                │  Room Info   │
│  List    │  Panel (NEW!)    │                                      │              │
│          │                   │                                      │              │
│  72px    │  180px           │         flex: 1                      │  200px       │
│          │                   │                                      │              │
│  🏠      │  # general  (42) │  [message bubbles...]                │  👥 Online   │
│  🏠      │  # design    (5) │                                      │              │
│  🏠      │  # feedback  (2) │                                      │  Alice       │
│  🔵 +    │  # random    (8) │                                      │  Bob         │
│          │  ──────────────── │                                      │              │
│          │  + New Channel   │                                      │  📌 Pins     │
│          │                   │                                      │              │
│  👤      │                   │                                      │              │
│  User    │                   │                                      │              │
│          │                   │                                      │              │
└──────────┴───────────────────┴──────────────────────────────────────┴──────────────┘
```

#### 移动端布局

```
┌────────────────────────────────────────────┐
│  [≡] Room Name  #general ▼     [🔒]       │  ← 点击展开 channel 选择器
├────────────────────────────────────────────┤
│                                            │
│  [Channel Selector - Dropdown]            │  ← 展开时显示
│  ✓ # general                              │
│    # design                               │
│    # feedback                             │
│                                            │
├────────────────────────────────────────────┤
│                                            │
│  Chat Messages                            │
│                                            │
│  Alice: Hello world!                      │
│  #design #feedback                        │
│                                            │
└────────────────────────────────────────────┘
```

### 3.2 Channel Panel 设计

#### 组件结构

```html
<div id="channel-panel" class="channel-panel">
  <!-- Header -->
  <div class="channel-panel-header">
    <h3>
      <i class="ri-hashtag"></i>
      <span>Channels</span>
    </h3>
  </div>

  <!-- Channel List -->
  <div class="channel-list">
    <!-- Active Channel -->
    <div class="channel-item active" data-channel="general">
      <span class="channel-icon">#</span>
      <span class="channel-name">general</span>
      <span class="channel-count">42</span>
    </div>

    <!-- Other Channels -->
    <div class="channel-item" data-channel="design">
      <span class="channel-icon">#</span>
      <span class="channel-name">design</span>
      <span class="channel-count">5</span>
      <span class="channel-unread-badge">2</span>
    </div>

    <div class="channel-item" data-channel="feedback">
      <span class="channel-icon">#</span>
      <span class="channel-name">feedback</span>
      <span class="channel-count">2</span>
    </div>
  </div>

  <!-- Add Channel (Optional - Phase 3) -->
  <div class="channel-add">
    <button class="channel-add-btn">
      <i class="ri-add-line"></i>
      <span>Add Channel</span>
    </button>
  </div>
</div>
```

#### 样式规范

```css
#channel-panel {
  width: 180px;
  background: var(--background-alt);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.channel-panel-header {
  padding: var(--spacing);
  border-bottom: 1px solid var(--border);
  background: var(--background);
}

.channel-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
}

.channel-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 6px 10px;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: var(--transition);
  margin-bottom: 2px;
  position: relative;
}

.channel-item:hover {
  background: var(--background);
}

.channel-item.active {
  background: var(--background);
  color: var(--links);
  font-weight: 600;
}

.channel-icon {
  font-size: 1.1em;
  color: var(--text-muted);
  flex-shrink: 0;
}

.channel-item.active .channel-icon {
  color: var(--links);
}

.channel-name {
  flex: 1;
  font-size: 0.9em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-count {
  font-size: 0.75em;
  color: var(--text-muted);
  flex-shrink: 0;
}

.channel-unread-badge {
  position: absolute;
  right: 8px;
  background: #dc3545;
  color: white;
  border-radius: 10px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: bold;
  min-width: 16px;
  text-align: center;
}
```

### 3.3 交互行为

#### Channel 切换

1. **点击 channel item** → 激活该 channel
2. **过滤消息**: 只显示包含该 channel 的消息
3. **URL 同步**: `https://example.com/room/myroom?channel=design`
4. **标记已读**: 切换后清除该 channel 的未读标记

#### Channel 管理（右键菜单）

1. **右键点击 channel item** → 显示上下文菜单
2. **菜单选项**:
   - **"Remove from list"**: 从当前用户的 channel 列表中隐藏此 channel
   - 注意：这是**客户端本地操作**，不影响服务端数据
3. **恢复隐藏的 channel**: 
   - 当有新消息发送到被隐藏的 channel 时，该 channel 自动重新出现在列表中
   - 或通过"显示所有 channels"功能恢复

**关键设计**:
- ✅ 客户端可以隐藏不感兴趣的 channel（本地偏好设置）
- ✅ 服务端的 channel 数据不受影响，持久存在
- ✅ 只有在房间被摧毁时，服务端才删除所有 channel 数据

#### Channel 引用（消息文本内）

1. **显示位置**: 消息文本内联（inline）
2. **样式**: 类似超链接，蓝色文字，下划线（hover）
3. **交互**: 点击 `#design` → 切换到 design channel
4. **解析**: 客户端解密后，使用 regex 找到所有 `#xxx` 并转换为链接

**示例渲染**:

```html
<div class="msg-content">
  Hello world! Check
  <a href="#" class="channel-reference" data-channel="design">#design</a>
  for updates.
</div>
```

**关键区别**:

- ❌ 不是消息下方的 tag 列表
- ✅ 是消息文本中的可点击引用

#### 未读消息管理

- **计数逻辑**: 当前激活 channel 外的新消息计入未读
- **显示**: 红色小圆点 badge
- **清除**: 切换到该 channel 时清除

---

## 4. 技术实现细节

### 4.1 前端改造

#### A. 消息发送逻辑

**文件**: `src/ui/index.mjs`

**位置**: `sendMessage()` 函数或 WebSocket 发送部分

**改造前**:

```javascript
// 当前逻辑
const message = chatInput.value;
const encrypted = await CryptoUtils.encrypt(message, key);

webSocket.send(
  JSON.stringify({
    message: encrypted,
    messageId: crypto.randomUUID(),
    replyTo: currentReplyTo,
  }),
);
```

**改造后**:

```javascript
// 新逻辑 - 对齐 Discord 行为
const message = chatInput.value;

// 1. 使用当前激活的 channel（不解析消息内容）
const channel = currentChannel || 'general';

// 2. 加密消息内容（包括其中的 #xxx 引用）
const encrypted = await CryptoUtils.encrypt(message, key);

// 3. 发送（包含单个明文 channel）
webSocket.send(
  JSON.stringify({
    message: encrypted,
    channel: channel, // ← 新增字段（明文，单个字符串）
    messageId: crypto.randomUUID(),
    replyTo: currentReplyTo,
  }),
);
```

- ✅ 使用当前激活的 channel（用户当前所在的频道）
- ✅ 消息内的 `#xxx` 保留在加密内容中，仅用于渲染链接

#### B. 消息接收和渲染

**文件**: `src/ui/index.mjs`

**位置**: WebSocket `onmessage` 处理函数

**改造前**:

```javascript
// 接收消息
const data = JSON.parse(event.data);
const decrypted = await CryptoUtils.decrypt(data.message, key);

// 渲染
const chatMessage = document.createElement('chat-message');
chatMessage.setAttribute('name', data.name);
chatMessage.setAttribute('message', decrypted);
// ... 其他属性
```

**改造后**:

```javascript
// 接收消息
const data = JSON.parse(event.data);
const decrypted = await CryptoUtils.decrypt(data.message, key);

// 渲染（包含 channel）
const chatMessage = document.createElement('chat-message');
chatMessage.setAttribute('name', data.name);
chatMessage.setAttribute('message', decrypted);
chatMessage.setAttribute('channel', data.channel || 'general'); // ← 新增（单个 channel）

// 过滤：只显示当前激活 channel 的消息
if (data.channel === currentChannel) {
  chatlog.appendChild(chatMessage);
} else {
  // 不显示，或者添加到隐藏列表
  chatMessage.style.display = 'none';
  chatlog.appendChild(chatMessage);
}

// 更新 channel 列表（增加计数）
if (data.channel) {
  incrementChannelCount(data.channel);
}
```

#### C. Channel Panel 组件

**文件**: `src/ui/index.mjs`

**新增功能**:

```javascript
// Channel 状态管理
let currentChannel = 'general'; // 当前激活的 channel
let allChannels = []; // 所有 channel 列表（从服务端加载）
let channelUnreadCounts = {}; // 未读消息计数

// 加载 channels
async function loadChannels() {
  try {
    const data = await api.getChannels(roomname);
    allChannels = data.channels || [];
    renderChannelPanel();
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

// 渲染 Channel Panel
function renderChannelPanel() {
  const channelList = document.querySelector('.channel-list');
  if (!channelList) return;

  channelList.innerHTML = '';

  // 确保 general 排在第一位
  const sortedChannels = [...allChannels].sort((a, b) => {
    if (a.tag === 'general') return -1;
    if (b.tag === 'general') return 1;
    return b.lastUsed - a.lastUsed;
  });

  sortedChannels.forEach((channel) => {
    // 跳过隐藏的 channels
    if (hiddenChannels.has(channel.tag)) {
      return;
    }

    const item = document.createElement('div');
    item.className = 'channel-item';
    if (channel.tag === currentChannel) {
      item.classList.add('active');
    }
    item.dataset.channel = channel.tag;

    item.innerHTML = `
      <span class="channel-icon">#</span>
      <span class="channel-name">${escapeHtml(channel.tag)}</span>
      <span class="channel-count">${channel.count || 0}</span>
      ${
        channelUnreadCounts[channel.tag]
          ? `<span class="channel-unread-badge">${channelUnreadCounts[channel.tag]}</span>`
          : ''
      }
    `;

    // 左键点击：切换 channel
    item.addEventListener('click', () => switchChannel(channel.tag));
    
    // 右键点击：显示上下文菜单
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showChannelContextMenu(e, channel.tag);
    });

    channelList.appendChild(item);
  });
}

// 切换 channel
function switchChannel(channelName) {
  currentChannel = channelName;

  // 清除该 channel 的未读计数
  delete channelUnreadCounts[channelName];

  // 更新 UI
  renderChannelPanel();
  filterMessagesByChannel(channelName);

  // 更新 URL
  const url = new URL(window.location);
  url.searchParams.set('channel', channelName);
  window.history.pushState({}, '', url);
}

// 按 channel 过滤消息
function filterMessagesByChannel(channelName) {
  const messages = document.querySelectorAll('chat-message');

  messages.forEach((msg) => {
    const msgChannel = msg.getAttribute('channel') || 'general';

    // 简单比较：消息的 channel 是否匹配
    if (msgChannel === channelName) {
      msg.style.display = '';
    } else {
      msg.style.display = 'none';
    }
  });

  // 滚动到底部
  scrollToBottom();
}

// 更新未读计数（新消息到达时调用）
function incrementChannelUnread(channel) {
  // 如果消息不属于当前激活的 channel，增加未读计数
  if (channel !== currentChannel) {
    channelUnreadCounts[channel] = (channelUnreadCounts[channel] || 0) + 1;
  }
  renderChannelPanel();
}

// 增加 channel 消息计数（用于显示总消息数）
function incrementChannelCount(channel) {
  const channelData = allChannels.find((ch) => ch.tag === channel);
  if (channelData) {
    channelData.count = (channelData.count || 0) + 1;
  } else {
    // 新 channel，添加到列表
    allChannels.push({
      tag: channel,
      count: 1,
      lastUsed: Date.now(),
    });
  }
  renderChannelPanel();
}

// Channel 隐藏管理（客户端本地偏好）
let hiddenChannels = new Set(); // 用户隐藏的 channel 列表

// 从 localStorage 加载隐藏的 channels
function loadHiddenChannels() {
  try {
    const stored = localStorage.getItem(`hidden-channels-${roomname}`);
    if (stored) {
      hiddenChannels = new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.error('Failed to load hidden channels:', e);
  }
}

// 保存隐藏的 channels 到 localStorage
function saveHiddenChannels() {
  try {
    localStorage.setItem(
      `hidden-channels-${roomname}`,
      JSON.stringify([...hiddenChannels])
    );
  } catch (e) {
    console.error('Failed to save hidden channels:', e);
  }
}

// 隐藏 channel（仅客户端）
function hideChannelFromList(channelName) {
  hiddenChannels.add(channelName);
  saveHiddenChannels();
  renderChannelPanel();
}

// 显示所有 channels（恢复隐藏的）
function showAllChannels() {
  hiddenChannels.clear();
  saveHiddenChannels();
  renderChannelPanel();
}

// 当新消息到达时，自动取消隐藏
function onNewMessageInChannel(channel) {
  if (hiddenChannels.has(channel)) {
    hiddenChannels.delete(channel);
    saveHiddenChannels();
    renderChannelPanel();
  }
}
```

#### D. ChatMessage Custom Element 改造

**文件**: `src/ui/index.mjs`

**位置**: `ChatMessage` class

**改造**:

```javascript
// Channel 右键上下文菜单
function showChannelContextMenu(event, channelName) {
  // 移除已存在的菜单
  const existingMenu = document.querySelector('#channel-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  // 创建菜单
  const menu = document.createElement('div');
  menu.id = 'channel-context-menu';
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';

  // 不允许隐藏 general channel
  if (channelName !== 'general') {
    const hideItem = document.createElement('div');
    hideItem.className = 'context-menu-item';
    hideItem.innerHTML = `
      <i class="ri-eye-off-line"></i>
      <span>Remove from list</span>
    `;
    hideItem.addEventListener('click', () => {
      hideChannelFromList(channelName);
      menu.remove();
    });
    menu.appendChild(hideItem);
  }

  // 添加"显示所有 channels"选项（如果有隐藏的）
  if (hiddenChannels.size > 0) {
    const showAllItem = document.createElement('div');
    showAllItem.className = 'context-menu-item';
    showAllItem.innerHTML = `
      <i class="ri-eye-line"></i>
      <span>Show all channels (${hiddenChannels.size} hidden)</span>
    `;
    showAllItem.addEventListener('click', () => {
      showAllChannels();
      menu.remove();
    });
    menu.appendChild(showAllItem);
  }

  document.body.appendChild(menu);

  // 点击外部关闭菜单
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);
}

class ChatMessage extends HTMLElement {
  connectedCallback() {
    // ... 现有代码 ...

    // 渲染 channel 引用
    this.renderChannelReferences();
  }

  renderChannelReferences() {
    // 解析消息文本中的 #channel 引用，转换为可点击链接
    const msgContent = this.querySelector('.msg-content');
    if (!msgContent) return;

    const messageText = msgContent.textContent || '';

    // 使用 regex 找到所有 #channel 引用
    import { regex } from '../common/hashtag.mjs';

    // 替换文本中的 #channel 为可点击链接
    const html = messageText.replace(regex, (match, channelName) => {
      return `<a href="#" class="channel-reference" data-channel="${escapeHtml(channelName.toLowerCase())}">${escapeHtml(match)}</a>`;
    });

    msgContent.innerHTML = html;

    // 为所有链接添加点击事件
    msgContent.querySelectorAll('.channel-reference').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const channel = e.target.dataset.channel;
        if (window.switchChannel) {
          window.switchChannel(channel);
        }
      });
    });
  }
}
```

### 4.2 后端改造

#### A. WebSocket 消息处理

**文件**: `src/api/chat.mjs`

**位置**: `ChatRoom.webSocketMessage()` 方法（约 Line 935-1090）

**改造前** (Line ~1075-1080):

```javascript
// Extract and attach hashtags from the message (server-side parsing)
const hashtags = extractHashtags(data.message);
console.log('Extracted hashtags:', hashtags);
if (hashtags.length > 0) {
  data.hashtags = hashtags; // Array of hashtags without # prefix
}
```

**改造后**:

```javascript
// Accept channels from client (client-side parsing)
// Channels are plaintext metadata, NOT encrypted
let channels = data.channels || [];

// Validate and sanitize channels
if (!Array.isArray(channels)) {
  channels = [];
}

// Filter, normalize, and limit channels
channels = channels
  .filter((c) => typeof c === 'string' && c.length >= 2 && c.length <= 32)
  .map((c) => c.toLowerCase().trim())
  .filter((c) => /^[a-z0-9_\-\u4e00-\u9fa5]+$/.test(c)) // 只允许字母、数字、下划线、中文
  .slice(0, 10); // 最多 10 个 channels

// Remove duplicates
channels = [...new Set(channels)];

// Default to 'general' if no valid channels
if (channels.length === 0) {
  channels = ['general'];
}

// Attach channels to data
data.channels = channels;

console.log('Message channels:', channels);
```

**同时修改索引调用** (Line ~1084):

**改造前**:

```javascript
// Index hashtags in the message
await this.hashtagManager.indexMessage(key, data.message, data.timestamp);
```

**改造后**:

```javascript
// Index channel (single channel, not array)
await this.channelManager.indexMessage(key, data.channel, data.timestamp);
```

#### B. ChannelManager (重命名自 HashtagManager)

**文件**: `src/api/hashtag.mjs` → **重命名为** `src/api/channel.mjs`

**主要改动**:

1. **删除 `extractHashtags()` 函数**（不再需要）

2. **重命名类和常量**:

```javascript
// 改造前
export class HashtagManager { ... }
const HASHTAG_INDEX_PREFIX = 'hashtag:';
const HASHTAG_META_PREFIX = 'hashtag_meta:';
const HASHTAG_LIST_KEY = 'hashtags:all';

// 改造后
export class ChannelManager { ... }
const CHANNEL_INDEX_PREFIX = 'channel:';
const CHANNEL_META_PREFIX = 'channel_meta:';
const CHANNEL_LIST_KEY = 'channels:all';
```

3. **修改 `indexMessage()` 方法签名**:

```javascript
// 改造前
async indexMessage(messageKey, messageText, timestamp) {
  const tags = extractHashtags(messageText); // 解析文本
  if (tags.length === 0) return;
  // ...
}

// 改造后
async indexMessage(messageKey, channel, timestamp) {
  // 直接使用单个 channel 字符串
  if (!channel || typeof channel !== 'string') {
    channel = 'general';
  }

  // 添加到该 channel 的索引
  await this.addMessageToChannel(channel, messageKey, timestamp);
}
```

4. **重命名所有方法**:
   - `addMessageToTag()` → `addMessageToChannel()`
   - `getAllHashtags()` → `getAllChannels()`
   - `getMessagesForTag()` → `getMessagesForChannel()`
   - `searchHashtags()` → `searchChannels()`
   - `getHashtagStats()` → `getChannelStats()`
   - `deleteHashtag()` → `deleteChannel()`
   - `removeMessageFromTag()` → `removeMessageFromChannel()`

**重要变更**: `removeMessageFromChannel()` 方法逻辑改变：

- **旧行为**: 当 channel 中没有消息时，删除 channel 及其元数据
- **新行为**: 保留 channel，即使消息数为 0（count = 0），只更新计数
- 理由: Channel 应该持久存在，类似 Discord，即使暂时没有消息

```javascript
// removeMessageFromChannel() 关键逻辑变化
// 旧代码（删除空 channel）:
if (index.length === 0) {
  await this.storage.delete(indexKey);
  await this.storage.delete(metaKey);
  // 从全局列表中删除...
}

// 新代码（保留空 channel）:
// 无论 index.length 是否为 0，都保留 channel
await this.storage.put(indexKey, JSON.stringify(index));
meta.count = index.length; // 可能是 0
await this.storage.put(metaKey, JSON.stringify(meta));
```

5. **更新 ChatRoom 初始化** (Line ~226):

```javascript
// 改造前
this.hashtagManager = new HashtagManager(this.storage);

// 改造后
this.channelManager = new ChannelManager(this.storage);
```

#### C. HTTP API 端点

**文件**: `src/api/chat.mjs`

**位置**: ChatRoom 的 HTTP routes（约 Line 395-413）

**改造**:

```javascript
// 改造前
app.get('/hashtags', async (c) => {
  const tags = await this.hashtagManager.getAllHashtags(100);
  return c.json({ hashtags: tags });
});

app.get('/hashtag', async (c) => {
  const tag = c.req.query('tag');
  if (!tag) return c.json({ error: 'Missing tag parameter' }, 400);
  const messages = await this.hashtagManager.getMessagesForTag(tag, 100);
  return c.json({ messages });
});

app.get('/hashtag/search', async (c) => {
  const query = c.req.query('q') || '';
  const tags = await this.hashtagManager.searchHashtags(query, 20);
  return c.json({ results: tags });
});

// 改造后
app.get('/channels', async (c) => {
  const channels = await this.channelManager.getAllChannels(100);
  return c.json({ channels: channels });
});

app.get('/channel', async (c) => {
  const channel = c.req.query('channel');
  if (!channel) return c.json({ error: 'Missing channel parameter' }, 400);
  const messages = await this.channelManager.getMessagesForChannel(
    channel,
    100,
  );
  return c.json({ messages });
});

app.get('/channel/search', async (c) => {
  const query = c.req.query('q') || '';
  const channels = await this.channelManager.searchChannels(query, 20);
  return c.json({ results: channels });
});
```

#### D. 消息删除/编辑时的 Channel 清理

**文件**: `src/api/chat.mjs`

**位置**: DELETE handler（约 Line 462-490）

**改造前**:

```javascript
// Extract hashtags from the message to clean up indexes
const hashtags = extractHashtags(messageData.message);
console.log(`[DELETE] Message has hashtags:`, hashtags);

// Remove this message from all hashtag indexes
for (const tag of hashtags) {
  console.log(`[DELETE] Cleaning up hashtag #${tag}`);
  await this.hashtagManager.removeMessageFromTag(tag, messageKey);
}

// Get updated hashtag list after cleanup
const updatedHashtags = await this.hashtagManager.getAllHashtags(100);

// Broadcast message deletion and hashtag update to all clients
this.broadcast({
  messageDeleted: messageId,
  hashtagsUpdated: updatedHashtags,
});
```

**改造后**:

```javascript
// Get channel from the message data (single channel)
const channel = messageData.channel || 'general';
console.log(`[DELETE] Message in channel: #${channel}`);

// Remove this message from the channel index
// 注意：只从索引中移除消息，不删除 channel 本身
await this.channelManager.removeMessageFromChannel(channel, messageKey);

// Broadcast message deletion to all clients
// 不需要广播 channelsUpdated，因为 channel 列表没有变化
this.broadcast({
  messageDeleted: messageId,
});
```

**同样的改动应用到 PUT handler（消息编辑）**:

对于消息编辑，如果编辑后 channel 发生变化（虽然在当前设计中不太可能），需要：

1. 从旧 channel 索引中移除
2. 添加到新 channel 索引
3. 不删除任何 channel

### 4.3 API Client 改造

**文件**: `src/ui/api.mjs`

**改造**:

```javascript
class ChatAPI {
  // 改造前
  async getHashtags(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/hashtags`);
    if (!response.ok) {
      throw new Error('Failed to load hashtags');
    }
    return await response.json();
  }

  // 改造后
  async getChannels(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/channels`);
    if (!response.ok) {
      throw new Error('Failed to load channels');
    }
    return await response.json();
  }

  async getChannelMessages(roomName, channel, limit = 100) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/channel?channel=${encodeURIComponent(channel)}&limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error('Failed to load channel messages');
    }
    return await response.json();
  }

  async searchChannels(roomName, query, limit = 20) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/channel/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error('Failed to search channels');
    }
    return await response.json();
  }
}
```

### 4.4 Common 模块改造

**文件**: `src/common/hashtag.mjs`

**改造**: 保持不变（`regex` 仍然被前端使用）

或者重命名为 `src/common/channel.mjs`:

```javascript
// Regex for extracting channel names from text
// Supports: #word, where word can be:
// - English letters (a-z, A-Z)
// - Numbers (0-9)
// - Underscores (_)
// - Hyphens (-)
// - Chinese characters (Unicode range \u4e00-\u9fa5)
// Minimum length: 2 characters
export const channelRegex = /#([a-z0-9_\-\u4e00-\u9fa5]{2,32})/gi;
```

---

## 5. 样式实现（CSS）

### 5.1 Channel Panel 样式

**文件**: `src/ui/index.html` 的 `<style>` 部分

**新增 CSS**:

```css
/* ==================== Channel Panel ==================== */

#channel-panel {
  flex-shrink: 0;
  width: 180px;
  background: var(--background-alt);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.channel-panel-header {
  padding: var(--spacing-sm) var(--spacing);
  border-bottom: 1px solid var(--border);
  background: var(--background);
  flex-shrink: 0;
}

.channel-panel-header h3 {
  margin: 0;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.channel-panel-header h3 i {
  font-size: 1.2em;
}

.channel-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
}

.channel-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 6px 10px;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: var(--transition);
  margin-bottom: 2px;
  position: relative;
  font-size: 0.9em;
}

.channel-item:hover {
  background: var(--background);
}

.channel-item.active {
  background: var(--background);
  color: var(--links);
  font-weight: 600;
}

.channel-icon {
  font-size: 1.1em;
  color: var(--text-muted);
  flex-shrink: 0;
  font-weight: 600;
}

.channel-item.active .channel-icon {
  color: var(--links);
}

.channel-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-count {
  font-size: 0.8em;
  color: var(--text-muted);
  flex-shrink: 0;
}

.channel-unread-badge {
  position: absolute;
  right: 8px;
  background: #dc3545;
  color: white;
  border-radius: 10px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: bold;
  min-width: 16px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
}

.channel-add {
  padding: var(--spacing-sm);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.channel-add-btn {
  width: 100%;
  padding: var(--spacing-xs);
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  font-size: 0.85em;
  color: var(--text-muted);
}

.channel-add-btn:hover {
  background: var(--background);
  border-color: var(--links);
  color: var(--links);
}

/* ==================== Channel Context Menu ==================== */

#channel-context-menu {
  position: fixed;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 180px;
  padding: var(--spacing-xs) 0;
}

#channel-context-menu .context-menu-item {
  padding: var(--spacing-xs) var(--spacing);
  cursor: pointer;
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: 0.9em;
}

#channel-context-menu .context-menu-item:hover {
  background: var(--background-alt);
}

#channel-context-menu .context-menu-item i {
  font-size: 1.1em;
  color: var(--text-muted);
}

/* ==================== Channel References in Message Text ==================== */

.channel-reference {
  color: #1da1f2;
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition);
  padding: 0 2px;
  border-radius: 3px;
}

.channel-reference:hover {
  text-decoration: underline;
  background: rgba(29, 161, 242, 0.1);
}

.channel-reference:active {
  background: rgba(29, 161, 242, 0.2);
}

/* ==================== Mobile Responsive ==================== */

@media (max-width: 600px) {
  #channel-panel {
    display: none; /* 移动端隐藏，使用 dropdown */
  }

  /* Mobile channel selector (in top bar) */
  #mobile-channel-selector {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    font-size: 14px;
    cursor: pointer;
  }

  #mobile-channel-dropdown {
    position: fixed;
    top: 48px;
    left: 0;
    right: 0;
    background: white;
    border-bottom: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease;
    z-index: 100;
  }

  #mobile-channel-dropdown.visible {
    max-height: 300px;
    overflow-y: auto;
  }

  #mobile-channel-dropdown .channel-item {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
}
```

### 5.2 HTML 结构调整

**文件**: `src/ui/index.html`

**改造**:

```html
<!-- Main Container with Flex Layout -->
<div id="main-container">
  <!-- Left Sidebar for Room Navigation -->
  <div id="left-sidebar">
    <!-- 保持不变 -->
  </div>

  <!-- Channel Panel (NEW!) -->
  <div id="channel-panel">
    <div class="channel-panel-header">
      <h3>
        <i class="ri-hashtag"></i>
        <span>Channels</span>
      </h3>
    </div>
    <div class="channel-list">
      <!-- Channel items 动态生成 -->
    </div>
    <div class="channel-add">
      <button class="channel-add-btn">
        <i class="ri-add-line"></i>
        <span>Add Channel</span>
      </button>
    </div>
  </div>

  <!-- Chatroom -->
  <div id="chatroom">
    <!-- 保持不变 -->
  </div>

  <!-- Thread Panel -->
  <div id="thread-panel">
    <!-- 保持不变 -->
  </div>

  <!-- Right Sidebar (Room Info) -->
  <div id="right-sidebar">
    <!-- 移除 hashtag-container，只保留 roster-container -->
    <div id="roster-container">
      <!-- 保持不变 -->
    </div>
  </div>
</div>
```

**移动端顶部栏调整**:

```html
<div id="mobile-top-bar">
  <div id="mobile-top-bar-content">
    <span id="mobile-top-bar-icon">🏠</span>
    <span id="mobile-top-bar-title">Loading...</span>

    <!-- Channel Selector (NEW!) -->
    <div id="mobile-channel-selector">
      <span id="mobile-current-channel">#general</span>
      <i class="ri-arrow-down-s-line"></i>
    </div>

    <span id="mobile-top-bar-encryption" title="Encryption Status"></span>
    <span id="mobile-top-bar-arrow">▼</span>
  </div>
</div>

<!-- Mobile Channel Dropdown (NEW!) -->
<div id="mobile-channel-dropdown">
  <!-- Channel items 动态生成 -->
</div>
```

---

## 6. 数据迁移与向后兼容

### 6.1 现有数据处理

**问题**: 现有房间的 Durable Object 存储中可能存在：

- `hashtag:xxx` 索引键
- `hashtag_meta:xxx` 元数据键
- `hashtags:all` 全局列表

**方案**: **无需迁移，共存策略**

理由:

1. **新系统独立**: 使用 `channel:` 前缀，不冲突
2. **旧数据无害**: `hashtag:` 键不影响新功能
3. **自然过期**: 旧索引随着新消息的到来逐渐失效

**可选清理**（Phase 3）:

```javascript
// 管理接口: DELETE /api/room/:name/legacy-hashtags
app.delete('/legacy-hashtags', async (c) => {
  const keys = await this.storage.list({ prefix: 'hashtag' });
  const deletePromises = [];
  for (const key of keys.keys()) {
    deletePromises.push(this.storage.delete(key));
  }
  await Promise.all(deletePromises);
  return c.json({ deleted: keys.size });
});
```

### 6.2 向后兼容矩阵

| 客户端版本 | 服务端版本 | 行为                                                       |
| ---------- | ---------- | ---------------------------------------------------------- |
| 旧版本     | 旧版本     | ✅ 正常工作（hashtag 系统）                                |
| 旧版本     | 新版本     | ⚠️ 消息正常，但不发送 `channels` 字段 → 自动归入 `general` |
| 新版本     | 旧版本     | ❌ 不支持（需要升级服务端）                                |
| 新版本     | 新版本     | ✅ 完整功能（channel 系统）                                |

**服务端处理旧客户端**:

```javascript
// WebSocket message handler
let channels = data.channels || [];

// 如果客户端没有发送 channels（旧版本），尝试从消息中解析
if (channels.length === 0 && data.message && !data.message.startsWith('�')) {
  // 消息不是密文（旧系统的明文消息），尝试解析
  const regex = /#([a-z0-9_\-\u4e00-\u9fa5]{2,32})/gi;
  const matches = [...data.message.matchAll(regex)];
  channels = matches.map((m) => m[1].toLowerCase());
}

// 仍然为空，使用默认
if (channels.length === 0) {
  channels = ['general'];
}
```

---

## 7. 实现路线图

### Phase 1: 核心功能 (MVP) - 1-2 天

**目标**: 基本的 channel 系统工作

- [ ] 后端改造
  - [ ] 重命名 `hashtag.mjs` → `channel.mjs`
  - [ ] 修改 `webSocketMessage()` 接受 `channels` 字段
  - [ ] 更新 HTTP API 端点 (`/channels`, `/channel`)
  - [ ] 修改消息删除/编辑逻辑
- [ ] 前端改造
  - [ ] 消息发送时提取 channels
  - [ ] 消息接收时处理 channels
  - [ ] 更新 API client (`getChannels()`)
- [ ] UI 基础
  - [ ] 添加 Channel Panel HTML 结构
  - [ ] 实现基本样式
  - [ ] Channel 列表渲染
  - [ ] Channel 切换功能
- [ ] 测试
  - [ ] E2EE 房间正常工作
  - [ ] Channels 正确索引
  - [ ] 消息过滤正确

### Phase 2: UI/UX 增强 - 1 天

**目标**: 完善用户体验

- [ ] 视觉优化
  - [ ] Channel 标签样式（消息中）
  - [ ] 激活状态高亮
  - [ ] Hover 效果
- [ ] 交互增强
  - [ ] URL 同步 (`?channel=xxx`)
  - [ ] 未读消息 badge
  - [ ] 移动端 dropdown 选择器
  - [ ] Channel 点击动画
- [ ] 默认行为
  - [ ] 加入房间自动激活 `#general`
  - [ ] 确保 `#general` 始终排在第一位

### Phase 3: 高级功能 - 可选

**目标**: 类似 Discord 的完整体验

- [ ] Channel 管理
  - [ ] "Add Channel" 按钮功能（手动创建 channel）
  - [ ] Channel 重命名（管理员权限）
  - [ ] 空 channel 的显示处理（count = 0 时灰色显示）
  - [ ] Channel 排序选项（最近使用 / 字母顺序 / 消息数量）
  - [ ] 固定 channel 功能（类似 Discord 的 pinned channels）
- [ ] 权限系统
  - [ ] 房间创建者预设 channels
  - [ ] Channel 访问控制（可选）
- [ ] 搜索和过滤
  - [ ] Channel 搜索框
  - [ ] 多 channel 过滤（AND/OR）
- [ ] 数据清理
  - [ ] 旧 hashtag 数据清理接口
  - [ ] 管理面板
  - [ ] 手动清理空 channel 的工具

---

## 8. 测试计划

### 8.1 功能测试

#### 消息发送与接收

- [ ] 在 `#general` channel 发送消息 → 消息属于 `general`
- [ ] 在 `#design` channel 发送消息 → 消息属于 `design`
- [ ] 消息内容包含 `#feedback` → 不影响消息所属 channel，`#feedback` 是可点击引用
- [ ] 消息加密正常，channel 字段明文传输
- [ ] 切换到不同 channel → 只显示该 channel 的消息

#### Channel 索引

- [ ] 新消息添加到对应 channel 索引
- [ ] 删除消息时从 channel 索引中移除（但保留 channel）
- [ ] 删除 channel 中的所有消息后，channel 仍然存在（count = 0）
- [ ] 编辑消息时 channel 变化 → 索引更新
- [ ] `/channels` API 返回正确的 channel 列表（包括空 channel）
- [ ] Channel 计数准确

#### UI 交互

- [ ] 点击 Channel Panel 中的 channel → 只显示该 channel 的消息
- [ ] 切换 channel → URL 更新
- [ ] 刷新页面 → channel 状态保持（从 URL 恢复）
- [ ] 点击消息文本中的 `#design` 引用 → 切换到 design channel
- [ ] 未读消息 badge 正确显示和清除
- [ ] 消息输入框发送时 → 使用当前激活的 channel（不解析输入内容）
- [ ] 右键 channel → 显示上下文菜单
- [ ] 点击 "Remove from list" → channel 从列表中隐藏（本地操作）
- [ ] 隐藏的 channel 在收到新消息时自动重新显示
- [ ] 隐藏的 channel 信息保存到 localStorage
- [ ] "Show all channels" 恢复所有隐藏的 channel

### 8.2 兼容性测试

#### E2EE 集成

- [ ] E2EE 房间: 消息内容加密 ✅
- [ ] E2EE 房间: channels 数组明文 ✅
- [ ] E2EE 房间: channel 列表正常显示 ✅
- [ ] E2EE 房间: 切换 channel 正常工作 ✅

#### 向后兼容

- [ ] 旧客户端发送消息 → 服务端自动归入 `general`
- [ ] 新客户端接收旧消息（无 channels） → 不崩溃
- [ ] 混合环境下消息正常显示

### 8.3 边界测试

#### 输入验证

- [ ] Channel 名称包含特殊字符 → 过滤掉
- [ ] Channel 名称过长（>32 字符）→ 截断或拒绝
- [ ] Channel 名称过短（<2 字符）→ 拒绝
- [ ] 空 channels 数组 → 默认 `["general"]`
- [ ] 非数组的 channels 字段 → 处理为 `["general"]`

#### 性能测试

- [ ] 1000 条消息，10 个 channels → 切换流畅
- [ ] 100 个 channels → 列表渲染正常
- [ ] Channel 索引大小不超过限制（1000 条/channel）

### 8.4 移动端测试

- [ ] Channel dropdown 正常打开/关闭
- [ ] Touch 交互流畅
- [ ] 横屏模式下布局正常
- [ ] 小屏设备（< 360px）可用

---

## 9. 风险与缓解措施

### 9.1 技术风险

| 风险                        | 影响 | 概率 | 缓解措施                                      |
| --------------------------- | ---- | ---- | --------------------------------------------- |
| E2EE 与明文 channels 混淆   | 高   | 中   | 清晰的代码注释，文档说明                      |
| 前端解析 regex 与后端不一致 | 中   | 低   | 复用同一个 regex 定义（`common/channel.mjs`） |
| Channel 索引数据膨胀        | 中   | 低   | 限制每 channel 最多 1000 条消息（现有逻辑）   |
| 旧 hashtag 数据冲突         | 低   | 低   | 使用不同前缀（`channel:` vs `hashtag:`）      |

### 9.2 用户体验风险

| 风险                    | 影响 | 概率 | 缓解措施                           |
| ----------------------- | ---- | ---- | ---------------------------------- |
| 用户不理解 channel 概念 | 中   | 中   | 默认 `#general` 行为，降低学习曲线 |
| Channel 列表过长        | 低   | 中   | 搜索功能，按最近使用排序           |
| 移动端 channel 切换不便 | 中   | 高   | Dropdown 选择器，大触摸区域        |

### 9.3 安全风险

| 风险                       | 影响 | 概率 | 缓解措施                                    |
| -------------------------- | ---- | ---- | ------------------------------------------- |
| Channel 名称注入攻击       | 低   | 低   | 严格的输入验证和 HTML 转义                  |
| 恶意创建大量 channels      | 中   | 低   | Rate limiting，监控 channel 创建速度        |
| Channel 泄露消息内容       | 高   | 低   | Channel 只是分类标签，不包含消息内容        |
| 服务端 channel 数据膨胀    | 低   | 中   | 只在房间摧毁时清理，channel 元数据很小      |
| localStorage 隐藏列表过大  | 低   | 低   | 隐藏列表存储在 localStorage，有大小限制     |

---

## 10. 成功指标

### 10.1 技术指标

- [ ] E2EE 房间 channel 系统 100% 可用
- [ ] API 响应时间 < 100ms（channel 列表）
- [ ] Channel 切换延迟 < 50ms
- [ ] 零崩溃率（新功能相关）

### 10.2 功能完整性

- [ ] 所有 Phase 1 任务完成
- [ ] 测试覆盖率 > 80%（核心功能）
- [ ] 移动端和桌面端都可用

### 10.3 用户体验

- [ ] Channel 切换流畅（无明显闪烁）
- [ ] 默认行为直观（自动归入 `#general`）
- [ ] 移动端 channel 选择器易用

---

## 11. 文档更新清单

### 11.1 代码文档

- [ ] 更新 `.github/copilot-instructions.md`
  - [ ] 添加 "Channel System" 章节
  - [ ] 说明 channels 与 E2EE 的关系
  - [ ] 更新数据流图
- [ ] 更新 `README.md`
  - [ ] 添加 Channel 功能介绍
  - [ ] 更新架构图（添加 Channel Panel）

### 11.2 API 文档

- [ ] 创建 `docs/API.md`（如果不存在）
  - [ ] `/channels` 端点文档
  - [ ] `/channel` 端点文档
  - [ ] WebSocket 消息格式（包含 `channels` 字段）

### 11.3 用户文档

- [ ] 创建 `docs/User-Guide.md`
  - [ ] Channel 是什么
  - [ ] 如何使用 `#channel` 标记
  - [ ] 如何切换 channel
  - [ ] Channel 与加密的关系

---

## 12. 开放问题与决策点

### 12.1 需要确认的设计决策

#### Q1: 默认 channel 名称

- **选项 A**: `general` (英文)
- **选项 B**: `大厅` (中文)
- **选项 C**: `lobby` (英文)

**建议**: `general` - 符合 Discord/Slack 习惯，国际化友好

#### Q2: Channel Panel 宽度

- **选项 A**: 180px (建议值)
- **选项 B**: 200px (更宽，适合长 channel 名)
- **选项 C**: 160px (更紧凑)

**建议**: 180px - 平衡可读性和空间利用

#### Q3: 多 channel 筛选

- **选项 A**: MVP 只支持单选
- **选项 B**: 支持多选（AND 逻辑）
- **选项 C**: 支持多选（OR 逻辑）

**建议**: MVP 单选，Phase 3 考虑多选

#### Q4: Channel 创建方式

- **选项 A**: 通过 "Add Channel" 按钮创建（Discord 风格）
- **选项 B**: 用户手动切换到不存在的 channel 时自动创建
- **选项 C**: Phase 3 功能，MVP 使用预设 channels

**建议**: 选项 C（Phase 3）- MVP 阶段，消息发送到任何 channel 都会自动创建索引

#### Q5: Channel 排序

- **选项 A**: 按最后使用时间（最近的在上）
- **选项 B**: 字母顺序
- **选项 C**: 按消息数量

**建议**: `general` 固定在最上方，其他按最后使用时间排序

### 12.2 待讨论的技术细节

1. **Channel 名称国际化**: 是否允许中文 channel 名？
   - 当前 regex 支持中文
   - 需要测试中文输入的边界情况

2. **Channel 历史加载**: 切换 channel 时是否需要从服务端加载历史消息？
   - MVP: 只过滤当前已加载的消息
   - Phase 2: 按需加载历史

3. **Channel 通知**: 是否需要每个 channel 独立的通知设置？
   - Phase 3 功能

4. **消息跨 channel 引用**: 用户在 #general 中点击 #design 引用后，是否需要显示被引用的上下文？
   - MVP: 只是简单切换到 #design channel
   - Phase 3: 考虑高亮被引用的消息（如果有具体 messageId）

5. **空 channel 的处理**: 当 channel 中的所有消息都被删除后，是否显示空 channel？
   - MVP: 保留 channel，显示 count = 0
   - 用户可以通过右键菜单"Remove from list"隐藏不需要的空 channel（本地操作）
   - Phase 3: 提供选项灰色显示空 channel

6. **Channel 的生命周期**: 
   - **创建**: 首次发送消息到某个 channel 时自动创建
   - **保持**: 删除消息不删除 channel，即使 count = 0
   - **隐藏**: 用户可以本地隐藏不感兴趣的 channel（右键菜单）
   - **摧毁**: 只有在房间被摧毁时，服务端才删除所有 channel 数据

---

## 13. 附录

### 13.1 相关文件清单

**需要修改的文件**:

- `src/api/chat.mjs` - 主要后端逻辑
- `src/api/hashtag.mjs` → `src/api/channel.mjs` - 重命名和改造
- `src/ui/index.mjs` - 前端主逻辑
- `src/ui/index.html` - HTML 结构和 CSS
- `src/ui/api.mjs` - API 客户端
- `src/common/hashtag.mjs` - 可选重命名

**需要新增的文件**:

- `docs/PRD-Channels.md` - 本文档
- `docs/API.md` - API 文档（可选）
- `docs/User-Guide.md` - 用户指南（可选）

### 13.2 关键代码片段索引

- **消息发送使用当前 channel**: `src/ui/index.mjs` 约 Line 2200-2250
- **消息接收解析 #channel 引用**: `src/ui/index.mjs` 的 `ChatMessage.renderChannelReferences()` 方法
- **服务端 channel 处理**: `src/api/chat.mjs` 约 Line 1070-1090
- **Channel 索引更新**: `src/api/channel.mjs` 的 `indexMessage()` 方法
- **Channel 列表渲染**: `src/ui/index.mjs` 的 `renderChannelPanel()` 函数
- **Channel 切换过滤**: `src/ui/index.mjs` 的 `filterMessagesByChannel()` 函数

### 13.3 参考资源

- **Discord Channel 设计**: https://discord.com
- **Slack Channel 设计**: https://slack.com
- **Cloudflare Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **Web Crypto API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API

---

## 14. 版本历史

| 版本 | 日期       | 作者           | 变更说明           |
| ---- | ---------- | -------------- | ------------------ |
| 1.0  | 2025-11-01 | GitHub Copilot | 初始版本，完整 PRD |

---

## 15. 审批与签字

| 角色         | 姓名 | 签字 | 日期 |
| ------------ | ---- | ---- | ---- |
| 产品负责人   |      |      |      |
| 技术负责人   |      |      |      |
| UI/UX 设计师 |      |      |      |

---

**END OF DOCUMENT**
