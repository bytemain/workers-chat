# Workers Chat - Feature Development Plan

> 基于代码分析的高收益新特性规划  
> 分析日期: 2025-11-20

## 📊 优先级评分标准

- **收益**: ⭐ (1-5星，影响用户体验的程度)
- **难度**: 低/中/高
- **状态**: 🟡 计划中 | 🟢 进行中 | ✅ 已完成

---

## 🎯 Phase 1: 核心体验增强 (Q1 2025)

### 1. 用户在线状态指示器 (User Presence)

**收益**: ⭐⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 实时显示用户在线/离线状态（绿点/灰点）
- "正在输入..." 指示器
- 用户最后活跃时间
- 在线用户列表排序

#### 技术实现

- 利用 Durable Objects 的 `broadcast()` 机制
- WebSocket Hibernation API 生命周期事件
- 心跳机制检测用户活跃状态
- TinyBase 存储用户状态数据

#### 相关文件

- `src/api/chat.mjs` - ChatRoom DO 添加 presence 广播
- `src/ui/components/user-roster.mjs` - 添加在线状态 UI
- `src/ui/index.mjs` - 监听输入事件发送 typing 信号

#### 代码位置

- 当前代码无 typing/presence/online 实现
- `grep_search` 结果: 0 matches

---

### 2. 消息已读状态 (Read Status)

**收益**: ⭐⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 标记消息为已读/未读
- 频道未读消息计数（红点徽章）
- "跳转到第一条未读消息" 功能
- 已读/未读消息视觉区分

#### 技术实现

- 扩展现有 `src/ui/tinybase/read-status.mjs`
- 使用 TinyBase Relationships 跟踪读取状态
- IndexedDB 持久化已读位置
- Reef.js 响应式 UI 更新

#### 相关文件

- `src/ui/tinybase/read-status.mjs` ⚠️ 已存在但不完整
- `src/ui/components/channel-list.mjs` - 添加未读徽章
- `src/ui/components/message-list.mjs` - 添加未读分隔线

---

### 3. 推送通知 (Push Notifications)

**收益**: ⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 浏览器桌面通知
- @提及通知（优先级高）
- 新消息通知（可配置）
- DM 消息通知
- 通知权限管理

#### 技术实现

- Service Worker 已配置 (`workbox-config.js`)
- Web Push API
- Notification API
- TinyBase 监听消息变化触发通知

#### 相关文件

- `workbox-config.js` ✅ 已配置
- `src/ui/app.manifest.json` - 添加通知权限
- 新建 `src/ui/notifications.mjs`

---

## 🚀 Phase 2: 功能完善 (Q2 2025)

### 4. Threads 系统增强

**收益**: ⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- Thread 列表视图（所有活跃 threads）
- Thread 未读计数
- Thread 通知
- Thread 预览/摘要
- 改善 Thread 导航体验

#### 技术实现

- 完善 `src/ui/mobile/channel-info.mjs` 的 Threads tab
- TinyBase Indexes: `threadsByActivity`
- API: `/api/room/:name/threads` (GET)

#### 相关文件

- `src/ui/mobile/channel-info.mjs` ⚠️ Line 624: TODO
- `src/ui/index.mjs` - 扩展现有 thread 功能
- `src/api/chat.mjs` - 添加 threads 查询 API

---

### 5. Direct Messages (DM) 完善

**收益**: ⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- DM 频道管理（创建/删除）
- 私聊用户列表
- DM 未读提醒
- DM 搜索/过滤
- 群聊支持（可选）

#### 技术实现

- 当前 DM 通过 `dm-{username}` 频道实现
- 添加 DM 专用 UI 组件
- TinyBase 表: `dms`

#### 相关文件

- `src/ui/index.mjs` ⚠️ Line 3154: TODO - Implement DM functionality
- 新建 `src/ui/components/dm-list.mjs`

---

### 6. 消息搜索增强

**收益**: ⭐⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 全文搜索索引优化
- 搜索历史记录
- 高级过滤器（日期范围、文件类型、用户）
- 搜索结果高亮和快速跳转
- 搜索自动完成

#### 技术实现

- TinyBase Queries 优化
- IndexedDB 缓存搜索结果
- Lunr.js / Flexsearch 全文索引（可选）

#### 相关文件

- `src/ui/index.mjs` - 现有搜索功能（Line ~3100+）
- 扩展 `performSearch()` 函数

---

## 💎 Phase 3: 差异化功能 (Q3 2025)

### 7. 语音/视频通话 (WebRTC)

**收益**: ⭐⭐⭐⭐⭐  
**难度**: 高  
**状态**: 🟡 计划中

#### 功能描述

- 1v1 语音通话
- 1v1 视频通话
- 屏幕共享
- 通话历史记录
- 群组语音（可选）

#### 技术实现

- WebRTC PeerConnection
- Durable Objects 作为信令服务器
- STUN/TURN 服务器配置
- Cloudflare Calls API（可选）

#### 相关文件

- 新建 `src/ui/webrtc/` 目录
- 新建 `src/api/signaling.mjs` (DO for signaling)

#### 备注

**这是最大的差异化功能！** 完全边缘化的实时音视频通信。

---

### 8. 富文本编辑器

**收益**: ⭐⭐⭐⭐  
**难度**: 高  
**状态**: 🟡 计划中

#### 功能描述

- WYSIWYG 编辑器
- 拖拽上传文件/图片
- @ 提及用户（mentions）
- Emoji 选择器
- 代码块语法高亮编辑
- Markdown 快捷键

#### 技术实现

- Lexical / Slate / ProseMirror
- 保持 Markdown 作为存储格式
- 双向转换（富文本 ↔ Markdown）

#### 相关文件

- 替换 `src/ui/web-components/chat-input-component.mjs`
- 新建 `src/ui/editor/` 目录

---

### 9. 文件预览系统

**收益**: ⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 图片画廊浏览（左右翻页）
- PDF 在线预览
- 视频播放器
- 音频播放器
- 代码文件语法高亮
- Cloudflare Images 集成

#### 技术实现

- Cloudflare Images for image optimization
- PDF.js for PDF rendering
- Monaco Editor for code preview

#### 相关文件

- `src/ui/index.mjs` - `LazyImg` 和 `FileMessage` 组件
- 新建 `src/ui/components/file-preview.mjs`

---

### 10. 消息反应增强

**收益**: ⭐⭐⭐  
**难度**: 低  
**状态**: 🟡 计划中

#### 功能描述

- 自定义 emoji 反应
- 反应统计和排行
- 快速反应快捷键（1-9）
- 反应动画效果
- 反应搜索

#### 技术实现

- 扩展现有 `src/ui/reactions/` 模块
- Emoji picker 组件

#### 相关文件

- `src/ui/reactions/` ✅ 基础设施已存在
- `src/ui/reactions/config.mjs` - 扩展反应类型
- `src/ui/reactions/ui.mjs` - 增强 UI

---

## 🔧 Phase 4: 性能与体验优化 (Q4 2025)

### 11. 虚拟滚动 (Virtual Scrolling)

**收益**: ⭐⭐⭐⭐  
**难度**: 高  
**状态**: 🟡 计划中

#### 功能描述

- 大量消息时的性能优化
- 平滑滚动体验
- 自动加载历史消息

#### 技术实现

- React Window / Tanstack Virtual
- Intersection Observer API

---

### 12. 离线模式增强

**收益**: ⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 离线消息队列
- 自动重连重试
- 离线消息缓存
- 同步状态指示

#### 技术实现

- Service Worker 缓存策略
- IndexedDB 离线存储
- Background Sync API

---

### 13. 国际化 (i18n)

**收益**: ⭐⭐⭐  
**难度**: 中等  
**状态**: 🟡 计划中

#### 功能描述

- 多语言支持（中文、英文）
- 语言自动检测
- 时间格式本地化

#### 技术实现

- i18next / Intl API
- JSON 语言包

---

## 🌐 Phase 5: 去中心化与 P2P 增强 (WebRTC 深度集成)

> 利用 Durable Objects 作为信令服务器，实现真正的点对点数据传输，降低服务器成本并极大提升隐私性。

### 14. P2P 桌面/屏幕共享

**收益**: ⭐⭐⭐⭐⭐
**难度**: 高
**状态**: 🟡 计划中

#### 功能描述

- 1v1 或群组内的屏幕共享
- 支持分享整个屏幕、特定应用窗口或浏览器标签页
- 低延迟、高画质（取决于双方带宽）
- 配合语音通话使用

#### 技术实现

- `navigator.mediaDevices.getDisplayMedia()`
- WebRTC Video Track
- DO 仅作为信令交换 SDP

### 15. P2P 加密大文件传输 (无限制)

**收益**: ⭐⭐⭐⭐⭐
**难度**: 高
**状态**: 🟡 计划中

#### 功能描述

- **不经过服务器/R2**，直接点对点发送文件
- 支持 **GB 级别** 超大文件
- 极速传输（局域网内可达千兆速度）
- 真正的端到端加密（WebRTC 默认加密 + 应用层二次加密）
- 传输中断断点续传

#### 技术实现

- WebRTC `RTCDataChannel`
- File System Access API (用于处理大文件读写)
- 流式加密传输

### 16. "幽灵模式" P2P 聊天 (Serverless Chat)

**收益**: ⭐⭐⭐⭐⭐
**难度**: 高
**状态**: 🟡 计划中

#### 功能描述

- **完全不经过 DO 存储和转发**
- 消息直接通过 WebRTC Data Channel 传输
- 服务器无法记录日志（只知道建立了连接）
- 真正的"阅后即焚"（内存级，不落盘）
- 适合极度敏感的对话

#### 技术实现

- 建立 P2P Mesh 网络
- 仅使用 DO 进行初始握手 (Handshake)
- 纯内存消息处理

### 17. 本地 AI 助手集成 (Local LLM)

**收益**: ⭐⭐⭐⭐
**难度**: 高
**状态**: 🟡 计划中

#### 功能描述

- 在浏览器端运行小模型 (WebLLM)
- 或连接本地运行的 Ollama 服务
- 对聊天记录进行本地总结、翻译、润色
- **数据不出本地**，隐私绝对安全

#### 技术实现

- WebGPU
- WebLLM / Transformers.js

---

## 📝 技术债务清理

### 待完成的 TODO 项

从代码中提取的 TODO 列表：

1. **Pinned Messages** (Line 501)

   ```javascript
   // TODO: Could load the channel if message is in a different channel
   ```

2. **Channel Info - Threads** (Line 624)

   ```javascript
   // TODO: Implement threads API
   ```

3. **Channel Info - Links** (Line 633)

   ```javascript
   // TODO: Extract links from messages
   ```

4. **Channel Info - Files** (Line 642)

   ```javascript
   // TODO: Load file messages
   ```

5. **Room Settings** (Line 3121)

   ```javascript
   // TODO: Add more room settings in the future
   ```

6. **DM Functionality** (Line 3154)

   ```javascript
   // TODO: Implement DM functionality
   ```

7. **Room Settings Menu** (Line 4875)

   ```javascript
   // TODO: Show room settings menu
   ```

8. **File Crypto Storage Format** (Line 237)
   ```javascript
   // TODO: Improve storage format, record each chunk's IV in metadata
   ```

---

## 🎨 UI/UX 改进清单

### 移动端优化

- [ ] 手势操作（滑动返回、长按菜单）
- [ ] 触觉反馈
- [ ] 移动端导航优化
- [ ] 横屏布局支持

### 桌面端优化

- [ ] 键盘快捷键系统
- [ ] 多窗口支持
- [ ] 拖拽排序频道
- [ ] 自定义主题

### 可访问性

- [ ] ARIA 标签完善
- [ ] 键盘导航
- [ ] 屏幕阅读器支持
- [ ] 高对比度模式

---

## 📊 成功指标

### 用户参与度

- 日活跃用户 (DAU)
- 消息发送量
- 平均会话时长
- 用户留存率

### 技术指标

- WebSocket 连接稳定性
- 消息延迟 (P50/P95/P99)
- 加密/解密性能
- 错误率

### 性能指标

- 首屏加载时间 (FCP)
- 交互就绪时间 (TTI)
- 内存占用
- Durable Object 费用

---

## 🔗 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Durable Objects 文档](https://developers.cloudflare.com/durable-objects/)
- [TinyBase 文档](https://tinybase.org/)
- [Reef.js 文档](https://reefjs.com/)
- [WebRTC 文档](https://webrtc.org/)

---

## 📌 优先级建议

基于投入产出比，建议按以下顺序实现：

1. ✅ **用户在线状态** - 快速见效，用户最明显感知
2. ✅ **消息已读状态** - 核心功能，显著提升体验
3. ✅ **推送通知** - Service Worker 已配置，易于实现
4. ⚡ **完善 Threads** - 基础已有，补全即可
5. 🚀 **语音/视频通话** - 差异化功能，最大亮点

---

## 更新日志

- **2025-11-20**: 初始版本，基于代码分析创建特性规划
