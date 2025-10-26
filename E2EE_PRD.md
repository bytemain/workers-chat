# 端对端加密(E2EE)功能 - 产品需求文档 (PRD)

## 1. 概述

### 1.1 产品目标
为 Cloudflare Workers Chat 应用实现端对端加密(End-to-End Encryption)功能，确保消息、文件和图片在传输和存储过程中的隐私安全，使得除了通信双方外，包括服务器在内的任何第三方都无法读取加密内容。

### 1.2 背景
当前的聊天应用在服务器端以明文方式存储消息和文件，虽然使用了 HTTPS 传输加密，但服务器管理员理论上可以访问所有消息内容。端对端加密将提供更高级别的隐私保护。

### 1.3 核心原则：客户端加密，服务端存储密文

**⚠️ 重要说明：这是一个零信任的客户端加密方案**

```
┌─────────────────────────────────────────────────────────────┐
│                  客户端（浏览器）                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  明文消息 "Hello World"                                       │
│       ↓                                                       │
│  🔑 使用房间密钥加密（AES-256-GCM）                          │
│       ↓                                                       │
│  密文 "ENCRYPTED:{iv:[...], ciphertext:[...]}"               │
│                                                               │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ 通过 HTTPS 传输加密数据
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Workers 服务端                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  接收到的数据（服务端看到的）：                              │
│  {                                                            │
│    "name": "Alice",                                          │
│    "message": "ENCRYPTED:{iv:[12,34,...], ciphertext:[...]}" │
│  }                                                            │
│                                                               │
│  ❌ 服务端无法解密（没有密钥）                                │
│  ✅ 仅存储密文到 Durable Objects                             │
│  ✅ 仅转发密文给其他客户端                                    │
│                                                               │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ 密文存储（永久）
                        ▼
┌─────────────────────────────────────────────────────────────┐
│           Durable Objects / R2 Storage                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  存储的数据（密文）：                                         │
│  - 消息密文：ENCRYPTED:{...}                                 │
│  - 文件密文：encrypted_image.jpg.enc                         │
│  - 元数据：用户名、时间戳（明文）                            │
│                                                               │
│  ❌ 服务器管理员无法读取内容                                  │
│  ✅ 数据库备份也是密文                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ 返回密文给其他客户端
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              其他客户端（浏览器）                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  接收密文 "ENCRYPTED:{iv:[...], ciphertext:[...]}"           │
│       ↓                                                       │
│  🔓 使用房间密钥解密（AES-256-GCM）                          │
│       ↓                                                       │
│  明文消息 "Hello World"                                       │
│       ↓                                                       │
│  显示给用户                                                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**关键点**：
- ✅ **加密在客户端完成**：所有加密/解密操作都在用户的浏览器中进行
- ✅ **密钥不离开客户端**：房间密码和派生的加密密钥仅存储在用户浏览器的 IndexedDB 中
- ✅ **服务端只存储密文**：服务器（Durable Objects/R2）只能看到和存储加密后的数据
- ✅ **服务端无法解密**：服务器没有密钥，即使管理员也无法读取消息内容
- ✅ **存储结构不变**：Durable Objects 和 R2 的存储结构保持不变，只是存储的内容从明文变为密文
- ✅ **传输层依然使用 HTTPS**：在加密内容之上再加一层传输加密

**对服务端的影响**：
- ✅ **零改动存储逻辑**：服务端 API 不需要修改，继续存储 `message` 字段
- ✅ **零改动数据结构**：Durable Objects 数据结构完全一致
- ✅ **零改动文件存储**：R2 继续存储文件，只是文件内容是加密的
- ✅ **向后兼容**：未加密的房间依然正常工作

### 1.4 与现有系统的关系

| 组件 | 当前状态 | E2EE 后状态 | 是否需要修改 |
|------|---------|------------|-------------|
| **客户端 UI** | 发送/接收明文消息 | 发送前加密，接收后解密 | ✅ 需要修改 |
| **WebSocket 通信** | 传输明文消息 | 传输密文消息 | ❌ 不需要修改 |
| **Durable Objects** | 存储明文消息 | 存储密文消息 | ❌ 不需要修改 |
| **R2 存储** | 存储明文文件 | 存储加密文件 | ❌ 不需要修改 |
| **Workers API** | 转发明文消息 | 转发密文消息 | ❌ 不需要修改 |
| **数据库结构** | `{message: "Hello"}` | `{message: "ENCRYPTED:{...}"}` | ❌ 不需要修改 |

**总结：所有加解密逻辑在客户端，服务端只是"无知的搬运工"**

### 1.3 适用范围
- 文本消息加密
- 文件上传和下载加密
- 图片加密传输和显示
- 聊天历史加密存储
- 线程回复加密

---

## 2. 技术架构

### 2.1 客户端-服务端职责划分

**设计原则：客户端加密，服务端盲传**

```javascript
// ===== 客户端职责 =====
✅ 用户输入房间密码
✅ 使用 PBKDF2 从密码派生 AES-256 密钥
✅ 使用密钥加密消息（AES-GCM）
✅ 发送密文到服务器
✅ 从服务器接收密文
✅ 使用密钥解密消息
✅ 显示明文给用户
✅ 管理密钥（存储在 IndexedDB）

// ===== 服务端职责 =====
✅ 接收客户端发送的密文消息
✅ 存储密文到 Durable Objects
✅ 转发密文给其他客户端
✅ 存储加密文件到 R2
✅ 返回加密文件给客户端
❌ 不知道房间密码
❌ 不知道加密密钥
❌ 不进行任何加解密操作
❌ 无法读取消息内容
```

**数据流示例**：

```javascript
// 客户端发送消息
// 步骤 1：用户输入（客户端）
const userInput = "Hello, this is a secret message!";

// 步骤 2：加密（客户端）
const roomKey = await keyManager.getRoomKey(roomId);  // 从 IndexedDB 读取
const encrypted = await CryptoUtils.encryptMessage(userInput, roomKey);
// encrypted = {
//   iv: [12, 34, 56, ...],
//   ciphertext: [78, 90, 12, ...],
//   version: "1.0"
// }

// 步骤 3：发送到服务器（客户端）
websocket.send(JSON.stringify({
  name: "Alice",
  message: `ENCRYPTED:${JSON.stringify(encrypted)}`,
  messageId: "uuid-123",
  encryptionType: "e2ee-aes256-gcm"
}));

// 步骤 4：服务器接收（服务端 - Cloudflare Workers）
// 服务器看到的数据：
{
  "name": "Alice",  // 明文（公开信息）
  "message": "ENCRYPTED:{iv:[12,34,...], ciphertext:[78,90,...]}", // 密文
  "messageId": "uuid-123",
  "encryptionType": "e2ee-aes256-gcm"
}
// ❌ 服务器无法解密这段消息！

// 步骤 5：存储到 Durable Objects（服务端）
await this.storage.put(timestamp, {
  name: "Alice",
  message: "ENCRYPTED:{...}",  // 存储的是密文！
  messageId: "uuid-123",
  encryptionType: "e2ee-aes256-gcm"
});
// 数据库中永久存储的是密文

// 步骤 6：转发给其他客户端（服务端）
this.broadcast({
  name: "Alice",
  message: "ENCRYPTED:{...}",  // 转发的也是密文
  messageId: "uuid-123"
});

// 步骤 7：其他客户端接收（客户端）
websocket.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  
  if (data.message.startsWith("ENCRYPTED:")) {
    // 步骤 8：解密（客户端）
    const encryptedData = JSON.parse(data.message.substring(10));
    const roomKey = await keyManager.getRoomKey(roomId);  // 从 IndexedDB 读取
    const plaintext = await CryptoUtils.decryptMessage(encryptedData, roomKey);
    // plaintext = "Hello, this is a secret message!"
    
    // 步骤 9：显示明文（客户端）
    displayMessage({
      name: data.name,
      message: plaintext  // 显示解密后的明文
    });
  }
};
```

**关键对比：加密前 vs 加密后**

| 阶段 | 未加密（当前） | 加密后（E2EE） | 说明 |
|------|---------------|----------------|------|
| **用户输入** | "Hello World" | "Hello World" | 相同 |
| **客户端处理** | 直接发送 | 加密后发送 | ✅ 变化 |
| **WebSocket 传输** | `{"message": "Hello World"}` | `{"message": "ENCRYPTED:{...}"}` | ✅ 变化（内容） |
| **服务端接收** | 看到明文 | 看到密文 | ✅ 变化（可见性） |
| **Durable Objects 存储** | 存储明文 | 存储密文 | ✅ 变化（内容） |
| **服务端转发** | 转发明文 | 转发密文 | ✅ 变化（内容） |
| **客户端接收** | 直接显示 | 解密后显示 | ✅ 变化 |
| **用户看到** | "Hello World" | "Hello World" | 相同 |

**服务端存储示例**：

```javascript
// Durable Objects 中存储的数据（加密前）
{
  "key": "2025-10-26T10:30:00.000Z",
  "value": {
    "name": "Alice",
    "message": "Hello World",  // ❌ 明文，服务器可见
    "messageId": "uuid-123"
  }
}

// Durable Objects 中存储的数据（加密后）
{
  "key": "2025-10-26T10:30:00.000Z",
  "value": {
    "name": "Alice",
    "message": "ENCRYPTED:{iv:[12,34,...], ciphertext:[78,90,...]}",  // ✅ 密文，服务器不可见
    "messageId": "uuid-123",
    "encryptionType": "e2ee-aes256-gcm"
  }
}
// 注意：数据结构完全一致，只是 message 字段的内容从明文变为密文！
```

### 2.2 加密方案

#### 2.1.1 基于房间密码

**核心思路**: 用户只需输入一个简单的"房间密码"，系统自动从密码派生加密密钥。

- **用户输入**: 房间密码（8-64 字符，可以是任何文本）
- **密钥派生**: PBKDF2-SHA256（100,000+ 次迭代）
- **加密算法**: AES-GCM (256-bit)
- **优势**: 
  - ✅ 用户只需记住一个密码
  - ✅ 无需管理复杂的密钥
  - ✅ 可以口头分享或写在纸上
  - ✅ 支持跨设备访问

**密码→密钥转换流程**:
```javascript
用户密码 "mySecretRoom123" 
  ↓ PBKDF2 (100,000 iterations, salt: roomId)
  ↓
AES-256 密钥 (用于加密消息)
```


### 2.3 密钥管理架构

**核心原则：密钥永不离开客户端**

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (浏览器)                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           IndexedDB (本地存储)                       │  │
│  │                                                       │  │
│  │  roomPasswords:                                      │  │
│  │    - roomId: "abc123"                                │  │
│  │    - password: "mySecret123"  ← 存储在用户设备      │  │
│  │                                                       │  │
│  │  roomKeys (缓存):                                    │  │
│  │    - roomId: "abc123"                                │  │
│  │    - key: [AES-256 密钥数据]  ← 从密码派生         │  │
│  │                                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│           ↓                            ↓                      │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  用户身份密钥对   │         │   房间会话密钥    │          │
│  │  (RSA/ECDH)     │◄────────┤   (AES-256)     │          │
│  │  - 公钥          │         │   - 对称密钥      │          │
│  │  - 私钥 (本地)   │         │   - 每个房间独立  │          │
│  └──────────────────┘         └──────────────────┘          │
│           │                            │                      │
│           │                            │                      │
│           ▼                            ▼                      │
│  ┌─────────────────────────────────────────────────┐        │
│  │         加密/解密引擎 (Web Crypto API)           │        │
│  └─────────────────────────────────────────────────┘        │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
                             │ 🔒 只传输加密后的数据
                             │ ❌ 密钥永不通过网络传输
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ❌ 没有密码                                                  │
│  ❌ 没有密钥                                                  │
│  ❌ 无法解密                                                  │
│                                                               │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │   Durable Object │         │    R2 Storage    │          │
│  │  - 存储密文       │────────▶│  - 存储加密文件   │          │
│  │  - 元数据         │         │  - 密文 Blob     │          │
│  │  - 不知道密钥     │         │  - 不可解密       │          │
│  └──────────────────┘         └──────────────────┘          │
│                                                               │
│  存储示例（服务端视角）：                                     │
│  {                                                            │
│    "message": "ENCRYPTED:{iv:[...], ciphertext:[...]}"       │
│  }                                                            │
│  ↑ 服务器只看到这些，无法知道原文是什么                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**密钥生命周期**：

```
1️⃣ 用户创建房间
   ↓
   输入房间密码："mySecret123"
   ↓
   [客户端] 密码存储到 IndexedDB
   ↓
   [客户端] PBKDF2 派生 AES-256 密钥
   ↓
   [客户端] 密钥缓存到内存/IndexedDB
   ❌ 密码和密钥从不发送到服务器

2️⃣ 用户发送消息
   ↓
   [客户端] 从 IndexedDB 读取密码
   ↓
   [客户端] 从密码派生密钥（或使用缓存）
   ↓
   [客户端] 使用密钥加密消息
   ↓
   [客户端] 发送密文到服务器
   ↓
   [服务端] 存储密文（无法解密）

3️⃣ 其他用户加入房间
   ↓
   输入相同的房间密码："mySecret123"
   ↓
   [客户端] 密码存储到 IndexedDB
   ↓
   [客户端] PBKDF2 派生相同的 AES-256 密钥
   ↓
   [客户端] 使用密钥解密历史消息
   ✅ 服务器只是转发密文，不参与加解密

4️⃣ 用户离开并重新访问
   ↓
   [客户端] 从 IndexedDB 读取保存的密码
   ↓
   [客户端] 自动派生密钥
   ↓
   [客户端] 自动解密消息
   ✅ 无需重新输入密码
```

**对比传统架构**：

| 传统架构（中心化） | E2EE 架构（去中心化） |
|-------------------|---------------------|
| 🔑 密钥存储在服务器 | 🔑 密钥存储在客户端 |
| 🔒 服务器端加密 | 🔒 客户端加密 |
| 👁️ 服务器可读取内容 | ❌ 服务器无法读取 |
| ⚠️ 服务器被攻击 = 数据泄露 | ✅ 服务器被攻击 = 仅密文泄露 |
| 💾 数据库存储明文/可解密数据 | 💾 数据库存储密文 |
| 🔧 需要服务器端密钥管理 | 🔧 无需服务器端密钥管理 |

**服务端完全不参与加密过程**：

```javascript
// ===== 服务端代码（Durable Objects）=====
// 注意：服务端代码不需要任何加密逻辑！

class ChatRoom {
  async handleMessage(request) {
    const { message, name, messageId } = await request.json();
    
    // ✅ 直接存储，不管是明文还是密文
    await this.storage.put(Date.now(), {
      name,
      message,  // 可能是 "Hello" 或 "ENCRYPTED:{...}"，服务端不关心
      messageId
    });
    
    // ✅ 直接广播，不进行任何处理
    this.broadcast({ name, message, messageId });
    
    // ❌ 没有任何解密代码
    // ❌ 没有任何密钥管理代码
    // ❌ 服务端完全"无知"
  }
}
```

**安全性保证**：

✅ **即使服务器被完全攻破**：
  - 攻击者获取数据库：只能看到密文
  - 攻击者获取代码：没有密钥，无法解密
  - 攻击者监听网络：只能看到 HTTPS 加密的密文传输

✅ **即使数据库备份泄露**：
  - 备份中的消息都是密文
  - 没有密钥无法解密

✅ **即使服务器管理员恶意**：
  - 管理员无法读取用户消息
  - 管理员无法伪造加密消息（没有密钥）

❌ **唯一风险**：
  - 用户自己泄露密码
  - 客户端设备被攻击（物理访问）
  - 恶意浏览器扩展（用户责任）

---

## 3. 功能详细设计

### 3.1 房间初始化与密钥生成

#### 3.1.1 创建加密房间（房间密码方案）

**设计原则：默认加密，用户友好**

**默认行为（推荐）：使用房间名作为默认密码**
- ✅ 如果用户不主动设置密码，**自动使用房间名作为密码**
- ✅ 提供基本的隐私保护（陌生人无法随意加入）
- ✅ 降低用户使用门槛（无需记忆额外密码）
- ✅ 用户可以选择使用自定义密码以提高安全性

**用户流程**:
1. 用户创建房间，输入房间名："Team Meeting"
2. **系统提示加密选项（简化版）**
   ```
   ┌────────────────────────────────────────────┐
   │  🔒 Room Privacy Settings                  │
   ├────────────────────────────────────────────┤
   │                                            │
   │  Room Name: Team Meeting                   │
   │                                            │
   │  🔐 Privacy Level:                         │
   │  ● Basic (Use room name as password)       │
   │    Others need to know the room name       │
   │                                            │
   │  ○ Enhanced (Set custom password)          │
   │    [________________]                      │
   │                                            │
   │  ○ Public (No encryption)                  │
   │                                            │
   │  💡 Recommended: Basic privacy is enabled  │
   │     by default for your protection.        │
   │                                            │
   │  [Create Room]                             │
   └────────────────────────────────────────────┘
   ```

3. **场景 A：用户选择基础隐私（默认）**
   - 系统使用房间名 "Team Meeting" 作为密码
   - 派生加密密钥
   - 提示："Share room name with your team to join"
   
4. **场景 B：用户选择增强隐私**
   - 用户输入自定义密码（如 "SecretPass123"）
   - 系统使用自定义密码派生密钥
   - 提示："Share room name AND password with your team"
   
5. **场景 C：用户选择公开（不加密）**
   - 不使用加密
   - 任何人知道房间 ID 即可加入

**技术实现**:
```javascript
async function createRoom(roomName, privacyLevel = 'basic') {
  const roomId = generateRoomId();
  
  let password = null;
  let encrypted = false;
  
  switch (privacyLevel) {
    case 'basic':
      // 默认：使用房间名作为密码
      password = roomName;
      encrypted = true;
      console.log("🔒 基础加密：使用房间名作为密码");
      break;
      
    case 'enhanced':
      // 增强：用户自定义密码
      password = customPassword;  // 用户输入
      encrypted = true;
      console.log("🔐 增强加密：使用自定义密码");
      break;
      
    case 'public':
      // 公开：不加密
      password = null;
      encrypted = false;
      console.log("🌐 公开房间：不加密");
      break;
  }
  
  // 如果启用加密，生成验证数据
  if (encrypted && password) {
    const verificationData = await generateVerificationData(roomId, password);
    
    // 创建房间
    const response = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        name: roomName,
        encrypted: true,
        verificationData,
        privacyLevel  // 'basic' 或 'enhanced'
      })
    });
    
    // 保存密码到本地
    await keyManager.saveRoomPassword(roomId, password);
    
    return response.json();
  } else {
    // 创建未加密房间
    const response = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        name: roomName,
        encrypted: false
      })
    });
    
    return response.json();
  }
}

async function deriveKeyFromPassword(password, roomId, iterations = 100000) {
  // 1. 将密码转换为密钥材料
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  // 2. 使用 roomId 作为 salt（确保不同房间不同密钥）
  const salt = encoder.encode(roomId);
  
  // 3. 派生 AES-GCM 密钥
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  return derivedKey;
}
```

#### 3.1.2 加入加密房间（智能密码提示）

**⚠️ 重要：密码验证机制说明**

**问题：服务器不知道密码，如何验证用户输入的密码是否正确？**

**答案：通过"解密测试"验证**

由于服务器不存储密码和密钥，我们无法在服务端验证密码。但我们可以让客户端尝试解密房间的验证数据：
- ✅ 如果解密成功，说明密码正确
- ❌ 如果解密失败（抛出异常），说明密码错误

**关键点**：
1. **任何人都可以连接到房间的 WebSocket**（服务器不阻止）
2. **但只有正确的密码才能解密消息**（客户端验证）
3. **错误的密码会看到解密失败提示**（用户自己知道密码错了）

---

**用户流程（根据隐私级别智能提示）**:

**场景 A：加入基础隐私房间（privacyLevel: 'basic'）**

```
步骤 1: 用户尝试加入房间
   ↓
步骤 2: 获取房间信息
   {
     name: "Team Meeting",
     encrypted: true,
     privacyLevel: "basic"  ← 使用房间名作为密码
   }
   ↓
步骤 3: 智能提示（提示用户使用房间名）
   ┌────────────────────────────────────────┐
   │  🔐 Protected Room                     │
   ├────────────────────────────────────────┤
   │                                        │
   │  Room: Team Meeting                    │
   │                                        │
   │  This room uses the room name as       │
   │  password for basic privacy.           │
   │                                        │
   │  💡 Try entering the room name:        │
   │  Password: [Team Meeting_______]       │
   │                                        │
   │  Or ask the room creator for           │
   │  the password if it's different.       │
   │                                        │
   │  [Join Room] [Cancel]                  │
   └────────────────────────────────────────┘
   ↓
步骤 4: 系统自动尝试使用房间名
   - 先自动使用 "Team Meeting" 验证
   - 如果成功，直接进入
   - 如果失败，提示用户手动输入
```

**场景 B：加入增强隐私房间（privacyLevel: 'enhanced'）**

```
步骤 1: 用户尝试加入房间
   ↓
步骤 2: 获取房间信息
   {
     name: "Secret Project",
     encrypted: true,
     privacyLevel: "enhanced"  ← 使用自定义密码
   }
   ↓
步骤 3: 提示输入密码（无自动尝试）
   ┌────────────────────────────────────────┐
   │  🔐 Highly Protected Room              │
   ├────────────────────────────────────────┤
   │                                        │
   │  Room: Secret Project                  │
   │                                        │
   │  This room uses a custom password      │
   │  for enhanced privacy protection.      │
   │                                        │
   │  Password: [________________]          │
   │                                        │
   │  💡 Ask the room creator for           │
   │     the password to join.              │
   │                                        │
   │  [Join Room] [Cancel]                  │
   └────────────────────────────────────────┘
   ↓
步骤 4: 用户必须输入正确的自定义密码
```

**技术实现**:

```javascript
async function joinRoom(roomId) {
  // 1. 获取房间信息
  const response = await fetch(`/api/room/${roomId}/info`);
  const roomInfo = await response.json();
  
  // 2. 检查房间是否加密
  if (!roomInfo.encrypted) {
    // 未加密房间，直接连接
    await connectToRoom(roomId);
    return { success: true };
  }
  
  // 3. 根据隐私级别处理
  if (roomInfo.privacyLevel === 'basic') {
    // 基础隐私：先自动尝试使用房间名
    console.log("🔍 检测到基础隐私房间，尝试使用房间名作为密码...");
    
    const autoResult = await verifyPasswordWithData(
      roomId, 
      roomInfo.name,  // 使用房间名作为密码
      roomInfo.verificationData
    );
    
    if (autoResult.success) {
      console.log("✅ 自动验证成功，使用房间名作为密码");
      await connectToRoom(roomId);
      return { success: true, autoJoined: true };
    } else {
      // 自动验证失败，可能房间创建者修改了密码
      console.log("⚠️ 房间名验证失败，需要用户输入密码");
      return await promptUserForPassword(roomId, roomInfo, 'basic');
    }
  } else if (roomInfo.privacyLevel === 'enhanced') {
    // 增强隐私：直接要求用户输入密码
    console.log("🔐 检测到增强隐私房间，需要自定义密码");
    return await promptUserForPassword(roomId, roomInfo, 'enhanced');
  } else {
    // 未知隐私级别，使用默认流程
    return await promptUserForPassword(roomId, roomInfo, 'unknown');
  }
}

async function promptUserForPassword(roomId, roomInfo, privacyLevel) {
  return new Promise((resolve, reject) => {
    // 创建密码输入对话框
    const dialog = createPasswordDialog(roomInfo, privacyLevel);
    
    dialog.onSubmit = async (password) => {
      const result = await verifyPasswordWithData(
        roomId,
        password,
        roomInfo.verificationData
      );
      
      if (result.success) {
        await connectToRoom(roomId);
        dialog.close();
        resolve({ success: true });
      } else {
        dialog.showError("密码错误，请重试");
      }
    };
    
    dialog.onCancel = () => {
      dialog.close();
      reject(new Error('User cancelled'));
    };
    
    // 如果是基础隐私，预填充房间名
    if (privacyLevel === 'basic') {
      dialog.setHint(`💡 提示：尝试输入房间名 "${roomInfo.name}"`);
      dialog.prefillPassword(roomInfo.name);
    }
  });
}

function createPasswordDialog(roomInfo, privacyLevel) {
  const dialog = document.createElement('div');
  dialog.className = 'password-dialog';
  
  let hint = '';
  let title = '';
  
  if (privacyLevel === 'basic') {
    title = '🔐 Protected Room';
    hint = `
      <p>This room uses the room name as password for basic privacy.</p>
      <p>💡 Try entering: <strong>${roomInfo.name}</strong></p>
      <p>Or ask the room creator if the password is different.</p>
    `;
  } else if (privacyLevel === 'enhanced') {
    title = '🔐 Highly Protected Room';
    hint = `
      <p>This room uses a custom password for enhanced privacy.</p>
      <p>💡 Ask the room creator for the password to join.</p>
    `;
  } else {
    title = '🔐 Password Required';
    hint = `
      <p>This room is password protected.</p>
      <p>💡 Enter the password to join.</p>
    `;
  }
  
  dialog.innerHTML = `
    <div class="dialog-content">
      <h3>${title}</h3>
      <p><strong>Room:</strong> ${roomInfo.name}</p>
      <div class="hint">${hint}</div>
      <label>Password:</label>
      <input type="password" id="password-input" placeholder="Enter password">
      <div class="error" style="display:none; color:red;"></div>
      <div class="actions">
        <button id="submit-btn">Join Room</button>
        <button id="cancel-btn">Cancel</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  const input = dialog.querySelector('#password-input');
  const submitBtn = dialog.querySelector('#submit-btn');
  const cancelBtn = dialog.querySelector('#cancel-btn');
  const errorDiv = dialog.querySelector('.error');
  
  input.focus();
  
  return {
    onSubmit: null,
    onCancel: null,
    
    close: () => document.body.removeChild(dialog),
    
    showError: (message) => {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      input.value = '';
      input.focus();
    },
    
    setHint: (hintText) => {
      dialog.querySelector('.hint').innerHTML += `<p style="color:blue;">${hintText}</p>`;
    },
    
    prefillPassword: (password) => {
      input.value = password;
      input.select();
    },
    
    _init: function() {
      submitBtn.onclick = () => {
        if (this.onSubmit) {
          this.onSubmit(input.value);
        }
      };
      
      cancelBtn.onclick = () => {
        if (this.onCancel) {
          this.onCancel();
        }
      };
      
      input.onkeypress = (e) => {
        if (e.key === 'Enter' && this.onSubmit) {
          this.onSubmit(input.value);
        }
      };
    }
  }._init();
}

async function verifyRoomPassword(password, roomId, testMessage) {
  try {
    // 1. 从密码派生密钥
    const key = await deriveKeyFromPassword(password, roomId);
    
    // 2. 尝试解密验证数据（关键验证步骤）
    const decrypted = await CryptoUtils.decryptMessage(testMessage, key);
    
    // 3. 解密成功 = 密码正确
    // AES-GCM 会验证消息完整性，如果密钥错误会抛出异常
    console.log("✅ Password verified successfully");
    
    // 4. 保存密码到本地
    await keyManager.saveRoomPassword(roomId, password);
    
    return { success: true, key };
  } catch (error) {
    // 4. 解密失败 = 密码错误
    // AES-GCM 解密失败会抛出 "OperationError" 异常
    console.error("❌ Password verification failed:", error);
    
    return { success: false, error: "Incorrect password" };
  }
}
```

**"验证数据"从哪里来？如何验证？**

**核心思路：创建房间时，生成加密的验证数据，通过单独的 HTTP 请求存储在房间的元数据属性中**

```
流程图：

1️⃣ 创建房间（单独的 HTTP POST 请求）：
   
   用户输入密码 "mySecret123"
      ↓
   客户端构造验证载荷：{ roomId: "abc123", type: "verification" }
      ↓
   使用密码派生的密钥加密验证载荷
      ↓
   HTTP POST /api/room/create
   {
     name: "Secret Chat",
     encrypted: true,
     verificationData: "ENCRYPTED:{iv:[...], ciphertext:[...]}"
   }
      ↓
   服务端（Durable Object）存储在房间属性中：
   {
     roomId: "abc123",
     name: "Secret Chat",
     encrypted: true,
     verificationData: "ENCRYPTED:{iv:[...], ciphertext:[...]}"  ← 存为属性
   }
   
   ⚠️ 重要：verificationData 存储在房间的元数据属性中
   ⚠️ 不是存储在消息列表中
   ⚠️ 与聊天消息完全分离

2️⃣ 加入房间时验证密码（HTTP GET 请求）：
   
   用户输入密码 "wrongPassword"
      ↓
   HTTP GET /api/room/abc123/info
      ↓
   服务端返回房间元数据：
   {
     roomId: "abc123",
     name: "Secret Chat",
     encrypted: true,
     verificationData: "ENCRYPTED:{iv:[...], ciphertext:[...]}"  ← 密文
   }
      ↓
   客户端获取 verificationData（密文）
      ↓
   使用输入的密码派生密钥，尝试解密
      ↓
   ┌────────────────────────────────────────┐
   │ 如果密码正确：                          │
   │  ✅ 解密成功                            │
   │  ✅ 解密出：{ roomId: "abc123", ... }   │
   │  ✅ 验证 roomId 匹配                    │
   │  ✅ 允许连接 WebSocket，进入房间        │
   │                                        │
   │ 如果密码错误：                          │
   │  ❌ 解密失败（AES-GCM 抛出异常）        │
   │  ❌ 显示"密码错误"提示                  │
   │  ❌ 不允许进入房间                      │
   └────────────────────────────────────────┘
```

**关键点**：
- ✅ 验证数据存储在 **Durable Object 的房间元数据属性**中
- ✅ **不是存储在消息列表**中（与聊天消息完全分离）
- ✅ 创建房间时通过**单独的 HTTP POST 请求**上传验证数据
- ✅ 加入房间时通过 **GET /api/room/:id/info** 获取房间信息
- ✅ 服务端**只存储密文**，不知道验证载荷的内容
- ✅ 验证完全在**客户端**通过"能否解密"来判断
- ✅ AES-GCM 算法自带**完整性验证**，错误的密钥无法解密

---

**详细实现：**

**详细实现：**

```javascript
// ========================================
// 步骤 1：创建加密房间（单独的 HTTP POST 请求）
// ========================================

async function createRoomWithPassword(roomName, password) {
  if (!password) {
    // 未加密房间，普通创建
    return await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName })
    });
  }
  
  // 1. 从密码派生加密密钥
  const roomId = generateRoomId(); // 先生成房间 ID
  const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);
  
  // 2. 构造验证载荷（包含房间信息）
  const verificationPayload = {
    type: "room-verification",        // 消息类型标识
    roomId: roomId,                   // 房间 ID（用于验证）
    version: "1.0",                   // 协议版本
    timestamp: Date.now(),            // 创建时间戳
    salt: crypto.randomUUID()         // 随机盐值（防止预测攻击）
  };
  
  // 3. 加密验证载荷
  const encrypted = await CryptoUtils.encryptMessage(
    JSON.stringify(verificationPayload),
    key
  );
  
  // 4. 通过 HTTP POST 创建房间，包含验证数据
  const response = await fetch('/api/room/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId: roomId,
      name: roomName,
      encrypted: true,                              // 标记为加密房间
      verificationData: `ENCRYPTED:${JSON.stringify(encrypted)}`  // 验证数据（密文）
    })
  });
  
  const result = await response.json();
  
  // 5. 保存密码到客户端本地
  await keyManager.saveRoomPassword(roomId, password);
  
  console.log("✅ 加密房间创建成功，验证数据已存储到房间属性中");
  return result;
}


// ========================================
// 服务端代码：Durable Object 存储验证数据
// ========================================

// src/room.js (Durable Object)
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  
  async fetch(request) {
    const url = new URL(request.url);
    
    // 创建房间
    if (url.pathname === '/create' && request.method === 'POST') {
      const { roomId, name, encrypted, verificationData } = await request.json();
      
      // 存储房间元数据到 Durable Object 的属性中
      const roomMetadata = {
        roomId,
        name,
        encrypted: encrypted || false,
        createdAt: Date.now()
      };
      
      // ⚠️ 关键：将验证数据存储为单独的属性
      if (encrypted && verificationData) {
        roomMetadata.verificationData = verificationData;  // 存储密文
        // ☝️ 服务端只看到密文，不知道内容！
      }
      
      // 存储到 Durable Object storage
      await this.state.storage.put('metadata', roomMetadata);
      
      return new Response(JSON.stringify({
        success: true,
        roomId
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 获取房间信息
    if (url.pathname.startsWith('/info')) {
      const metadata = await this.state.storage.get('metadata');
      
      return new Response(JSON.stringify(metadata), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 其他请求...
  }
}

// Durable Object 中存储的数据结构：
// {
//   metadata: {
//     roomId: "abc123",
//     name: "Secret Chat",
//     encrypted: true,
//     verificationData: "ENCRYPTED:{iv:[12,34,...], ciphertext:[78,90,...]}"
//     createdAt: 1729936800000
//   },
//   
//   // 聊天消息存储在其他键中
//   "2025-10-26T10:00:00.000Z": {
//     name: "Alice",
//     message: "ENCRYPTED:{...}",
//     messageId: "uuid-xxx"
//   },
//   "2025-10-26T10:01:00.000Z": {
//     name: "Bob",
//     message: "ENCRYPTED:{...}",
//     messageId: "uuid-yyy"
//   }
// }
// ☝️ verificationData 存储在 metadata 中，不在消息列表中


// ========================================
// 步骤 2：加入房间时验证密码（HTTP GET 请求）
// ========================================

async function joinRoomWithPassword(roomId, password) {
  // 1. 获取房间信息（HTTP GET 请求）
  const response = await fetch(`/api/room/${roomId}/info`);
  const roomInfo = await response.json();
  
  // 示例返回数据：
  // {
  //   roomId: "abc123",
  //   name: "Secret Chat",
  //   encrypted: true,
  //   verificationData: "ENCRYPTED:{iv:[...], ciphertext:[...]}"
  // }
  
  // 2. 检查房间是否加密
  if (!roomInfo.encrypted) {
    // 未加密房间，直接进入
    await connectToRoom(roomId);
    return { success: true };
  }
  
  // 3. 检查是否有验证数据
  if (!roomInfo.verificationData) {
    console.warn("⚠️ 加密房间缺少验证数据");
    // 降级：允许进入但标记需要后续验证
    await keyManager.saveRoomPassword(roomId, password);
    await connectToRoom(roomId);
    return { success: true, needsVerification: true };
  }
  
  // 4. 验证密码（客户端解密测试）
  return await verifyPasswordWithData(roomId, password, roomInfo.verificationData);
}


// ========================================
// 步骤 3：密码验证核心逻辑（客户端）
// ========================================

async function verifyPasswordWithData(roomId, password, encryptedData) {
  // 1. 解析密文
  const encrypted = JSON.parse(
    encryptedData.substring(10)  // 去掉 "ENCRYPTED:" 前缀
  );
  
  try {
    // 2. 从密码派生密钥
    console.log("🔑 正在从密码派生密钥...");
    const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);
    
    // 3. 尝试解密验证数据（关键步骤！）
    console.log("🔓 正在尝试解密验证数据...");
    const decrypted = await CryptoUtils.decryptMessage(encrypted, key);
    
    // 4. 解密成功！解析验证载荷
    const payload = JSON.parse(decrypted);
    
    // 5. 验证载荷内容
    if (payload.type === "room-verification") {
      // 验证房间 ID 是否匹配
      if (payload.roomId === roomId) {
        console.log("✅ 验证成功：房间 ID 匹配");
        
        // 6. 保存密码到本地
        await keyManager.saveRoomPassword(roomId, password);
        
        // 7. 连接到房间的 WebSocket
        await connectToRoom(roomId);
        
        return { 
          success: true,
          message: "密码验证成功"
        };
      } else {
        // 房间 ID 不匹配（理论上不应该发生）
        console.error("❌ 验证失败：房间 ID 不匹配");
        return {
          success: false,
          error: "验证数据异常，请联系房间创建者"
        };
      }
    } else {
      // 验证载荷格式错误
      console.error("❌ 验证失败：无效的验证数据");
      return {
        success: false,
        error: "验证数据格式错误"
      };
    }
    
  } catch (error) {
    // 7. 解密失败 = 密码错误！
    console.error("❌ 解密失败:", error.message);
    
    // AES-GCM 解密失败会抛出 "OperationError" 异常
    return {
      success: false,
      error: "密码错误，请检查后重试"
    };
  }
}


// ========================================
// 完整示例：用户视角
// ========================================

// 【场景 1】用户 A 创建加密房间
console.log("=== 用户 A 创建房间 ===");

await createRoomWithPassword("Secret Chat", "myPassword123");

// HTTP POST /api/room/create
// 请求体：
// {
//   roomId: "abc123",
//   name: "Secret Chat",
//   encrypted: true,
//   verificationData: "ENCRYPTED:{iv:[1,2,3,...], ciphertext:[4,5,6,...]}"
// }

// 服务端（Durable Object）存储：
// metadata: {
//   roomId: "abc123",
//   name: "Secret Chat",
//   encrypted: true,
//   verificationData: "ENCRYPTED:{...}"  ← 密文，服务端看不懂
// }

console.log("✅ 房间创建成功");


// 【场景 2】用户 B 加入（正确密码）
console.log("\n=== 用户 B 加入（正确密码）===");

const result1 = await joinRoomWithPassword("abc123", "myPassword123");

// HTTP GET /api/room/abc123/info
// 服务端返回：
// {
//   roomId: "abc123",
//   encrypted: true,
//   verificationData: "ENCRYPTED:{...}"
// }

// 客户端处理：
// 1. 使用 "myPassword123" 派生密钥
// 2. 解密 verificationData
// 3. 解密成功！得到：{ type: "room-verification", roomId: "abc123", ... }
// 4. 验证 roomId 匹配
// 5. 连接 WebSocket
// 6. 结果：{ success: true }

console.log("✅ 用户 B 成功加入房间");


// 【场景 3】用户 C 加入（错误密码）
console.log("\n=== 用户 C 加入（错误密码）===");

const result2 = await joinRoomWithPassword("abc123", "wrongPassword");

// HTTP GET /api/room/abc123/info
// 服务端返回：
// {
//   roomId: "abc123",
//   encrypted: true,
//   verificationData: "ENCRYPTED:{...}"
// }

// 客户端处理：
// 1. 使用 "wrongPassword" 派生密钥
// 2. 尝试解密 verificationData
// 3. 解密失败！AES-GCM 抛出异常
// 4. 结果：{ success: false, error: "密码错误" }

console.log("❌ 用户 C 密码错误，无法加入");
```
    };
    
    // 4. 加密验证载荷
    const encrypted = await CryptoUtils.encryptMessage(
      JSON.stringify(verificationPayload),
      key
    );
    
    // 5. 发送到服务端存储（服务端只看到密文）
    ws.send(JSON.stringify({
      message: `ENCRYPTED:${JSON.stringify(encrypted)}`,
      messageId: crypto.randomUUID(),
      encryptionType: "e2ee-aes256-gcm",
      isVerificationMessage: true,      // 标记为验证消息
      timestamp: Date.now()
    }));
    
    // 6. 保存密码到客户端本地
    await keyManager.saveRoomPassword(roomId, password);
    
    console.log("✅ 房间创建成功，验证消息已加密存储");
  }
  
  return roomId;
}

// 服务端收到的数据（密文）：
// {
//   "message": "ENCRYPTED:{iv:[12,34,56,...], ciphertext:[78,90,12,...]}",
//   "isVerificationMessage": true
// }
// ☝️ 服务端完全不知道里面的内容！


// ========================================
// 备选方案：如果房间没有验证数据（降级处理）
// ========================================

async function joinRoomWithoutVerificationData(roomId, password) {
  console.warn("⚠️ 房间缺少验证数据，使用降级方案");
  
  // 方案 1：直接保存密码，等待后续验证
  await keyManager.saveRoomPassword(roomId, password);
  await connectToRoom(roomId);
  
  // 当接收到第一条加密消息时，尝试解密来验证密码
  // 如果解密失败，提示用户密码可能错误
  
  return { 
    success: true, 
    needsVerification: true,
    warning: "无法预先验证密码，将在接收消息时验证"
  };
}


// ========================================
// 关键数据流对比
// ========================================

/**
 * 传统方案（服务端验证）：
 * 
 * POST /api/room/create { password: "123" }
 *   ↓
 * 服务端存储密码哈希
 *   ↓
 * GET /api/room/verify { password: "123" }
 *   ↓
 * 服务端比较哈希，返回 true/false
 * 
 * ❌ 问题：服务端知道密码信息
 */

/**
 * E2EE 方案（客户端验证）：
 * 
 * 创建阶段：
 * ┌──────────────────────────────────────────┐
 * │ 客户端                                   │
 * │ password "123" → 派生密钥 → 加密载荷     │
 * │ 得到：verificationData (密文)            │
 * └────────────┬─────────────────────────────┘
 *              │
 *              ▼
 * POST /api/room/create
 * {
 *   verificationData: "ENCRYPTED:{...}"  ← 密文
 * }
 *              │
 *              ▼
 * ┌──────────────────────────────────────────┐
 * │ 服务端（Durable Object）                │
 * │ 存储到 metadata.verificationData         │
 * │ ❌ 服务端看不懂内容                      │
 * └──────────────────────────────────────────┘
 * 
 * 验证阶段：
 * ┌──────────────────────────────────────────┐
 * │ 客户端                                   │
 * │ GET /api/room/abc123/info                │
 * └────────────┬─────────────────────────────┘
 *              │
 *              ▼
 * ┌──────────────────────────────────────────┐
 * │ 服务端                                   │
 * │ 返回 metadata.verificationData (密文)    │
 * └────────────┬─────────────────────────────┘
 *              │
 *              ▼
 * ┌──────────────────────────────────────────┐
 * │ 客户端                                   │
 * │ password → 派生密钥 → 尝试解密           │
 * │ ✅ 成功 = 密码正确                       │
 * │ ❌ 失败 = 密码错误                       │
 * └──────────────────────────────────────────┘
 * 
 * ✅ 优势：服务端完全不知道密码
 */


// ========================================
// 存储结构对比
// ========================================

// Durable Object 存储结构（清晰分离）
{
  // 房间元数据（固定属性）
  metadata: {
    roomId: "abc123",
    name: "Secret Chat",
    encrypted: true,
    verificationData: "ENCRYPTED:{...}",  ← 验证数据在这里
    createdAt: 1729936800000
  },
  
  // 聊天消息（时间戳为键）
  "2025-10-26T10:00:00.000Z": {
    name: "Alice",
    message: "ENCRYPTED:{...}",
    messageId: "uuid-1"
  },
  "2025-10-26T10:01:00.000Z": {
    name: "Bob",  
    message: "ENCRYPTED:{...}",
    messageId: "uuid-2"
  }
}

// ☝️ 关键点：
// 1. verificationData 存储在 metadata 属性中
// 2. 不在消息列表中（messages）
// 3. 创建房间时单独设置
// 4. 获取房间信息时返回


// ========================================
// API 设计
// ========================================

// 1. 创建加密房间
POST /api/room/create
{
  "roomId": "abc123",
  "name": "Secret Chat",
  "encrypted": true,
  "verificationData": "ENCRYPTED:{iv:[...], ciphertext:[...]}"
}

// 响应：
{
  "success": true,
  "roomId": "abc123"
}


// 2. 获取房间信息（用于密码验证）
GET /api/room/abc123/info

// 响应：
{
  "roomId": "abc123",
  "name": "Secret Chat",
  "encrypted": true,
  "verificationData": "ENCRYPTED:{iv:[...], ciphertext:[...]}"
  "createdAt": 1729936800000
}


// 3. 连接 WebSocket（在密码验证后）
WebSocket ws://example.com/api/room/abc123/websocket


// ========================================
// 总结
// ========================================

console.log("=== 核心设计要点 ===");
console.log("1️⃣ 验证数据存储位置：");
console.log("   - 存储在 Durable Object 的 metadata.verificationData 属性");
console.log("   - 不是存储在消息列表中");
console.log("   - 与聊天消息完全分离");

console.log("\n2️⃣ API 设计：");
console.log("   - POST /api/room/create - 创建房间，包含 verificationData");
console.log("   - GET /api/room/:id/info - 获取房间信息，返回 verificationData");
console.log("   - WebSocket 连接在密码验证后");

console.log("\n3️⃣ 验证流程：");
console.log("   - 创建时：加密验证载荷 → POST 到服务端");
console.log("   - 加入时：GET 获取 verificationData → 解密测试 → 成功/失败");

console.log("\n4️⃣ 服务端职责：");
console.log("   - 只存储密文（verificationData）");
console.log("   - 不知道密码");
console.log("   - 不参与验证");
console.log("   - 只负责存储和返回");

console.log("\n5️⃣ 客户端职责：");
console.log("   - 生成验证数据");
console.log("   - 加密验证载荷");
console.log("   - 验证密码（解密测试）");
console.log("   - 管理密钥");
```

---

**为什么这样设计？**

| 特性 | 说明 |
|------|------|
| **独立存储** | verificationData 作为房间元数据，与消息分离 |
| **单独请求** | 创建房间时通过 HTTP POST 一次性设置 |
| **快速验证** | 加入时通过 GET /info 立即获取，无需遍历消息 |
| **清晰分离** | 房间属性 vs 聊天消息，职责明确 |
| **高效访问** | 直接读取属性，不需要查询消息列表 |
| **向后兼容** | 未加密房间的 verificationData 为空 |

**数据流完整示意图**：

```
创建加密房间：
                                                      
  👤 用户 A                     🖥️ 客户端                     ☁️ 服务端
    │                            │                            │
    │ 输入密码 "ABC"              │                            │
    ├───────────────────────────▶│                            │
    │                            │                            │
    │                            │ 1. 构造验证载荷            │
    │                            │    {roomId:"123"}          │
    │                            │                            │
    │                            │ 2. 使用 ABC 加密           │
    │                            │    得到密文                 │
    │                            │                            │
    │                            │ POST /room/create          │
    │                            │ {verificationData:"ENC.."}  │
    │                            ├───────────────────────────▶│
    │                            │                            │
    │                            │                            │ 3. 存储到
    │                            │                            │    metadata
    │                            │                            │
    │                            │ ◀──────────{ success }─────│
    │ ◀─────── 房间创建成功 ──────│                            │
    │                            │                            │


加入房间（正确密码）：

  👤 用户 B                     🖥️ 客户端                     ☁️ 服务端
    │                            │                            │
    │ 输入密码 "ABC"              │                            │
    ├───────────────────────────▶│                            │
    │                            │                            │
    │                            │ GET /room/123/info         │
    │                            ├───────────────────────────▶│
    │                            │                            │
    │                            │                            │ 读取
    │                            │                            │ metadata
    │                            │                            │
    │                            │ ◀──{ verificationData }────│
    │                            │                            │
    │                            │ 1. 使用 ABC 派生密钥       │
    │                            │                            │
    │                            │ 2. 尝试解密                │
    │                            │    ✅ 成功！               │
    │                            │                            │
    │                            │ 3. 连接 WebSocket          │
    │                            ├───────────────────────────▶│
    │ ◀─────── 成功加入房间 ──────│                            │
    │                            │                            │


加入房间（错误密码）：

  👤 用户 C                     🖥️ 客户端                     ☁️ 服务端
    │                            │                            │
    │ 输入密码 "XYZ"              │                            │
    ├───────────────────────────▶│                            │
    │                            │                            │
    │                            │ GET /room/123/info         │
    │                            ├───────────────────────────▶│
    │                            │                            │
    │                            │ ◀──{ verificationData }────│
    │                            │                            │
    │                            │ 1. 使用 XYZ 派生密钥       │
    │                            │                            │
    │                            │ 2. 尝试解密                │
    │                            │    ❌ 失败！               │
    │                            │                            │
    │ ◀───── 密码错误，请重试 ────│                            │
    │                            │                            │
```

---

**备选方案：使用第一条普通消息验证（不推荐）**
      } else {
        // 房间 ID 不匹配（理论上不应该发生）
        console.error("❌ 验证失败：房间 ID 不匹配");
        return {
          success: false,
          error: "验证数据异常"
        };
      }
    } else {
      // 不是验证消息，但能解密说明密码正确
      console.log("✅ 解密成功（非验证消息，但密码正确）");
      await keyManager.saveRoomPassword(roomId, password);
      return { success: true };
    }
    
  } catch (error) {
    // 7. 解密失败 = 密码错误！
    console.error("❌ 解密失败:", error.message);
    
    // AES-GCM 解密失败会抛出类似 "OperationError" 的异常
    return {
      success: false,
      error: "密码错误，请检查后重试"
    };
  }
}


// ========================================
// 完整示例：用户视角
// ========================================

// 用户 A 创建房间
await createRoomWithPassword("Secret Chat", "myPassword123");

// 服务端存储的数据（Durable Objects）:
// {
//   "key": "2025-10-26T10:00:00.000Z",
//   "value": {
//     "message": "ENCRYPTED:{iv:[1,2,3,...], ciphertext:[4,5,6,...]}",
//     "isVerificationMessage": true,
//     "messageId": "uuid-xxx",
//     "timestamp": 1729936800000
//   }
// }
// ☝️ 服务端只看到密文，不知道内容


// 用户 B 尝试加入（正确密码）
const result1 = await joinRoomWithPassword("abc123", "myPassword123");
// 结果：
// 1. 从服务端获取验证消息（密文）
// 2. 使用 "myPassword123" 派生密钥
// 3. 解密成功！得到：{ type: "room-verification", roomId: "abc123", ... }
// 4. 验证 roomId 匹配
// 5. 返回 { success: true }
// 6. 用户 B 进入房间，可以看到所有解密的消息


// 用户 C 尝试加入（错误密码）
const result2 = await joinRoomWithPassword("abc123", "wrongPassword");
// 结果：
// 1. 从服务端获取验证消息（密文）
// 2. 使用 "wrongPassword" 派生密钥
// 3. 解密失败！AES-GCM 抛出异常
// 4. 返回 { success: false, error: "密码错误" }
// 5. 显示错误提示，要求重新输入
// 6. 用户 C 无法进入房间


// ========================================
// 关键技术细节
// ========================================

/**
 * 为什么 AES-GCM 能验证密码？
 * 
 * AES-GCM（Galois/Counter Mode）是一种认证加密算法：
 * 
 * 1. 加密时：
 *    - 使用密钥 K1 加密数据 → 生成密文 + 认证标签
 *    - 认证标签是基于密钥和密文计算的
 * 
 * 2. 解密时：
 *    - 使用密钥 K2 尝试解密
 *    - 如果 K2 != K1：
 *      ✅ 认证标签验证失败
 *      ✅ 抛出 OperationError 异常
 *      ✅ 无法解密出任何内容（不是乱码，是直接失败）
 *    - 如果 K2 == K1：
 *      ✅ 认证标签验证成功
 *      ✅ 解密成功
 * 
 * 3. 安全性保证：
 *    - 即使攻击者篡改密文，也会被检测到
 *    - 错误的密钥无法解密（不是得到乱码，是直接失败）
 *    - 完美适合密码验证场景
 */

// 示例：AES-GCM 解密失败
const wrongKey = await CryptoUtils.deriveKeyFromPassword("wrong", roomId);
try {
  const decrypted = await CryptoUtils.decryptMessage(encryptedData, wrongKey);
  // ☝️ 这行代码不会执行到
} catch (error) {
  console.log(error.name);     // "OperationError"
  console.log(error.message);  // "The operation failed for an operation-specific reason"
  // ☝️ 明确的解密失败，而非得到乱码
}
```

**为什么这个方案安全且高效？**

| 特性 | 说明 |
|------|------|
| **服务端零知识** | 服务端只存储密文，不知道内容，不知道密码 |
| **无需额外存储** | 验证消息就是普通消息，不需要特殊的密码表 |
| **客户端验证** | 完全在客户端通过解密测试验证，服务端不参与 |
| **防篡改** | AES-GCM 自带完整性验证，密文被篡改会被检测 |
| **防重放** | 验证载荷包含随机盐值和时间戳 |
| **简单明了** | 能解密 = 密码正确，不能解密 = 密码错误 |
| **向后兼容** | 如果没有专门的验证消息，可以用第一条普通消息 |

**数据流图解**：

```
创建房间时：
┌─────────────┐
│ 用户 A      │
│ 密码: ABC   │
└──────┬──────┘
       │ 输入密码
       ▼
┌─────────────────────────┐
│ 客户端                  │
│ 1. 构造验证载荷：        │
│    {roomId: "123"}     │
│ 2. 使用 ABC 加密        │
│ 3. 得到密文             │
└──────┬──────────────────┘
       │ 发送密文
       ▼
┌─────────────────────────┐
│ 服务端                  │
│ 存储：                  │
│ message: "ENCRYPTED:{}"│
│ （只看到密文）           │
└─────────────────────────┘


加入房间时（正确密码）：
┌─────────────┐
│ 用户 B      │
│ 密码: ABC   │
└──────┬──────┘
       │ 输入密码
       ▼
┌─────────────────────────┐
│ 客户端                  │
│ 1. 获取密文             │
│ 2. 使用 ABC 解密        │
│ 3. ✅ 解密成功！        │
│ 4. 得到 {roomId:"123"} │
│ 5. 验证 roomId 匹配     │
│ 6. 允许进入             │
└─────────────────────────┘


加入房间时（错误密码）：
┌─────────────┐
│ 用户 C      │
│ 密码: XYZ   │
└──────┬──────┘
       │ 输入密码
       ▼
┌─────────────────────────┐
│ 客户端                  │
│ 1. 获取密文             │
│ 2. 使用 XYZ 解密        │
│ 3. ❌ 解密失败！        │
│    (AES-GCM 抛出异常)  │
│ 4. 提示密码错误         │
│ 5. 不允许进入           │
└─────────────────────────┘
```

**总结**：
- ✅ 你的理解完全正确！
- ✅ 创建房间时上传一个加密的验证数据（包含房间号）
- ✅ 加入时尝试解密，成功且房间号匹配 = 密码正确
- ✅ 解密失败 = 密码错误
- ✅ 服务端只存密文，完全不知道密码和内容
- ✅ 这是真正的零信任端对端加密！

---

**备选方案：使用第一条普通消息验证**

如果房间没有专门的验证消息，可以使用用户发送的第一条普通消息：

```javascript
// 场景：用户创建房间但没有发送验证消息
// 用户 A 发送第一条消息："Hello everyone!"

// 用户 B 加入时：
const firstMessage = await fetchFirstMessage(roomId);
// firstMessage.message = "ENCRYPTED:{...}" (加密的 "Hello everyone!")

// 尝试解密
try {
  const decrypted = await decryptMessage(firstMessage, password);
  // 如果成功解密出 "Hello everyone!"，说明密码正确
  return { success: true };
} catch {
  // 解密失败，密码错误
  return { success: false };
}
```

---

**实际效果演示**：

```javascript
// ========================================
// 完整流程演示
// ========================================

console.log("=== 场景 1：创建房间 ===");

// 用户 A 创建房间
const roomId = "room-abc-123";
const password = "SecretPassword123";

// 客户端构造验证载荷
const payload = {
  type: "room-verification",
  roomId: "room-abc-123",
  timestamp: 1729936800000,
  salt: "random-uuid-here"
};
console.log("📦 验证载荷（明文）:", JSON.stringify(payload));

// 使用密码加密
const key = await deriveKeyFromPassword(password, roomId);
const encrypted = await encryptMessage(JSON.stringify(payload), key);
console.log("🔒 加密后:", JSON.stringify(encrypted));
// 输出：{
//   iv: [12, 34, 56, 78, 90, 12, 34, 56, 90, 12, 34, 56],
//   ciphertext: [145, 232, 67, 89, 123, ...], // 几百个数字
//   version: "1.0"
// }

// 发送到服务端
console.log("📤 发送到服务端...");
// 服务端存储：
// {
//   "message": "ENCRYPTED:{iv:[12,34,...], ciphertext:[145,232,...]}"
// }
console.log("✅ 服务端已存储密文（服务端看不懂内容）");


console.log("\n=== 场景 2：用户 B 加入（正确密码）===");

// 用户 B 输入密码："SecretPassword123"
const userBPassword = "SecretPassword123";

// 从服务端获取验证消息
const storedMessage = {
  message: "ENCRYPTED:{iv:[12,34,...], ciphertext:[145,232,...]}"
};
console.log("📥 从服务端获取验证消息（密文）");

// 尝试解密
try {
  const userBKey = await deriveKeyFromPassword(userBPassword, roomId);
  const decrypted = await decryptMessage(storedMessage, userBKey);
  console.log("🔓 解密成功！");
  console.log("📄 解密内容:", decrypted);
  // 输出：'{"type":"room-verification","roomId":"room-abc-123",...}'
  
  const verifiedPayload = JSON.parse(decrypted);
  if (verifiedPayload.roomId === roomId) {
    console.log("✅ 验证通过：房间 ID 匹配！");
    console.log("✅ 用户 B 成功加入房间");
  }
} catch (error) {
  console.log("❌ 不会执行到这里");
}


console.log("\n=== 场景 3：用户 C 加入（错误密码）===");

// 用户 C 输入错误密码："WrongPassword"
const userCPassword = "WrongPassword";

// 从服务端获取相同的验证消息
console.log("📥 从服务端获取验证消息（密文）");

// 尝试解密
try {
  const userCKey = await deriveKeyFromPassword(userCPassword, roomId);
  console.log("🔑 使用错误密码派生的密钥尝试解密...");
  
  const decrypted = await decryptMessage(storedMessage, userCKey);
  console.log("❌ 不会执行到这里！解密会抛出异常");
} catch (error) {
  console.log("❌ 解密失败！");
  console.log("❌ 错误类型:", error.name);        // "OperationError"
  console.log("❌ 错误信息:", error.message);     // "The operation failed..."
  console.log("❌ 提示用户：密码错误，请重试");
  console.log("❌ 用户 C 无法加入房间");
}


// ========================================
// 关键点总结
// ========================================

console.log("\n=== 关键点 ===");
console.log("1️⃣ 服务端存储：");
console.log("   - 只存储密文");
console.log("   - 不知道验证载荷的内容");
console.log("   - 不知道房间密码");
console.log("   - 无法验证密码是否正确");

console.log("\n2️⃣ 密码正确时：");
console.log("   - 能成功解密验证消息");
console.log("   - 得到包含房间 ID 的载荷");
console.log("   - 验证房间 ID 匹配");
console.log("   - 允许用户进入");

console.log("\n3️⃣ 密码错误时：");
console.log("   - AES-GCM 解密直接失败");
console.log("   - 抛出 OperationError 异常");
console.log("   - 不是得到乱码，而是完全解密失败");
console.log("   - 客户端捕获异常，提示密码错误");

console.log("\n4️⃣ 安全性保证：");
console.log("   - 服务端被攻破：只能拿到密文");
console.log("   - 暴力破解：客户端可以添加尝试次数限制");
console.log("   - 中间人攻击：HTTPS + 密文无法篡改");
console.log("   - 重放攻击：验证载荷包含随机盐值");
```

**用户体验对比**：

```
传统方案（服务端验证）：
用户输入密码
   ↓
发送密码到服务器
   ↓
服务器查询密码表
   ↓
服务器返回"正确"或"错误"
   ↓
用户进入或被拒绝

❌ 问题：服务器知道密码
❌ 问题：服务器可以阻止访问
❌ 问题：服务器被攻破 = 密码泄露


E2EE 方案（客户端验证）：
用户输入密码
   ↓
客户端从密码派生密钥
   ↓
客户端尝试解密验证消息
   ↓
解密成功/失败
   ↓
用户进入或被拒绝

✅ 优势：服务器不知道密码
✅ 优势：服务器无法阻止（真正的去中心化）
✅ 优势：服务器被攻破 = 只泄露密文（安全）
```

**代码对比**：

```javascript
// ========================================
// 传统方案（不推荐）
// ========================================

// 客户端
const response = await fetch('/api/room/verify', {
  method: 'POST',
  body: JSON.stringify({
    roomId: 'abc123',
    password: 'myPassword'  // ❌ 密码发送到服务器
  })
});

const result = await response.json();
if (result.success) {
  // 服务器说密码正确
} else {
  // 服务器说密码错误
}

// 服务端（需要存储密码哈希）
app.post('/api/room/verify', async (req, res) => {
  const { roomId, password } = req.body;
  
  // ❌ 服务器知道用户输入的密码
  const storedHash = await db.getPasswordHash(roomId);
  const inputHash = await hashPassword(password);
  
  if (storedHash === inputHash) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});


// ========================================
// E2EE 方案（推荐）
// ========================================

// 客户端（完整逻辑）
async function verifyPassword(roomId, password) {
  // 1. 获取验证消息（密文）
  const verificationMessage = await fetchVerificationMessage(roomId);
  
  // 2. 尝试解密
  try {
    const key = await deriveKeyFromPassword(password, roomId);
    const decrypted = await decryptMessage(verificationMessage, key);
    const payload = JSON.parse(decrypted);
    
    // 3. 验证内容
    if (payload.roomId === roomId) {
      return { success: true };  // ✅ 密码正确
    }
  } catch (error) {
    return { success: false };  // ❌ 密码错误
  }
}

// 服务端（只存储密文，不参与验证）
app.get('/api/room/:roomId/messages', async (req, res) => {
  const messages = await db.getMessages(req.params.roomId);
  // ✅ 直接返回密文，不知道内容，不验证密码
  res.json(messages);
});
```

**安全性分析**：

| 攻击场景 | 传统方案 | E2EE 方案 |
|---------|---------|----------|
| **服务器被攻破** | ❌ 密码哈希泄露 | ✅ 只有密文，安全 |
| **数据库泄露** | ❌ 可能被暴力破解 | ✅ 无密码信息，安全 |
| **中间人攻击** | ⚠️ HTTPS 保护 | ✅ HTTPS + 密文双重保护 |
| **服务器管理员** | ❌ 可以看到验证请求 | ✅ 看不到密码，只看到密文 |
| **日志泄露** | ❌ 密码可能被记录 | ✅ 密码从不发送，安全 |
| **暴力破解** | ⚠️ 服务端限制 | ✅ 客户端限制 + 高成本 |

**为什么 AES-GCM 这么重要？**

```javascript
// AES-GCM 的特性：认证加密

// 加密时：
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  plaintext
);
// ☝️ 生成：密文 + 认证标签（Authentication Tag）
//         认证标签是基于密钥和密文计算的

// 解密时：
try {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,        // 如果这个密钥不对
    ciphertext
  );
  // ☝️ 这行不会执行到
} catch (error) {
  // ☝️ 会抛出异常！
  // 原因：认证标签验证失败
  // 结果：完全无法解密（不是得到乱码）
}

// 对比其他模式（如 AES-CBC）：
// AES-CBC 解密失败会得到乱码
// 无法明确判断密钥是否正确
// 需要额外的完整性检查

// AES-GCM 的优势：
// ✅ 解密成功 = 密钥正确 + 数据完整
// ✅ 解密失败 = 密钥错误 或 数据被篡改
// ✅ 完美适合密码验证场景
```

**方案 2：服务器存储密码哈希（可选，降低安全性）**

```javascript
// ⚠️ 不推荐：这会让服务器知道密码的哈希值

// 创建房间时
const passwordHash = await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(password + roomId)
);

// 发送哈希到服务器
await fetch('/api/room/create', {
  method: 'POST',
  body: JSON.stringify({
    roomId,
    passwordHash: btoa(String.fromCharCode(...new Uint8Array(passwordHash)))
  })
});

// 加入房间时验证
const inputHash = await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(inputPassword + roomId)
);

const response = await fetch(`/api/room/${roomId}/verify`, {
  method: 'POST',
  body: JSON.stringify({
    passwordHash: btoa(String.fromCharCode(...new Uint8Array(inputHash)))
  })
});

// ❌ 问题：服务器知道了密码哈希，降低了安全性
// ❌ 问题：服务器可以阻止用户访问（中心化控制）
```

**推荐：使用方案 1（客户端验证）**

---

**错误密码用户看到什么？**

**场景 1：输入密码时验证失败**

```
用户输入错误密码 "wrongPass"
   ↓
客户端尝试解密验证消息
   ↓
解密失败（AES-GCM 抛出异常）
   ↓
显示错误提示：
┌────────────────────────────────────┐
│  ❌ Incorrect Password             │
├────────────────────────────────────┤
│                                    │
│  The password you entered is       │
│  incorrect. Please try again.      │
│                                    │
│  Password:                         │
│  [____________________]            │
│                                    │
│  [Try Again] [Cancel]              │
│                                    │
│  💡 Make sure you have the         │
│     correct password               │
│                                    │
└────────────────────────────────────┘

✅ 用户被阻止进入房间，必须输入正确密码
```

**场景 2：如果用户绕过验证强行进入（理论上）**

```javascript
// 假设用户通过某种方式绕过了密码验证
// （实际上很难，因为验证在客户端代码中）

// 用户看到的界面：
┌────────────────────────────────────────────┐
│  Room: Secret Chat                         │
├────────────────────────────────────────────┤
│                                            │
│  🔒 [10:30] Alice: [🔐 Unable to decrypt]  │
│  🔒 [10:31] Bob: [🔐 Unable to decrypt]    │
│  🔒 [10:32] Carol: [🔐 Unable to decrypt]  │
│                                            │
│  💬 [Type a message...]                    │
└────────────────────────────────────────────┘

// 所有历史消息显示为 "[🔐 Unable to decrypt]"
// 因为没有正确的密钥无法解密

// 如果他们尝试发送消息：
// - 如果没有密钥：显示错误，无法发送
// - 如果用错误密钥加密：其他人也无法解密
```

**场景 3：用户更换设备，忘记密码**

```
用户在新设备上打开房间
   ↓
浏览器没有保存的密码
   ↓
提示输入密码
   ↓
用户输入错误密码
   ↓
验证失败，无法进入
   ↓
显示帮助信息：
┌────────────────────────────────────┐
│  ⚠️ Password Required              │
├────────────────────────────────────┤
│                                    │
│  This room is encrypted.           │
│  You need the password to access   │
│  the messages.                     │
│                                    │
│  💡 Options:                       │
│  • Ask the room creator            │
│  • Check other devices             │
│  • Import password from backup     │
│                                    │
│  [Enter Password] [Import Backup]  │
│                                    │
└────────────────────────────────────┘
```

### 3.2 消息加密与解密

#### 3.2.1 消息加密流程

```javascript
// 客户端加密消息
async function encryptMessage(plaintext, roomKey) {
  // 1. 生成随机 IV (初始化向量)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 2. 加密消息
  const encodedText = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    roomKey,
    encodedText
  );
  
  // 3. 组合 IV 和密文
  const encryptedData = {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    version: "1.0"  // 版本控制
  };
  
  return JSON.stringify(encryptedData);
}
```

#### 3.2.2 消息解密流程

```javascript
// 客户端解密消息
async function decryptMessage(encryptedMessage, roomKey) {
  try {
    // 1. 解析加密数据
    const data = JSON.parse(encryptedMessage);
    const iv = new Uint8Array(data.iv);
    const ciphertext = new Uint8Array(data.ciphertext);
    
    // 2. 解密
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      roomKey,
      ciphertext
    );
    
    // 3. 转换为文本
    const plaintext = new TextDecoder().decode(decrypted);
    return plaintext;
  } catch (error) {
    console.error("解密失败:", error);
    return "[无法解密的消息]";
  }
}
```

#### 3.2.3 数据格式

**发送到服务器的消息格式**:
```json
{
  "name": "用户名 (明文)",
  "message": "ENCRYPTED:{iv:[...], ciphertext:[...], version:'1.0'}",
  "messageId": "uuid",
  "timestamp": 1234567890,
  "encryptionType": "e2ee-aes256-gcm"
}
```

### 3.3 文件和图片加密

#### 3.3.1 文件上传加密流程

```javascript
async function encryptAndUploadFile(file, roomKey) {
  // 1. 读取文件内容
  const arrayBuffer = await file.arrayBuffer();
  
  // 2. 生成随机 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 3. 加密文件内容
  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    roomKey,
    arrayBuffer
  );
  
  // 4. 创建元数据
  const metadata = {
    iv: Array.from(iv),
    originalName: file.name,
    originalType: file.type,
    originalSize: file.size,
    encrypted: true
  };
  
  // 5. 组合加密数据和元数据
  const encryptedBlob = new Blob([
    JSON.stringify(metadata),
    new Uint8Array([0x00]), // 分隔符
    encryptedContent
  ]);
  
  // 6. 上传到服务器
  const formData = new FormData();
  formData.append('file', encryptedBlob, `encrypted_${file.name}.enc`);
  
  const response = await fetch('/api/room/{roomId}/upload', {
    method: 'POST',
    body: formData
  });
  
  const result = await response.json();
  return result.fileUrl;
}
```

#### 3.3.2 文件下载解密流程

```javascript
async function downloadAndDecryptFile(fileUrl, roomKey) {
  // 1. 下载加密文件
  const response = await fetch(fileUrl);
  const encryptedBlob = await response.blob();
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  
  // 2. 解析元数据和密文
  const data = new Uint8Array(arrayBuffer);
  let separatorIndex = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x00) {
      separatorIndex = i;
      break;
    }
  }
  
  const metadataBytes = data.slice(0, separatorIndex);
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
  const ciphertext = data.slice(separatorIndex + 1);
  
  // 3. 解密文件
  const iv = new Uint8Array(metadata.iv);
  const decryptedContent = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    roomKey,
    ciphertext
  );
  
  // 4. 创建可下载的 Blob
  const decryptedBlob = new Blob([decryptedContent], { 
    type: metadata.originalType 
  });
  
  return {
    blob: decryptedBlob,
    fileName: metadata.originalName,
    fileType: metadata.originalType
  };
}
```

#### 3.3.3 图片加密显示

**流程**:
1. 上传时：加密图片 → 存储到 R2
2. 显示时：
   - 下载加密图片数据
   - 客户端解密
   - 创建 Object URL
   - 显示在 `<img>` 标签中

```javascript
async function displayEncryptedImage(encryptedImageUrl, roomKey) {
  // 1. 下载并解密
  const { blob } = await downloadAndDecryptFile(encryptedImageUrl, roomKey);
  
  // 2. 创建临时 URL
  const objectUrl = URL.createObjectURL(blob);
  
  // 3. 更新图片元素
  const img = document.querySelector(`img[data-encrypted-src="${encryptedImageUrl}"]`);
  img.src = objectUrl;
  
  // 4. 清理：当图片不再需要时释放 URL
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
  };
}
```

### 3.4 密钥分享与房间访问

#### 3.4.1 房间密码分享（推荐方案）

**方案 A: 口头/文字分享（最简单）**
```
"Hey, join my chat room!"
Room: abc123
Password: mySecretChat
```

用户特点：
- ✅ 极其简单，像分享 WiFi 密码一样
- ✅ 可以通过任何方式分享（短信、电话、邮件）
- ✅ 易于记忆和传达
- ⚠️ 密码可能被第三方看到

**方案 B: URL 参数传递（推荐）**
```
https://chat.example.com/#room=abc123&pwd=mySecretChat
```

用户特点：
- ✅ 点击即可加入，无需手动输入
- ✅ 适合通过安全渠道分享（端对端加密的聊天工具）
- ⚠️ URL 可能被浏览器历史记录

**方案 C: QR 码分享（线下场景）**
```javascript
// 生成包含房间密码的 QR 码
function generateRoomQRCode(roomId, password) {
  const shareUrl = `${baseUrl}/#room=${roomId}&pwd=${encodeURIComponent(password)}`;
  
  // 使用 QR 码库生成
  return generateQRCode(shareUrl);
}
```

界面示例：
```
┌────────────────────────────────────┐
│  📤 Share This Room                │
├────────────────────────────────────┤
│                                    │
│  Room: abc123                      │
│  Password: mySecretChat            │
│                                    │
│  Share Options:                    │
│  • [Copy Link]                     │
│  • [Show QR Code]                  │
│  • [Copy Room Info]                │
│                                    │
│  🔗 https://chat.../abc123         │
│                                    │
│  ⚠️  Keep password safe!           │
│                                    │
└────────────────────────────────────┘
```

#### 3.4.2 高级方案：无密码的密钥交换

适用于不想预共享密码的场景：

**在线用户中继方案**:
1. 新用户生成临时 RSA 公钥
2. 发送公钥到服务器
3. 服务器广播新用户加入 + 公钥
4. 任一在线用户用新用户公钥加密房间密钥
5. 服务器转发给新用户
6. 新用户解密获得房间密钥

**邀请码方案**:
1. 房间创建者生成一次性邀请码
2. 邀请码包含加密的房间密钥
3. 新用户使用邀请码加入
4. 系统解密邀请码获得房间密钥
5. 邀请码使用后失效（可选）

#### 3.4.2 密钥轮换

**触发条件**:
- 用户主动轮换
- 检测到潜在安全威胁
- 定期轮换（可选，如每 30 天）

**流程**:
1. 当前用户生成新的房间密钥
2. 使用旧密钥加密新密钥（过渡期）
3. 广播密钥轮换通知
4. 所有客户端更新本地存储的密钥
5. 后续消息使用新密钥

### 3.5 历史消息加密

#### 3.5.1 存储格式

服务器存储的消息格式：
```json
{
  "key": "2025-10-26T10:30:00.000Z",
  "value": {
    "name": "Alice",
    "message": "ENCRYPTED:{iv:[...], ciphertext:[...]}",
    "messageId": "uuid",
    "timestamp": 1234567890,
    "encryptionType": "e2ee-aes256-gcm"
  }
}
```

#### 3.5.2 历史消息加载与解密

```javascript
async function loadAndDecryptHistory(roomKey) {
  // 1. 从服务器获取加密历史
  const response = await fetch(`/api/room/${roomId}/websocket`);
  // WebSocket 连接后会收到历史消息
  
  // 2. 逐条解密
  socket.on('message', async (data) => {
    if (data.message && data.message.startsWith('ENCRYPTED:')) {
      const encryptedContent = data.message.substring(10);
      const plaintext = await decryptMessage(encryptedContent, roomKey);
      
      // 3. 显示解密后的消息
      displayMessage({
        ...data,
        message: plaintext,
        decrypted: true
      });
    }
  });
}
```

### 3.6 线程回复加密

**原则**: 线程回复使用与主消息相同的房间密钥加密

**数据结构**:
```json
{
  "messageId": "reply-uuid",
  "message": "ENCRYPTED:{...}",
  "replyTo": {
    "messageId": "parent-uuid",
    "username": "Alice",
    "preview": "ENCRYPTED:{...}"  // 回复引用也需加密
  }
}
```

---

## 4. UI/UX 设计

### 4.1 加密状态指示

#### 4.1.1 房间级别指示

在房间信息区显示加密状态：
```
🏠 Room Info
🔒 End-to-End Encrypted
✅ All messages are encrypted
```

#### 4.1.2 消息级别指示

每条消息显示小锁图标：
```
🔒 [10:30:00] Alice: Hello, this is encrypted!
```

**状态图标**:
- 🔒 已加密并验证
- ⚠️ 无法解密（缺少密钥）
- 🔓 未加密（明文消息）

### 4.2 密钥管理界面

#### 4.2.1 创建房间时的加密设置

**简化界面（推荐）**:
```
┌─────────────────────────────────────┐
│  Create a New Room                  │
├─────────────────────────────────────┤
│                                     │
│  Room Name: [My Chat Room    ]      │
│                                     │
│  � Enable Encryption               │
│  ☐ Password protect this room       │
│                                     │
│  Password: [________________]       │
│  (Optional, 8-64 characters)        │
│                                     │
│  💡 Tip: Only people with the       │
│     password can read messages.     │
│                                     │
│  [Create Room]                      │
└─────────────────────────────────────┘
```

#### 4.2.2 房间设置面板

在右侧边栏显示简化的加密信息：
```
🔐 Encryption

✅ Password Protected
🔑 Status: Active

[Change Password]
[Share Room Info]

💡 Room Password: ••••••••••
   [Show] [Copy]
```

#### 4.2.3 加入房间流程

**场景 1: 房间有密码保护**
```
┌─────────────────────────────────┐
│  � Join Protected Room         │
├─────────────────────────────────┤
│                                 │
│  Room: My Secret Chat           │
│                                 │
│  This room is password          │
│  protected. Enter the password  │
│  to access encrypted messages.  │
│                                 │
│  Password:                      │
│  [____________________]         │
│                                 │
│  [Join Room] [Cancel]           │
│                                 │
│  💡 Ask the room creator for    │
│     the password                │
│                                 │
└─────────────────────────────────┘
```

**场景 2: URL 包含密码**
```
┌─────────────────────────────────┐
│  🔒 Join Encrypted Room?        │
├─────────────────────────────────┤
│                                 │
│  Room: My Secret Chat           │
│                                 │
│  This link includes the room    │
│  password. Click Join to enter. │
│                                 │
│  Password: ••••••••••           │
│  [Show Password]                │
│                                 │
│  [Join Room] [Cancel]           │
│                                 │
└─────────────────────────────────┘
```

**场景 3: 密码错误**
```
┌─────────────────────────────────┐
│  ❌ Incorrect Password          │
├─────────────────────────────────┤
│                                 │
│  The password you entered is    │
│  incorrect. Please try again.   │
│                                 │
│  Password:                      │
│  [____________________]         │
│                                 │
│  [Try Again] [Cancel]           │
│                                 │
│  💡 Make sure you have the      │
│     correct password            │
│                                 │
└─────────────────────────────────┘
```

### 4.3 文件/图片加密 UI

#### 4.3.1 上传进度

```
Uploading: document.pdf
┌────────────────────────────────┐
│ 🔒 Encrypting...    [####    ]  │
│ 📤 Uploading...     [########]  │
│ ✅ Complete!                    │
└────────────────────────────────┘
```

#### 4.3.2 加密图片显示

- 显示加载指示器
- 下载并解密后显示
- 添加"🔒"小图标表示已加密

```html
<div class="encrypted-image-container">
  <img src="[decrypted object url]" alt="Encrypted image">
  <span class="encryption-badge">🔒</span>
</div>
```

### 4.4 错误处理与提示

#### 4.4.1 无法解密消息

显示占位符：
```
🔒 [10:30:00] Alice: [🔐 Encrypted message - Key unavailable]
```

#### 4.4.2 密钥丢失

全屏提示：
```
┌─────────────────────────────────────┐
│  ⚠️  Encryption Key Lost            │
├─────────────────────────────────────┤
│                                     │
│  You cannot read messages in this   │
│  room because the encryption key    │
│  is not available.                  │
│                                     │
│  Options:                           │
│  • Import key from backup           │
│  • Request key from room members    │
│  • Leave room                       │
│                                     │
│  [Import Key] [Request Key] [Leave] │
│                                     │
└─────────────────────────────────────┘
```

---

## 5. 实现路线图

### 5.1 Phase 1: 基础架构

**目标**: 建立加密基础设施

- [ ] 创建加密工具类 (`crypto-utils.js`)
  - AES-GCM 加密/解密
  - RSA 密钥生成
  - 密钥导入/导出
- [ ] 实现密钥管理模块 (`key-manager.js`)
  - IndexedDB 存储
  - 房间密钥管理
  - 用户密钥对管理
- [ ] 添加加密版本控制

### 5.2 Phase 2: 消息加密

**目标**: 实现文本消息端对端加密

- [ ] 修改消息发送流程
  - 客户端加密
  - 添加加密标识
- [ ] 修改消息接收流程
  - 客户端解密
  - 错误处理
- [ ] 实现密钥交换协议
  - 新用户加入流程
  - 在线用户密钥分发
- [ ] UI 更新
  - 加密状态指示
  - 加密设置面板

### 5.3 Phase 3: 文件加密 

**目标**: 实现文件和图片加密上传/下载

- [ ] 实现文件加密上传
  - 流式加密（大文件）
  - 元数据保护
- [ ] 实现文件解密下载
  - 流式解密
  - 内存优化
- [ ] 图片加密显示
  - Lazy loading 集成
  - Object URL 管理
- [ ] UI 优化
  - 上传进度指示
  - 加密图片预览

### 5.4 Phase 4: 高级特性

**目标**: 完善用户体验和安全性

- [ ] 密钥轮换机制
- [ ] 密钥备份与恢复
  - 二维码导出
  - 助记词备份
- [ ] 密钥分享优化
  - URL 参数传递
  - QR 码生成
- [ ] 性能优化
  - Web Workers 加密
  - 批量解密优化

### 5.5 Phase 5: 测试与发布

**目标**: 确保系统稳定性和安全性

- [ ] 单元测试
  - 加密/解密功能
  - 密钥管理
- [ ] 集成测试
  - 多用户场景
  - 密钥交换流程
- [ ] 安全审计
  - 密钥泄漏检查
  - 时序攻击防护
- [ ] 性能测试
  - 大文件加密
  - 批量消息解密
- [ ] 文档编写
  - 用户指南
  - 开发者文档

---

## 6. 技术实现细节

### 6.1 加密工具库 (`crypto-utils.js`)

```javascript
// crypto-utils.js
export class CryptoUtils {
  /**
   * 从密码派生加密密钥（推荐方法）
   * @param {string} password - 用户输入的房间密码
   * @param {string} roomId - 房间ID（作为salt）
   * @param {number} iterations - PBKDF2迭代次数（默认100000）
   * @returns {Promise<CryptoKey>} AES-GCM密钥
   */
  static async deriveKeyFromPassword(password, roomId, iterations = 100000) {
    // 1. 将密码转换为密钥材料
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const baseKey = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    
    // 2. 使用 roomId 作为 salt（确保不同房间不同密钥）
    const salt = encoder.encode(roomId);
    
    // 3. 派生 AES-GCM 密钥
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    
    return derivedKey;
  }

  /**
   * 生成新的 AES-256 房间密钥（高级方案）
   */
  static async generateRoomKey() {
    return await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * 生成 RSA 密钥对（用于密钥交换）
   */
  static async generateKeyPair() {
    return await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * 加密文本消息
   */
  static async encryptMessage(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(plaintext);
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encodedText
    );

    return {
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      version: "1.0"
    };
  }

  /**
   * 解密文本消息
   */
  static async decryptMessage(encryptedData, key) {
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 导出密钥为 Base64
   */
  static async exportKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  /**
   * 从 Base64 导入密钥
   */
  static async importKey(keyBase64) {
    const keyData = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * 使用 RSA 公钥加密对称密钥
   */
  static async encryptKeyWithPublicKey(symmetricKey, publicKey) {
    const exported = await crypto.subtle.exportKey("raw", symmetricKey);
    const encrypted = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      exported
    );
    return Array.from(new Uint8Array(encrypted));
  }

  /**
   * 使用 RSA 私钥解密对称密钥
   */
  static async decryptKeyWithPrivateKey(encryptedKey, privateKey) {
    const keyData = new Uint8Array(encryptedKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      keyData
    );
    
    return await crypto.subtle.importKey(
      "raw",
      decrypted,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }
}
```

### 6.2 密钥管理器 (`key-manager.js`)

```javascript
// key-manager.js
export class KeyManager {
  constructor() {
    this.dbName = "ChatKeysDB";
    this.dbVersion = 1;
    this.db = null;
    this.passwordCache = new Map(); // 内存中缓存密码（可选）
  }

  /**
   * 初始化 IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 房间密码存储（存储密码哈希或直接存储密码）
        if (!db.objectStoreNames.contains("roomPasswords")) {
          db.createObjectStore("roomPasswords", { keyPath: "roomId" });
        }
        
        // 房间密钥缓存（可选，用于性能优化）
        if (!db.objectStoreNames.contains("roomKeys")) {
          db.createObjectStore("roomKeys", { keyPath: "roomId" });
        }
      };
    });
  }

  /**
   * 保存房间密码（推荐方法）
   * @param {string} roomId - 房间ID
   * @param {string} password - 用户输入的密码
   */
  async saveRoomPassword(roomId, password) {
    const tx = this.db.transaction("roomPasswords", "readwrite");
    const store = tx.objectStore("roomPasswords");
    
    await store.put({
      roomId,
      password: password, // 可以选择存储哈希，但为了用户体验存储明文
      createdAt: Date.now()
    });
    
    // 同时缓存到内存
    this.passwordCache.set(roomId, password);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * 获取房间密码
   * @param {string} roomId - 房间ID
   * @returns {Promise<string|null>} 密码或null
   */
  async getRoomPassword(roomId) {
    // 先检查内存缓存
    if (this.passwordCache.has(roomId)) {
      return this.passwordCache.get(roomId);
    }
    
    // 从数据库读取
    const tx = this.db.transaction("roomPasswords", "readonly");
    const store = tx.objectStore("roomPasswords");
    const request = store.get(roomId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        if (request.result) {
          const password = request.result.password;
          this.passwordCache.set(roomId, password);
          resolve(password);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 从密码获取或派生房间密钥
   * @param {string} roomId - 房间ID
   * @param {string} password - 房间密码（可选，如果不提供则从存储读取）
   * @returns {Promise<CryptoKey|null>} 加密密钥或null
   */
  async getRoomKey(roomId, password = null) {
    // 如果没有提供密码，尝试从存储读取
    if (!password) {
      password = await this.getRoomPassword(roomId);
    }
    
    if (!password) {
      return null;
    }
    
    // 从密码派生密钥
    const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);
    return key;
  }

  /**
   * 验证房间密码是否正确
   * @param {string} roomId - 房间ID
   * @param {string} password - 要验证的密码
   * @param {object} testMessage - 用于测试的加密消息
   * @returns {Promise<{success: boolean, key?: CryptoKey, error?: string}>}
   */
  async verifyRoomPassword(roomId, password, testMessage) {
    try {
      // 从密码派生密钥
      const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);
      
      // 尝试解密测试消息
      const decrypted = await CryptoUtils.decryptMessage(testMessage, key);
      
      // 解密成功，保存密码
      await this.saveRoomPassword(roomId, password);
      
      return { success: true, key };
    } catch (error) {
      return { success: false, error: "Incorrect password" };
    }
  }

  /**
   * 存储房间密钥（高级方案，直接存储密钥）
   */
  async saveRoomKey(roomId, key) {
    const exported = await CryptoUtils.exportKey(key);
    const tx = this.db.transaction("roomKeys", "readwrite");
    const store = tx.objectStore("roomKeys");
    
    await store.put({
      roomId,
      key: exported,
      createdAt: Date.now()
    });
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * 获取房间密钥
   */
  async getRoomKey(roomId) {
    const tx = this.db.transaction("roomKeys", "readonly");
    const store = tx.objectStore("roomKeys");
    const request = store.get(roomId);

    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        if (request.result) {
          const key = await CryptoUtils.importKey(request.result.key);
          resolve(key);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除房间密钥
   */
  async deleteRoomKey(roomId) {
    const tx = this.db.transaction("roomKeys", "readwrite");
    const store = tx.objectStore("roomKeys");
    await store.delete(roomId);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * 检查是否有房间密钥
   */
  async hasRoomKey(roomId) {
    const key = await this.getRoomKey(roomId);
    return key !== null;
  }
}
```

### 6.3 消息加密集成（基于房间密码）

```javascript
// 在 chat.html 中的修改

// 初始化密钥管理器
const keyManager = new KeyManager();
await keyManager.init();

// 创建房间时设置密码
async function createRoomWithPassword(roomName, password) {
  // 1. 创建房间
  const roomId = await createRoom(roomName);
  
  if (password) {
    // 2. 保存房间密码
    await keyManager.saveRoomPassword(roomId, password);
    
    // 3. 发送一条测试消息（用于后续密码验证）
    const testKey = await keyManager.getRoomKey(roomId, password);
    const testEncrypted = await CryptoUtils.encryptMessage("__TEST__", testKey);
    
    // 4. 将测试消息保存到服务器（标记为系统消息）
    ws.send(JSON.stringify({
      message: `ENCRYPTED:${JSON.stringify(testEncrypted)}`,
      messageId: crypto.randomUUID(),
      encryptionType: "e2ee-aes256-gcm",
      isTestMessage: true
    }));
  }
  
  return roomId;
}

// 加入房间时验证密码
async function joinRoomWithPassword(roomId, password) {
  // 1. 连接到房间的 WebSocket
  await connectToRoom(roomId);
  
  // 2. 获取最近的一条加密消息作为测试
  const testMessage = await fetchTestMessage(roomId);
  
  if (testMessage) {
    // 3. 验证密码
    const result = await keyManager.verifyRoomPassword(
      roomId, 
      password, 
      testMessage
    );
    
    if (result.success) {
      console.log("Password verified, joining room...");
      return { success: true };
    } else {
      return { success: false, error: "Incorrect password" };
    }
  } else {
    // 没有测试消息，保存密码并尝试
    await keyManager.saveRoomPassword(roomId, password);
    return { success: true };
  }
}

// 发送消息时加密（使用密码派生的密钥）
async function sendMessage(plaintext) {
  // 获取当前房间密钥（自动从密码派生）
  const roomKey = await keyManager.getRoomKey(currentRoomId);
  
  if (roomKey) {
    // 加密消息
    const encrypted = await CryptoUtils.encryptMessage(plaintext, roomKey);
    const encryptedMessage = `ENCRYPTED:${JSON.stringify(encrypted)}`;
    
    // 发送加密消息
    ws.send(JSON.stringify({
      message: encryptedMessage,
      messageId: crypto.randomUUID(),
      encryptionType: "e2ee-aes256-gcm"
    }));
  } else {
    // 没有密码，提示用户输入
    showPasswordPrompt();
  }
}

// 接收消息时解密
ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  
  if (data.message && data.message.startsWith("ENCRYPTED:")) {
    const roomKey = await keyManager.getRoomKey(currentRoomId);
    
    if (roomKey) {
      try {
        const encryptedData = JSON.parse(data.message.substring(10));
        const plaintext = await CryptoUtils.decryptMessage(encryptedData, roomKey);
        
        // 显示解密后的消息
        displayMessage({
          ...data,
          message: plaintext,
          decrypted: true
        });
      } catch (error) {
        console.error("Decryption failed:", error);
        displayMessage({
          ...data,
          message: "[🔐 Unable to decrypt message]",
          decryptionFailed: true
        });
      }
    } else {
      // 没有密钥，显示占位符
      displayMessage({
        ...data,
        message: "[🔐 Encrypted message - Key unavailable]",
        encrypted: true
      });
    }
  } else {
    // 明文消息
    displayMessage(data);
  }
};
```

### 6.4 房间密码处理流程

```javascript
// 处理房间密码的完整流程

// 1. 从 URL 参数获取密码
function getPasswordFromURL() {
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.substring(hash.indexOf('?')));
  
  // 支持多种参数名
  const password = params.get('pwd') || params.get('password') || params.get('p');
  
  // 如果是混淆的密码，解码
  if (params.get('p')) {
    return deobfuscatePassword(password);
  }
  
  return password;
}

// 2. 显示密码输入对话框
function showPasswordPrompt(roomId, roomName) {
  return new Promise((resolve, reject) => {
    // 创建对话框 UI
    const dialog = document.createElement('div');
    dialog.className = 'password-prompt-dialog';
    dialog.innerHTML = `
      <div class="password-prompt-content">
        <h3>🔐 Room is Password Protected</h3>
        <p>Room: ${roomName || roomId}</p>
        <p>Enter the password to access encrypted messages.</p>
        <input type="password" id="room-password-input" 
               placeholder="Enter password" 
               autocomplete="off">
        <div class="password-prompt-actions">
          <button id="password-submit">Join Room</button>
          <button id="password-cancel">Cancel</button>
        </div>
        <p class="password-error" style="display:none;color:red;">
          ❌ Incorrect password. Please try again.
        </p>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    const input = dialog.querySelector('#room-password-input');
    const submitBtn = dialog.querySelector('#password-submit');
    const cancelBtn = dialog.querySelector('#password-cancel');
    const errorMsg = dialog.querySelector('.password-error');
    
    // 聚焦输入框
    input.focus();
    
    // 提交密码
    const submitPassword = async () => {
      const password = input.value.trim();
      
      if (!password) {
        errorMsg.textContent = '⚠️ Please enter a password';
        errorMsg.style.display = 'block';
        return;
      }
      
      // 验证密码
      const testMessage = await fetchTestMessage(roomId);
      const result = await keyManager.verifyRoomPassword(
        roomId, 
        password, 
        testMessage
      );
      
      if (result.success) {
        // 密码正确
        document.body.removeChild(dialog);
        resolve(password);
      } else {
        // 密码错误
        errorMsg.textContent = '❌ Incorrect password. Please try again.';
        errorMsg.style.display = 'block';
        input.value = '';
        input.focus();
      }
    };
    
    // 事件监听
    submitBtn.onclick = submitPassword;
    cancelBtn.onclick = () => {
      document.body.removeChild(dialog);
      reject(new Error('Password prompt cancelled'));
    };
    input.onkeypress = (e) => {
      if (e.key === 'Enter') {
        submitPassword();
      }
    };
  });
}

// 3. 完整的加入房间流程
async function joinRoom(roomId) {
  try {
    // Step 1: 检查 URL 是否包含密码
    let password = getPasswordFromURL();
    
    // Step 2: 如果 URL 有密码，自动填充并提示用户
    if (password) {
      const confirmed = confirm(
        `This link includes a room password.\nClick OK to join with the provided password.`
      );
      
      if (!confirmed) {
        password = null;
      }
    }
    
    // Step 3: 连接到房间
    await connectToRoom(roomId);
    
    // Step 4: 检查房间是否需要密码
    const roomInfo = await fetchRoomInfo(roomId);
    const isEncrypted = roomInfo.encrypted || false;
    
    if (isEncrypted) {
      // Step 5: 尝试从本地存储获取密码
      if (!password) {
        password = await keyManager.getRoomPassword(roomId);
      }
      
      // Step 6: 如果还是没有密码，提示用户输入
      if (!password) {
        password = await showPasswordPrompt(roomId, roomInfo.name);
      }
      
      // Step 7: 验证密码
      const result = await joinRoomWithPassword(roomId, password);
      
      if (result.success) {
        console.log('Successfully joined encrypted room');
        return true;
      } else {
        throw new Error('Failed to join room: ' + result.error);
      }
    } else {
      // 非加密房间，直接加入
      console.log('Joined unencrypted room');
      return true;
    }
  } catch (error) {
    console.error('Failed to join room:', error);
    alert('Failed to join room: ' + error.message);
    return false;
  }
}

// 4. 分享房间信息
function shareRoom(roomId, roomName, password) {
  const baseUrl = window.location.origin + window.location.pathname;
  
  // 生成分享 URL（包含密码）
  const shareUrl = `${baseUrl}#room=${roomId}&pwd=${encodeURIComponent(password)}`;
  
  // 生成分享文本
  const shareText = `Join my chat room!\n\nRoom: ${roomName || roomId}\nPassword: ${password}\n\nOr click: ${shareUrl}`;
  
  // 显示分享对话框
  const dialog = document.createElement('div');
  dialog.className = 'share-dialog';
  dialog.innerHTML = `
    <div class="share-content">
      <h3>📤 Share This Room</h3>
      <div class="share-info">
        <p><strong>Room:</strong> ${roomName || roomId}</p>
        <p><strong>Password:</strong> ${password}</p>
      </div>
      <div class="share-options">
        <button id="copy-link">🔗 Copy Link</button>
        <button id="copy-info">📋 Copy Room Info</button>
        <button id="show-qr">📱 Show QR Code</button>
      </div>
      <div class="share-url">
        <input type="text" value="${shareUrl}" readonly>
      </div>
      <p class="share-warning">⚠️ Keep this password safe!</p>
      <button id="close-share">Close</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // 复制链接
  dialog.querySelector('#copy-link').onclick = () => {
    navigator.clipboard.writeText(shareUrl);
    alert('Link copied to clipboard!');
  };
  
  // 复制房间信息
  dialog.querySelector('#copy-info').onclick = () => {
    navigator.clipboard.writeText(shareText);
    alert('Room info copied to clipboard!');
  };
  
  // 显示 QR 码
  dialog.querySelector('#show-qr').onclick = () => {
    // 这里集成 QR 码生成库
    alert('QR code feature coming soon!');
  };
  
  // 关闭对话框
  dialog.querySelector('#close-share').onclick = () => {
    document.body.removeChild(dialog);
  };
}

// 在线用户分享密钥
ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === "new-user-requesting-key") {
    // 1. 获取房间密钥
    const roomKey = await keyManager.getRoomKey(currentRoomId);
    
    if (roomKey) {
      // 2. 导入新用户的公钥
      const publicKeyData = Uint8Array.from(
        atob(data.publicKey), 
        c => c.charCodeAt(0)
      );
      const publicKey = await crypto.subtle.importKey(
        "spki",
        publicKeyData,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
      );
      
      // 3. 使用公钥加密房间密钥
      const encryptedKey = await CryptoUtils.encryptKeyWithPublicKey(
        roomKey,
        publicKey
      );
      
      // 4. 发送加密的密钥
      ws.send(JSON.stringify({
        type: "share-room-key",
        targetUserId: data.userId,
        encryptedKey: encryptedKey
      }));
    }
  }
};
```

---

## 7. 安全考虑

### 7.1 威胁模型

| 威胁 | 风险等级 | 缓解措施 |
|------|----------|----------|
| 服务器窃取密钥 | ❌ 已防御 | 密钥仅存储在客户端 |
| 中间人攻击 | ⚠️ 中等 | HTTPS + 证书固定 |
| 客户端恶意代码 | ⚠️ 中等 | 子资源完整性 (SRI) |
| 内存转储攻击 | ⚠️ 低 | 及时清理敏感数据 |
| 浏览器扩展窃取 | ⚠️ 中等 | 用户教育 + CSP 策略 |
| 密钥丢失 | ⚠️ 中等 | 密钥备份机制 |
| 重放攻击 | ✅ 已防御 | 时间戳 + 消息 ID |

### 7.2 安全最佳实践

#### 7.2.1 密钥存储
- ✅ 使用 IndexedDB 存储（比 LocalStorage 更安全）
- ✅ 考虑使用 Web Crypto API 的 non-extractable 密钥
- ✅ 定期清理过期密钥

#### 7.2.2 加密参数
- ✅ AES-256-GCM（认证加密）
- ✅ 随机 IV，每条消息不同
- ✅ 使用 Web Crypto API（硬件加速）

#### 7.2.3 密钥交换
- ✅ RSA-OAEP 2048-bit 或 ECDH P-256
- ✅ 临时密钥对，用后即删
- ✅ 验证公钥完整性

#### 7.2.4 前端安全
```html
<!-- 内容安全策略 -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">

<!-- 子资源完整性 -->
<script src="crypto-utils.js" 
        integrity="sha384-..." 
        crossorigin="anonymous"></script>
```

#### 7.2.5 内存安全
```javascript
// 使用后清理敏感数据
function clearSensitiveData(buffer) {
  if (buffer instanceof ArrayBuffer) {
    const view = new Uint8Array(buffer);
    view.fill(0);
  }
}

// 清理解密后的明文
function safeDisplay(decryptedText) {
  displayMessage(decryptedText);
  // 不保留原始字符串引用
  decryptedText = null;
}
```

### 7.3 已知限制

1. **浏览器环境安全性**
   - JavaScript 在浏览器中运行，可能受到恶意扩展影响
   - 解决方案：用户教育，提醒禁用不受信任的扩展

2. **密钥分发问题**
   - 离线房间无法自动获取密钥
   - 解决方案：提供 URL 参数、QR 码等多种分享方式

3. **向前保密性**
   - 长期使用同一密钥降低安全性
   - 解决方案：实现密钥轮换机制

4. **设备丢失**
   - 设备丢失导致密钥永久丢失
   - 解决方案：云端加密备份（可选）

---

## 8. 性能优化与异步处理架构

### 8.1 核心性能原则

**设计目标**：
- 🎯 UI 主线程零阻塞：所有加密操作在 Worker 中异步执行
- 🎯 流式处理大文件：支持 GB 级文件的分块加解密
- 🎯 批量操作优化：历史消息加载时智能批处理
- 🎯 内存高效：避免大数据在主线程堆积

### 8.2 Web Worker 异步加密架构

#### 8.2.1 Worker 线程池设计

**架构图**：
```
┌─────────────────────────────────────────────────────────┐
│                     主线程 (UI Thread)                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────┐               │
│  │  Crypto Manager (调度器)             │               │
│  │  - 任务队列管理                      │               │
│  │  - Worker 池管理                     │               │
│  │  - 负载均衡                          │               │
│  └────────┬─────────────────────────────┘               │
│           │                                               │
│           │ 任务分发                                      │
│           ▼                                               │
└───────────┼───────────────────────────────────────────────┘
            │
            │ postMessage (非阻塞)
            │
┌───────────┼───────────────────────────────────────────────┐
│           ▼                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  Worker #1  │  │  Worker #2  │  │  Worker #N  │      │
│  │  - 加密任务  │  │  - 解密任务  │  │  - 文件处理  │      │
│  │  - PBKDF2   │  │  - 批量处理  │  │  - 流式加密  │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                           │
│              Worker 线程池 (独立线程)                     │
└───────────────────────────────────────────────────────────┘
```

**实现代码**：

```javascript
// crypto-worker-pool.js - Worker 线程池管理器
export class CryptoWorkerPool {
  constructor(workerCount = navigator.hardwareConcurrency || 4) {
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker = new Map();
    this.taskIdCounter = 0;
    
    // 创建 Worker 池
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('crypto-worker.js');
      this.workers.push(worker);
      this.activeTasksPerWorker.set(worker, 0);
      
      // 监听 Worker 响应
      worker.onmessage = (event) => {
        this.handleWorkerResponse(worker, event);
      };
      
      worker.onerror = (error) => {
        console.error(`Worker ${i} error:`, error);
      };
    }
    
    console.log(`✅ Crypto Worker Pool initialized with ${workerCount} workers`);
  }
  
  /**
   * 提交加密任务到 Worker 池
   * @param {string} type - 任务类型: 'encrypt', 'decrypt', 'derive-key', 'encrypt-file'
   * @param {object} data - 任务数据
   * @returns {Promise} 任务结果
   */
  async submitTask(type, data) {
    return new Promise((resolve, reject) => {
      const taskId = this.taskIdCounter++;
      const task = { taskId, type, data, resolve, reject, timestamp: Date.now() };
      
      // 选择负载最低的 Worker
      const worker = this.selectWorker();
      
      if (worker) {
        this.executeTask(worker, task);
      } else {
        // 所有 Worker 繁忙，加入队列
        this.taskQueue.push(task);
      }
    });
  }
  
  /**
   * 选择负载最低的 Worker
   */
  selectWorker() {
    let minLoad = Infinity;
    let selectedWorker = null;
    
    for (const [worker, load] of this.activeTasksPerWorker) {
      if (load < minLoad) {
        minLoad = load;
        selectedWorker = worker;
      }
    }
    
    // 如果所有 Worker 负载过高，返回 null
    return minLoad < 5 ? selectedWorker : null;
  }
  
  /**
   * 在 Worker 上执行任务
   */
  executeTask(worker, task) {
    // 记录任务
    if (!worker._activeTasks) {
      worker._activeTasks = new Map();
    }
    worker._activeTasks.set(task.taskId, task);
    
    // 更新负载
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) + 1
    );
    
    // 发送任务到 Worker
    worker.postMessage({
      taskId: task.taskId,
      type: task.type,
      data: task.data
    });
  }
  
  /**
   * 处理 Worker 响应
   */
  handleWorkerResponse(worker, event) {
    const { taskId, success, result, error } = event.data;
    
    // 获取任务
    const task = worker._activeTasks.get(taskId);
    if (!task) {
      console.warn(`Unknown task ${taskId}`);
      return;
    }
    
    // 清理任务
    worker._activeTasks.delete(taskId);
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) - 1
    );
    
    // 解析结果
    if (success) {
      task.resolve(result);
      
      // 记录性能指标
      const duration = Date.now() - task.timestamp;
      if (duration > 100) {
        console.warn(`Slow crypto task ${task.type}: ${duration}ms`);
      }
    } else {
      task.reject(new Error(error));
    }
    
    // 处理队列中的任务
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.executeTask(worker, nextTask);
    }
  }
  
  /**
   * 批量提交任务（并行处理）
   */
  async submitBatch(tasks) {
    const promises = tasks.map(({ type, data }) => 
      this.submitTask(type, data)
    );
    return Promise.all(promises);
  }
  
  /**
   * 销毁 Worker 池
   */
  destroy() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    console.log('🔥 Crypto Worker Pool destroyed');
  }
}
```

#### 8.2.2 Worker 实现（crypto-worker.js）

```javascript
// crypto-worker.js - Worker 线程中的加密逻辑
importScripts('crypto-utils.js'); // 或使用 ES modules

self.onmessage = async (event) => {
  const { taskId, type, data } = event.data;
  
  try {
    let result;
    
    switch (type) {
      case 'encrypt':
        result = await encryptMessage(data.plaintext, data.key);
        break;
        
      case 'decrypt':
        result = await decryptMessage(data.encrypted, data.key);
        break;
        
      case 'derive-key':
        result = await deriveKeyFromPassword(
          data.password,
          data.roomId,
          data.iterations || 100000
        );
        break;
        
      case 'encrypt-file-chunk':
        result = await encryptFileChunk(
          data.chunk,
          data.key,
          data.chunkIndex
        );
        break;
        
      case 'decrypt-file-chunk':
        result = await decryptFileChunk(
          data.encryptedChunk,
          data.key,
          data.chunkIndex
        );
        break;
        
      case 'batch-decrypt':
        result = await batchDecrypt(data.messages, data.key);
        break;
        
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
    
    // 返回成功结果
    self.postMessage({
      taskId,
      success: true,
      result
    });
    
  } catch (error) {
    // 返回错误
    self.postMessage({
      taskId,
      success: false,
      error: error.message
    });
  }
};

// ===== Worker 内部加密函数 =====

/**
 * 从密码派生密钥（在 Worker 中执行，避免阻塞 UI）
 */
async function deriveKeyFromPassword(password, roomId, iterations) {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const salt = encoder.encode(roomId);
  
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // 导出为可传递的格式
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return { keyData: Array.from(new Uint8Array(exported)) };
}

/**
 * 加密消息
 */
async function encryptMessage(plaintext, keyData) {
  const key = await importKey(keyData);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedText
  );

  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    version: "1.0"
  };
}

/**
 * 解密消息
 */
async function decryptMessage(encryptedData, keyData) {
  const key = await importKey(keyData);
  const iv = new Uint8Array(encryptedData.iv);
  const ciphertext = new Uint8Array(encryptedData.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * 批量解密（优化性能）
 */
async function batchDecrypt(messages, keyData) {
  const key = await importKey(keyData);
  const results = [];
  
  for (const msg of messages) {
    try {
      const decrypted = await decryptMessage(msg, keyData);
      results.push({ success: true, plaintext: decrypted });
    } catch (error) {
      results.push({ success: false, error: error.message });
    }
  }
  
  return results;
}

/**
 * 加密文件分块
 */
async function encryptFileChunk(chunkData, keyData, chunkIndex) {
  const key = await importKey(keyData);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 在 IV 中包含 chunk index，确保每个 chunk 的 IV 唯一
  const ivWithIndex = new Uint8Array(12);
  ivWithIndex.set(iv.slice(0, 8));
  ivWithIndex.set(new Uint8Array(new Uint32Array([chunkIndex]).buffer), 8);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivWithIndex },
    key,
    new Uint8Array(chunkData)
  );
  
  return {
    iv: Array.from(ivWithIndex),
    ciphertext: Array.from(new Uint8Array(encrypted)),
    chunkIndex
  };
}

/**
 * 解密文件分块
 */
async function decryptFileChunk(encryptedChunk, keyData, chunkIndex) {
  const key = await importKey(keyData);
  const iv = new Uint8Array(encryptedChunk.iv);
  const ciphertext = new Uint8Array(encryptedChunk.ciphertext);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  
  return Array.from(new Uint8Array(decrypted));
}

/**
 * 导入密钥
 */
async function importKey(keyData) {
  const keyArray = new Uint8Array(keyData);
  return await crypto.subtle.importKey(
    "raw",
    keyArray,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}
```

#### 8.2.3 主线程集成（使用 Worker 池）

```javascript
// 在主线程中使用 Worker 池
let cryptoPool = null;

/**
 * 初始化加密 Worker 池
 */
async function initCryptoPool() {
  if (!cryptoPool) {
    cryptoPool = new CryptoWorkerPool(4); // 4个 Worker 线程
    console.log('✅ Crypto Worker Pool ready');
  }
}

/**
 * 异步加密消息（不阻塞 UI）
 */
async function encryptMessageAsync(plaintext, roomId) {
  // 1. 获取密钥数据
  const password = await keyManager.getRoomPassword(roomId);
  if (!password) {
    throw new Error('No password found for room');
  }
  
  // 2. 在 Worker 中派生密钥（耗时操作）
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  
  // 3. 在 Worker 中加密消息
  const encrypted = await cryptoPool.submitTask('encrypt', {
    plaintext,
    key: keyResult.keyData
  });
  
  return `ENCRYPTED:${JSON.stringify(encrypted)}`;
}

/**
 * 异步解密消息（不阻塞 UI）
 */
async function decryptMessageAsync(encryptedMessage, roomId) {
  // 1. 解析加密数据
  const encryptedData = JSON.parse(encryptedMessage.substring(10));
  
  // 2. 获取密钥数据
  const password = await keyManager.getRoomPassword(roomId);
  if (!password) {
    return "[🔐 Encrypted message - Password required]";
  }
  
  // 3. 在 Worker 中派生密钥
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  
  // 4. 在 Worker 中解密消息
  try {
    const plaintext = await cryptoPool.submitTask('decrypt', {
      encrypted: encryptedData,
      key: keyResult.keyData
    });
    return plaintext;
  } catch (error) {
    console.error('Decryption failed:', error);
    return "[🔐 Unable to decrypt message]";
  }
}

/**
 * 批量解密历史消息（高性能）
 */
async function decryptHistoryBatch(messages, roomId) {
  // 1. 获取密钥
  const password = await keyManager.getRoomPassword(roomId);
  if (!password) {
    return messages.map(() => ({ success: false, error: 'No password' }));
  }
  
  // 2. 派生密钥（仅一次）
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  
  // 3. 批量解密（在 Worker 中并行处理）
  const encryptedMessages = messages.map(msg => {
    if (msg.message.startsWith('ENCRYPTED:')) {
      return JSON.parse(msg.message.substring(10));
    }
    return null;
  }).filter(Boolean);
  
  const results = await cryptoPool.submitTask('batch-decrypt', {
    messages: encryptedMessages,
    key: keyResult.keyData
  });
  
  // 4. 合并结果
  let resultIndex = 0;
  return messages.map(msg => {
    if (msg.message.startsWith('ENCRYPTED:')) {
      return {
        ...msg,
        message: results[resultIndex].success 
          ? results[resultIndex].plaintext 
          : '[🔐 Decryption failed]',
        decrypted: results[resultIndex].success
      };
      resultIndex++;
    }
    return msg;
  });
}
```

### 8.3 流式文件加密（大文件处理）

#### 8.3.1 流式加密架构

```javascript
/**
 * 流式加密大文件（使用 Worker 池）
 * 支持 GB 级文件，不阻塞 UI
 */
async function encryptLargeFileAsync(file, roomId, onProgress) {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const encryptedChunks = [];
  
  // 获取密钥
  const password = await keyManager.getRoomPassword(roomId);
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  
  console.log(`🔐 Encrypting file: ${file.name} (${totalChunks} chunks)`);
  
  // 创建批量任务
  const tasks = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    
    // 读取 chunk 数据
    const arrayBuffer = await chunk.arrayBuffer();
    
    // 提交加密任务（异步，不阻塞）
    tasks.push(
      cryptoPool.submitTask('encrypt-file-chunk', {
        chunk: Array.from(new Uint8Array(arrayBuffer)),
        key: keyResult.keyData,
        chunkIndex: i
      }).then(result => {
        encryptedChunks[i] = result;
        
        // 更新进度
        const progress = ((i + 1) / totalChunks) * 100;
        if (onProgress) {
          onProgress(progress, 'encrypting');
        }
      })
    );
    
    // 每 8 个 chunk 等待一次，避免内存溢出
    if (tasks.length >= 8) {
      await Promise.all(tasks);
      tasks.length = 0;
    }
  }
  
  // 等待所有任务完成
  await Promise.all(tasks);
  
  console.log(`✅ File encryption complete`);
  
  // 创建元数据
  const metadata = {
    originalName: file.name,
    originalType: file.type,
    originalSize: file.size,
    chunkSize: CHUNK_SIZE,
    totalChunks: totalChunks,
    encrypted: true,
    version: "2.0"
  };
  
  // 组合加密文件
  return {
    metadata,
    chunks: encryptedChunks
  };
}

/**
 * 流式解密大文件
 */
async function decryptLargeFileAsync(encryptedFile, roomId, onProgress) {
  const { metadata, chunks } = encryptedFile;
  const decryptedChunks = [];
  
  // 获取密钥
  const password = await keyManager.getRoomPassword(roomId);
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  
  console.log(`🔓 Decrypting file: ${metadata.originalName} (${chunks.length} chunks)`);
  
  // 批量解密
  const tasks = chunks.map((chunk, index) => 
    cryptoPool.submitTask('decrypt-file-chunk', {
      encryptedChunk: chunk,
      key: keyResult.keyData,
      chunkIndex: index
    }).then(result => {
      decryptedChunks[index] = new Uint8Array(result);
      
      // 更新进度
      const progress = ((index + 1) / chunks.length) * 100;
      if (onProgress) {
        onProgress(progress, 'decrypting');
      }
    })
  );
  
  await Promise.all(tasks);
  
  console.log(`✅ File decryption complete`);
  
  // 合并所有 chunk
  const totalSize = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  
  for (const chunk of decryptedChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  // 创建 Blob
  return new Blob([combined], { type: metadata.originalType });
}

/**
 * 上传加密文件到服务器（带进度）
 */
async function uploadEncryptedFile(file, roomId) {
  const progressDiv = document.createElement('div');
  progressDiv.className = 'upload-progress';
  progressDiv.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill" style="width: 0%"></div>
    </div>
    <div class="progress-text">Encrypting: 0%</div>
  `;
  document.body.appendChild(progressDiv);
  
  // 加密文件
  const encrypted = await encryptLargeFileAsync(file, roomId, (progress, stage) => {
    const fill = progressDiv.querySelector('.progress-fill');
    const text = progressDiv.querySelector('.progress-text');
    
    if (stage === 'encrypting') {
      fill.style.width = `${progress * 0.7}%`; // 加密占 70%
      text.textContent = `Encrypting: ${Math.round(progress)}%`;
    }
  });
  
  // 上传到服务器
  const formData = new FormData();
  formData.append('metadata', JSON.stringify(encrypted.metadata));
  
  // 将所有 chunks 合并为一个 Blob
  const chunksData = encrypted.chunks.map(c => new Uint8Array(c.ciphertext));
  const encryptedBlob = new Blob(chunksData);
  formData.append('file', encryptedBlob, `${file.name}.enc`);
  
  const response = await fetch(`/api/room/${roomId}/upload`, {
    method: 'POST',
    body: formData
  });
  
  progressDiv.querySelector('.progress-fill').style.width = '100%';
  progressDiv.querySelector('.progress-text').textContent = 'Upload complete!';
  
  setTimeout(() => document.body.removeChild(progressDiv), 2000);
  
  return await response.json();
}
```

### 8.4 性能优化策略

#### 8.4.1 密钥缓存优化

```javascript
/**
 * 智能密钥缓存（避免重复派生）
 */
class KeyCache {
  constructor(maxAge = 5 * 60 * 1000) { // 5分钟过期
    this.cache = new Map();
    this.maxAge = maxAge;
  }
  
  /**
   * 获取或派生密钥
   */
  async getKey(roomId, password) {
    const cacheKey = `${roomId}:${password}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      console.log(`📦 Key cache hit for room ${roomId}`);
      return cached.keyData;
    }
    
    // 缓存未命中，派生新密钥
    console.log(`🔑 Deriving key for room ${roomId}...`);
    const keyResult = await cryptoPool.submitTask('derive-key', {
      password,
      roomId,
      iterations: 100000
    });
    
    // 缓存密钥
    this.cache.set(cacheKey, {
      keyData: keyResult.keyData,
      timestamp: Date.now()
    });
    
    return keyResult.keyData;
  }
  
  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > this.maxAge) {
        this.cache.delete(key);
      }
    }
  }
}

const keyCache = new KeyCache();

// 定期清理过期缓存
setInterval(() => keyCache.cleanup(), 60000); // 每分钟清理一次
```

#### 8.4.2 批量处理策略

```javascript
// 批量解密历史消息（优化版）
async function loadAndDecryptHistory(roomId, limit = 100) {
  // 1. 获取历史消息
  const messages = await fetchHistoryMessages(roomId, limit);
  
  // 2. 批量解密（在 Worker 中并行）
  const decrypted = await decryptHistoryBatch(messages, roomId);
  
  // 3. 分批渲染到 UI（避免阻塞）
  const batchSize = 10;
  for (let i = 0; i < decrypted.length; i += batchSize) {
    const batch = decrypted.slice(i, i + batchSize);
    
    // 使用 requestAnimationFrame 确保不阻塞渲染
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        batch.forEach(msg => displayMessage(msg));
        resolve();
      });
    });
  }
  
  console.log(`✅ Loaded and decrypted ${decrypted.length} messages`);
}
```

### 8.5 性能监控与指标

```javascript
/**
 * 性能监控类
 */
class CryptoPerformanceMonitor {
  constructor() {
    this.metrics = {
      encryption: [],
      decryption: [],
      keyDerivation: [],
      fileEncryption: []
    };
  }
  
  /**
   * 记录操作性能
   */
  record(operation, duration, size = 0) {
    this.metrics[operation].push({ duration, size, timestamp: Date.now() });
    
    // 保留最近 100 条记录
    if (this.metrics[operation].length > 100) {
      this.metrics[operation].shift();
    }
    
    // 警告慢操作
    if (duration > 500) {
      console.warn(`⚠️ Slow ${operation}: ${duration}ms`);
    }
  }
  
  /**
   * 获取性能统计
   */
  getStats(operation) {
    const records = this.metrics[operation];
    if (records.length === 0) return null;
    
    const durations = records.map(r => r.duration);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const max = Math.max(...durations);
    const min = Math.min(...durations);
    
    return { avg, max, min, count: records.length };
  }
  
  /**
   * 打印性能报告
   */
  printReport() {
    console.log('📊 Crypto Performance Report:');
    for (const [operation, records] of Object.entries(this.metrics)) {
      const stats = this.getStats(operation);
      if (stats) {
        console.log(`  ${operation}:`, 
          `avg=${stats.avg.toFixed(2)}ms`,
          `max=${stats.max}ms`,
          `min=${stats.min}ms`,
          `count=${stats.count}`
        );
      }
    }
  }
}

const perfMonitor = new CryptoPerformanceMonitor();

// 在操作中使用监控
async function encryptMessageWithMonitoring(plaintext, roomId) {
  const start = performance.now();
  const result = await encryptMessageAsync(plaintext, roomId);
  const duration = performance.now() - start;
  
  perfMonitor.record('encryption', duration, plaintext.length);
  return result;
}
```

### 8.6 性能基准与目标

#### 8.6.1 性能指标要求

| 操作 | 目标时间 | 最大可接受时间 | 优化方案 |
|------|---------|---------------|---------|
| 消息加密 | < 5ms | < 20ms | Worker 异步 |
| 消息解密 | < 5ms | < 20ms | Worker 异步 |
| 密钥派生 (PBKDF2) | < 100ms | < 300ms | Worker + 缓存 |
| 100条历史消息解密 | < 500ms | < 1s | 批量 + Worker 池 |
| 10MB 文件加密 | < 2s | < 5s | 流式 + Worker 池 |
| 100MB 文件加密 | < 20s | < 60s | 流式 + Worker 池 |

#### 8.6.2 性能测试场景

```javascript
/**
 * 性能基准测试套件
 */
async function runPerformanceBenchmark() {
  console.log('🏁 Starting E2EE Performance Benchmark...\n');
  
  // 初始化
  await initCryptoPool();
  const roomId = 'test-room';
  const password = 'testPassword123';
  
  // 测试 1: 密钥派生性能
  console.log('📊 Test 1: Key Derivation (PBKDF2)');
  const keyStart = performance.now();
  const keyResult = await cryptoPool.submitTask('derive-key', {
    password,
    roomId,
    iterations: 100000
  });
  const keyTime = performance.now() - keyStart;
  console.log(`   ✅ Time: ${keyTime.toFixed(2)}ms (target: <100ms)\n`);
  
  // 测试 2: 单条消息加解密
  console.log('📊 Test 2: Single Message Encryption/Decryption');
  const plaintext = 'Hello, this is a test message!';
  
  const encStart = performance.now();
  const encrypted = await cryptoPool.submitTask('encrypt', {
    plaintext,
    key: keyResult.keyData
  });
  const encTime = performance.now() - encStart;
  console.log(`   🔐 Encryption: ${encTime.toFixed(2)}ms (target: <5ms)`);
  
  const decStart = performance.now();
  const decrypted = await cryptoPool.submitTask('decrypt', {
    encrypted,
    key: keyResult.keyData
  });
  const decTime = performance.now() - decStart;
  console.log(`   🔓 Decryption: ${decTime.toFixed(2)}ms (target: <5ms)\n`);
  
  // 测试 3: 批量消息解密（模拟历史记录加载）
  console.log('📊 Test 3: Batch Message Decryption (100 messages)');
  const messages = Array(100).fill(null).map(() => ({
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    version: '1.0'
  }));
  
  const batchStart = performance.now();
  const batchResults = await cryptoPool.submitTask('batch-decrypt', {
    messages,
    key: keyResult.keyData
  });
  const batchTime = performance.now() - batchStart;
  console.log(`   ✅ Time: ${batchTime.toFixed(2)}ms (target: <500ms)`);
  console.log(`   📈 Throughput: ${(100 / (batchTime / 1000)).toFixed(0)} msg/s\n`);
  
  // 测试 4: 大文件加密（模拟）
  console.log('📊 Test 4: Large File Encryption (10MB simulated)');
  const fileSize = 10 * 1024 * 1024; // 10MB
  const chunkSize = 2 * 1024 * 1024; // 2MB chunks
  const numChunks = Math.ceil(fileSize / chunkSize);
  
  const fileStart = performance.now();
  const chunkTasks = [];
  for (let i = 0; i < numChunks; i++) {
    const chunk = new Uint8Array(chunkSize).fill(i);
    chunkTasks.push(
      cryptoPool.submitTask('encrypt-file-chunk', {
        chunk: Array.from(chunk),
        key: keyResult.keyData,
        chunkIndex: i
      })
    );
  }
  await Promise.all(chunkTasks);
  const fileTime = performance.now() - fileStart;
  console.log(`   ✅ Time: ${(fileTime / 1000).toFixed(2)}s (target: <2s)`);
  console.log(`   📈 Throughput: ${(fileSize / (fileTime / 1000) / 1024 / 1024).toFixed(2)} MB/s\n`);
  
  // 测试 5: Worker 池并发性能
  console.log('📊 Test 5: Worker Pool Concurrency (50 parallel encryptions)');
  const concurrentStart = performance.now();
  const concurrentTasks = Array(50).fill(plaintext).map(text => 
    cryptoPool.submitTask('encrypt', {
      plaintext: text,
      key: keyResult.keyData
    })
  );
  await Promise.all(concurrentTasks);
  const concurrentTime = performance.now() - concurrentStart;
  console.log(`   ✅ Time: ${concurrentTime.toFixed(2)}ms`);
  console.log(`   📈 Avg per task: ${(concurrentTime / 50).toFixed(2)}ms\n`);
  
  // 总结
  console.log('🎉 Benchmark Complete!');
  console.log('\n📋 Summary:');
  console.log(`   Key Derivation: ${keyTime.toFixed(2)}ms ${keyTime < 100 ? '✅' : '⚠️'}`);
  console.log(`   Encryption: ${encTime.toFixed(2)}ms ${encTime < 5 ? '✅' : '⚠️'}`);
  console.log(`   Decryption: ${decTime.toFixed(2)}ms ${decTime < 5 ? '✅' : '⚠️'}`);
  console.log(`   Batch (100): ${batchTime.toFixed(2)}ms ${batchTime < 500 ? '✅' : '⚠️'}`);
  console.log(`   File (10MB): ${(fileTime / 1000).toFixed(2)}s ${fileTime < 2000 ? '✅' : '⚠️'}`);
  
  perfMonitor.printReport();
}

// 在开发环境中运行基准测试
if (window.location.search.includes('benchmark=true')) {
  window.addEventListener('load', () => {
    setTimeout(runPerformanceBenchmark, 1000);
  });
}
```

### 8.7 实际应用中的性能优化策略

#### 8.7.1 懒加载与渐进式解密

```javascript
/**
 * 渐进式加载和解密历史消息
 * 用户体验优先：先显示结构，再逐步解密内容
 */
class ProgressiveMessageLoader {
  constructor(roomId) {
    this.roomId = roomId;
    this.isLoading = false;
    this.hasMore = true;
    this.offset = 0;
    this.batchSize = 50;
  }
  
  /**
   * 加载下一批消息
   */
  async loadNext() {
    if (this.isLoading || !this.hasMore) return;
    
    this.isLoading = true;
    console.log(`📥 Loading messages ${this.offset} - ${this.offset + this.batchSize}`);
    
    try {
      // 1. 从服务器获取加密消息（快速）
      const messages = await this.fetchMessages(this.offset, this.batchSize);
      
      if (messages.length === 0) {
        this.hasMore = false;
        return;
      }
      
      // 2. 立即显示消息结构（用占位符代替内容）
      messages.forEach(msg => {
        this.displayMessageSkeleton(msg);
      });
      
      // 3. 后台异步解密（不阻塞）
      this.decryptAndUpdateMessages(messages);
      
      this.offset += messages.length;
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * 显示消息骨架（占位符）
   */
  displayMessageSkeleton(msg) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message skeleton';
    messageElement.id = `msg-${msg.messageId}`;
    messageElement.innerHTML = `
      <div class="message-header">
        <span class="username">${msg.name}</span>
        <span class="timestamp">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-body">
        <span class="decrypting-indicator">🔓 Decrypting...</span>
      </div>
    `;
    
    document.getElementById('messages').appendChild(messageElement);
  }
  
  /**
   * 异步解密并更新消息
   */
  async decryptAndUpdateMessages(messages) {
    // 分批解密，每批 10 条
    const subBatchSize = 10;
    
    for (let i = 0; i < messages.length; i += subBatchSize) {
      const batch = messages.slice(i, i + subBatchSize);
      
      // 异步解密这一批
      const decryptedBatch = await decryptHistoryBatch(batch, this.roomId);
      
      // 更新 UI（使用 requestAnimationFrame 避免阻塞）
      requestAnimationFrame(() => {
        decryptedBatch.forEach(msg => {
          const element = document.getElementById(`msg-${msg.messageId}`);
          if (element) {
            element.classList.remove('skeleton');
            element.querySelector('.message-body').innerHTML = 
              `<span class="message-text">${escapeHtml(msg.message)}</span>`;
          }
        });
      });
      
      // 短暂延迟，避免 CPU 占用过高
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log(`✅ Decrypted ${messages.length} messages`);
  }
  
  async fetchMessages(offset, limit) {
    const response = await fetch(
      `/api/room/${this.roomId}/messages?offset=${offset}&limit=${limit}`
    );
    return await response.json();
  }
}

// 使用示例
let messageLoader = null;

function initMessageLoader(roomId) {
  messageLoader = new ProgressiveMessageLoader(roomId);
  
  // 加载第一批
  messageLoader.loadNext();
  
  // 滚动到底部时自动加载更多
  const messagesContainer = document.getElementById('messages');
  messagesContainer.addEventListener('scroll', () => {
    const scrollTop = messagesContainer.scrollTop;
    if (scrollTop < 100) { // 接近顶部
      messageLoader.loadNext();
    }
  });
}
```

#### 8.7.2 内存管理与清理

```javascript
/**
 * 内存管理器 - 防止长时间运行时内存泄漏
 */
class CryptoMemoryManager {
  constructor() {
    this.decryptedCache = new Map();
    this.maxCacheSize = 200; // 最多缓存 200 条解密消息
    this.objectUrls = new Set();
  }
  
  /**
   * 缓存解密后的消息
   */
  cacheDecrypted(messageId, plaintext) {
    // LRU 策略：删除最旧的
    if (this.decryptedCache.size >= this.maxCacheSize) {
      const firstKey = this.decryptedCache.keys().next().value;
      this.decryptedCache.delete(firstKey);
    }
    
    this.decryptedCache.set(messageId, plaintext);
  }
  
  /**
   * 获取缓存的解密消息
   */
  getCached(messageId) {
    return this.decryptedCache.get(messageId);
  }
  
  /**
   * 注册 Object URL（用于图片/文件）
   */
  registerObjectUrl(url) {
    this.objectUrls.add(url);
  }
  
  /**
   * 清理 Object URLs
   */
  cleanup() {
    console.log(`🧹 Cleaning up ${this.objectUrls.size} object URLs`);
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }
  
  /**
   * 清理旧消息缓存
   */
  clearOldCache(maxAge = 10 * 60 * 1000) { // 10分钟
    // 这里可以添加时间戳跟踪
    console.log('🧹 Clearing old decrypted message cache');
    this.decryptedCache.clear();
  }
}

const memoryManager = new CryptoMemoryManager();

// 定期清理
setInterval(() => {
  memoryManager.clearOldCache();
}, 5 * 60 * 1000); // 每5分钟清理一次
```

#### 8.7.3 智能预加载策略

```javascript
/**
 * 智能预加载 - 预测用户行为，提前解密
 */
class SmartPreloader {
  constructor(roomId) {
    this.roomId = roomId;
    this.preloadThreshold = 10; // 距离可见区域 10 条消息时预加载
  }
  
  /**
   * 检查是否需要预加载
   */
  checkPreload() {
    const messagesContainer = document.getElementById('messages');
    const messages = messagesContainer.querySelectorAll('.message');
    
    // 找到最后一条可见消息
    const viewportBottom = messagesContainer.scrollTop + messagesContainer.clientHeight;
    
    let lastVisibleIndex = -1;
    messages.forEach((msg, index) => {
      const rect = msg.getBoundingClientRect();
      if (rect.top < viewportBottom) {
        lastVisibleIndex = index;
      }
    });
    
    // 如果接近底部，预加载更多
    if (lastVisibleIndex >= 0 && 
        messages.length - lastVisibleIndex < this.preloadThreshold) {
      this.preloadNext();
    }
  }
  
  /**
   * 预加载下一批消息
   */
  async preloadNext() {
    if (messageLoader && !messageLoader.isLoading && messageLoader.hasMore) {
      console.log('🔮 Smart preload: loading next batch');
      await messageLoader.loadNext();
    }
  }
}

// 使用 Intersection Observer 优化滚动性能
function setupSmartPreload(roomId) {
  const preloader = new SmartPreloader(roomId);
  
  const messagesContainer = document.getElementById('messages');
  
  // 使用 throttle 避免过度触发
  let throttleTimer = null;
  messagesContainer.addEventListener('scroll', () => {
    if (throttleTimer) return;
    
    throttleTimer = setTimeout(() => {
      preloader.checkPreload();
      throttleTimer = null;
    }, 200);
  });
}
```

### 8.8 移动端性能优化

```javascript
/**
 * 移动端特定优化
 */
const MobileOptimizations = {
  /**
   * 检测设备性能
   */
  detectPerformance() {
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 4; // GB
    
    if (cores <= 2 || memory <= 2) {
      return 'low';
    } else if (cores <= 4 || memory <= 4) {
      return 'medium';
    } else {
      return 'high';
    }
  },
  
  /**
   * 根据设备性能调整参数
   */
  getOptimalSettings() {
    const performance = this.detectPerformance();
    
    switch (performance) {
      case 'low':
        return {
          workerCount: 2,
          batchSize: 20,
          fileChunkSize: 1 * 1024 * 1024, // 1MB
          maxConcurrent: 2,
          pbkdf2Iterations: 50000 // 降低迭代次数
        };
      case 'medium':
        return {
          workerCount: 4,
          batchSize: 50,
          fileChunkSize: 2 * 1024 * 1024, // 2MB
          maxConcurrent: 4,
          pbkdf2Iterations: 100000
        };
      case 'high':
      default:
        return {
          workerCount: 8,
          batchSize: 100,
          fileChunkSize: 4 * 1024 * 1024, // 4MB
          maxConcurrent: 8,
          pbkdf2Iterations: 100000
        };
    }
  },
  
  /**
   * 应用优化设置
   */
  apply() {
    const settings = this.getOptimalSettings();
    console.log('📱 Applying mobile optimizations:', settings);
    
    // 重新初始化 Worker 池
    if (cryptoPool) {
      cryptoPool.destroy();
    }
    cryptoPool = new CryptoWorkerPool(settings.workerCount);
    
    // 更新其他参数
    window.CRYPTO_SETTINGS = settings;
  }
};

// 页面加载时自动应用优化
window.addEventListener('load', () => {
  MobileOptimizations.apply();
});
```

### 8.9 性能最佳实践总结

#### ✅ 关键原则

1. **异步优先**
   - ✅ 所有加密操作在 Worker 中执行
   - ✅ UI 主线程只负责渲染
   - ✅ 使用 `requestAnimationFrame` 更新 UI

2. **批量处理**
   - ✅ 历史消息批量解密
   - ✅ 文件分块并行处理
   - ✅ 智能批次大小（根据设备性能）

3. **缓存策略**
   - ✅ 密钥缓存（避免重复派生）
   - ✅ 解密消息缓存（LRU）
   - ✅ 定期清理防止内存泄漏

4. **渐进式加载**
   - ✅ 先显示结构，再解密内容
   - ✅ 可见区域优先解密
   - ✅ 智能预加载

5. **设备适配**
   - ✅ 检测设备性能
   - ✅ 动态调整参数
   - ✅ 低端设备降级处理

#### 📊 预期性能表现

| 场景 | 低端设备 | 中端设备 | 高端设备 |
|------|---------|---------|---------|
| 消息加密/解密 | < 10ms | < 5ms | < 3ms |
| 密钥派生 | < 500ms | < 200ms | < 100ms |
| 100条历史 | < 2s | < 1s | < 500ms |
| 10MB文件 | < 10s | < 5s | < 2s |
| UI 响应性 | 流畅 | 流畅 | 流畅 |

---

## 9. 测试计划

### 9.1 单元测试

```javascript
// crypto-utils.test.js
describe('CryptoUtils', () => {
  test('should encrypt and decrypt message correctly', async () => {
    const key = await CryptoUtils.generateRoomKey();
    const plaintext = "Hello, World!";
    
    const encrypted = await CryptoUtils.encryptMessage(plaintext, key);
    const decrypted = await CryptoUtils.decryptMessage(encrypted, key);
    
    expect(decrypted).toBe(plaintext);
  });
  
  test('should fail to decrypt with wrong key', async () => {
    const key1 = await CryptoUtils.generateRoomKey();
    const key2 = await CryptoUtils.generateRoomKey();
    const plaintext = "Secret message";
    
    const encrypted = await CryptoUtils.encryptMessage(plaintext, key1);
    
    await expect(
      CryptoUtils.decryptMessage(encrypted, key2)
    ).rejects.toThrow();
  });
  
  test('should export and import key correctly', async () => {
    const originalKey = await CryptoUtils.generateRoomKey();
    const exported = await CryptoUtils.exportKey(originalKey);
    const imported = await CryptoUtils.importKey(exported);
    
    const plaintext = "Test message";
    const encrypted = await CryptoUtils.encryptMessage(plaintext, originalKey);
    const decrypted = await CryptoUtils.decryptMessage(encrypted, imported);
    
    expect(decrypted).toBe(plaintext);
  });
});
```

### 9.2 集成测试

```javascript
// integration.test.js
describe('E2EE Integration', () => {
  test('should complete full key exchange flow', async () => {
    // 模拟两个用户
    const user1 = new ChatClient("Alice");
    const user2 = new ChatClient("Bob");
    
    // User1 创建房间并生成密钥
    const roomId = await user1.createRoom();
    const roomKey = await user1.getRoomKey(roomId);
    
    // User2 加入房间并请求密钥
    await user2.joinRoom(roomId);
    
    // User1 分享密钥给 User2
    await user1.shareKeyWith(user2.userId);
    
    // 验证 User2 收到密钥
    const receivedKey = await user2.getRoomKey(roomId);
    expect(receivedKey).toBeDefined();
    
    // 验证两个用户可以互相发送加密消息
    const message = "Hello from Alice";
    await user1.sendMessage(message);
    
    const received = await user2.receiveMessage();
    expect(received.plaintext).toBe(message);
  });
});
```

### 9.3 性能测试

```javascript
// performance.test.js
describe('Performance', () => {
  test('should encrypt 100 messages in < 1 second', async () => {
    const key = await CryptoUtils.generateRoomKey();
    const messages = Array(100).fill("Test message");
    
    const start = performance.now();
    
    await Promise.all(
      messages.map(msg => CryptoUtils.encryptMessage(msg, key))
    );
    
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(1000);
  });
  
  test('should decrypt 100 messages in < 1 second', async () => {
    const key = await CryptoUtils.generateRoomKey();
    const messages = await Promise.all(
      Array(100).fill("Test").map(msg => 
        CryptoUtils.encryptMessage(msg, key)
      )
    );
    
    const start = performance.now();
    
    await Promise.all(
      messages.map(enc => CryptoUtils.decryptMessage(enc, key))
    );
    
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(1000);
  });
});
```

---

## 10. 用户文档

### 10.1 快速开始指南

#### 创建加密房间

1. 点击 "Create a Private Room"
2. 勾选 "Password protect this room"
3. 输入一个密码（如 "mySecret123"）
4. 点击 "Create Room"
5. 系统会自动使用密码加密所有消息

**提示**: 选择一个容易记住但难以猜测的密码。

#### 加入加密房间

**方式 1: 从链接加入（推荐）**
1. 点击朋友分享的链接（包含密码）
2. 确认加入房间
3. 开始安全聊天

**方式 2: 手动输入密码**
1. 输入房间 ID
2. 系统提示输入密码
3. 输入朋友告诉你的密码
4. 密码验证成功后进入房间

**方式 3: 扫描 QR 码**
1. 使用手机相机扫描 QR 码
2. 自动打开房间并填入密码
3. 点击加入

#### 分享加密房间

1. 在房间设置中点击 "Share Room Info"
2. 选择分享方式：
   - **复制链接**: 包含密码的完整链接
   - **复制信息**: 房间 ID + 密码文本
   - **显示 QR 码**: 生成二维码供扫描
3. 通过安全方式发送给朋友

**安全提示**:
- ✅ 通过端对端加密的聊天工具分享（如 Signal、WhatsApp）
- ✅ 当面告知密码
- ❌ 不要在公开场合发送链接
- ❌ 不要通过明文邮件发送密码

#### 修改房间密码

1. 点击房间设置中的 "Change Password"
2. 输入新密码
3. 确认修改
4. 所有后续消息将使用新密码加密
5. 记得通知房间成员新密码

### 10.2 常见问题

**Q: 什么是端对端加密？**
A: 端对端加密确保只有你和对话方能读取消息，即使是服务器管理员也无法查看内容。所有消息在你的设备上加密，在对方设备上解密，中间服务器只看到乱码。

**Q: 房间密码是什么？**
A: 房间密码就像一把钥匙，只有知道密码的人才能读取房间里的消息。它可以是任何 8-64 个字符的文本，就像你的 WiFi 密码一样。

**Q: 我不想设置密码，还能有隐私保护吗？**
A: **可以！默认情况下，系统会自动使用房间名作为密码**。这意味着：
- ✅ 你创建房间"Team Meeting"，密码就是"Team Meeting"
- ✅ 只有知道房间名的人才能解密消息
- ✅ 提供基本的隐私保护，无需记忆额外密码
- ✅ 你仍然可以选择设置自定义密码以提高安全性

**使用场景对比**：

| 场景 | 推荐方案 | 说明 |
|------|---------|------|
| **小团队内部聊天** | 基础隐私（默认） | 使用房间名作为密码，简单方便 |
| **项目讨论** | 基础隐私（默认） | 分享房间名即可，团队成员都知道 |
| **敏感信息交流** | 增强隐私 | 设置复杂的自定义密码 |
| **临时聊天** | 基础隐私（默认） | 用完即弃，无需复杂设置 |
| **公开讨论** | 不加密 | 完全公开，任何人可见 |

**示例**：
```
场景：团队会议
- 创建房间："Daily Standup"
- 密码：自动使用 "Daily Standup"
- 分享：告诉团队成员房间名就行
- 加入：输入房间名即可自动验证

场景：机密项目
- 创建房间："Project X"
- 密码：设置自定义 "SecurePass2024!"
- 分享：分别告知房间名和密码
- 加入：必须输入正确的自定义密码
```

**Q: 我忘记了房间密码怎么办？**
A: 根据房间的隐私级别：

**基础隐私房间**：
- 密码就是房间名，直接输入房间名即可
- 除非创建者修改了密码

**增强隐私房间**：
- 如果忘记自定义密码，你将无法解密历史消息
- 可以询问房间里的其他成员
- 如果你是房间创建者，考虑创建新房间
- 检查是否在浏览器中保存了密码

**Q: 密码需要多复杂？**
A: 根据你的需求选择：

**基础隐私（默认）**：
- ✅ 使用房间名作为密码
- ✅ 适合大多数场景
- ✅ 简单易用，无需记忆

**增强隐私（推荐敏感场景）**：
- ✅ 至少 8 个字符
- ✅ 包含字母和数字
- ✅ 容易记住但难以猜测
- 示例：`MyChat2024`、`SecretGroup123!`

**Q: 加密会影响性能吗？**
A: 不会。Web Crypto API 使用硬件加速，加密和解密速度非常快，你不会感觉到任何延迟。

**Q: 可以在多个设备上使用同一个房间吗？**
A: 可以！只要在每个设备上输入相同的房间密码即可。密码会自动保存在设备上，下次访问无需重新输入。

对于基础隐私房间，只需输入房间名即可自动加入。

**Q: 如何分享房间给朋友？**
A: 根据房间类型有不同的方式：

**基础隐私房间（默认）**：
- 只需告诉朋友房间名："来加入 'Team Meeting' 房间"
- 系统会自动使用房间名作为密码验证
- 最简单！

**增强隐私房间**：
1. 分享包含密码的链接（最方便）
2. 分享房间名和自定义密码（分别告知）
3. 显示 QR 码让朋友扫描

**Q: URL 中包含密码安全吗？**
A: 虽然不是最安全的方式，但适合快速分享。建议：
- 通过端对端加密的聊天工具发送（如 Signal、WhatsApp）
- 分享后可以考虑修改密码
- 或者分别发送房间名和密码

对于基础隐私房间，只需分享房间名，不需要在 URL 中包含密码。

**Q: 加密的文件存储在哪里？**
A: 加密后的文件存储在 Cloudflare R2 存储服务上，但服务器只能看到加密后的数据，无法解密查看实际内容。

**Q: 可以修改房间密码吗？**
A: 可以！房间创建者可以随时修改密码。修改后，旧密码将无法解密新消息，但历史消息仍然可以用旧密码解密。

**注意**：如果你的房间使用基础隐私（房间名作为密码），修改密码后用户无法通过房间名自动加入，需要告知新密码。

**Q: 如果有人知道了密码怎么办？**
A: 立即修改房间密码，修改后的新消息他们将无法解密。考虑创建新房间并只邀请信任的人。

对于基础隐私房间，意味着任何知道房间名的人都能加入。如果需要更严格的控制，建议升级到增强隐私模式（设置自定义密码）。

**Q: 房间密码会发送到服务器吗？**
A: **不会！**密码只在你的浏览器中使用，用于派生加密密钥。服务器从不知道你的密码，只看到加密后的消息。

**Q: 基础隐私和增强隐私有什么区别？**
A: 

| 特性 | 基础隐私（默认） | 增强隐私 | 不加密 |
|------|---------------|---------|--------|
| **密码** | 自动使用房间名 | 自定义密码 | 无 |
| **易用性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **安全性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ |
| **适用场景** | 团队内部、朋友聊天 | 敏感信息、机密项目 | 公开讨论 |
| **加入方式** | 输入房间名 | 输入房间名+密码 | 输入房间ID |
| **防护对象** | 陌生人 | 所有人（除非知道密码） | 无防护 |

**推荐**：默认使用基础隐私，既有保护又方便使用。敏感场景使用增强隐私。

---

## 11. 附录

### 11.1 术语表

- **E2EE**: End-to-End Encryption，端对端加密
- **AES-GCM**: Advanced Encryption Standard - Galois/Counter Mode，高级加密标准
- **RSA-OAEP**: RSA Optimal Asymmetric Encryption Padding
- **ECDH**: Elliptic Curve Diffie-Hellman，椭圆曲线密钥交换
- **IV**: Initialization Vector，初始化向量
- **Web Crypto API**: 浏览器提供的加密 API
- **IndexedDB**: 浏览器本地数据库

### 11.2 参考资源

- [Web Crypto API 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [OWASP 加密最佳实践](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [Signal 协议文档](https://signal.org/docs/)
- [NIST 加密标准](https://csrc.nist.gov/projects/cryptographic-standards-and-guidelines)

### 11.3 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0  | 2025-10-26 | 初始版本 |

---

## 12. 总结

本 PRD 详细描述了为 Cloudflare Workers Chat 应用实现端对端加密的完整方案，包括：

✅ **完整的加密架构**：基于 Web Crypto API 的 AES-GCM + RSA-OAEP 方案
✅ **密钥管理系统**：IndexedDB 存储、密钥交换、备份恢复
✅ **全方位加密**：文本消息、文件、图片、聊天历史
✅ **友好的用户体验**：加密状态指示、错误处理、多种密钥分享方式
✅ **高性能异步架构**：Web Workers 线程池、批量处理、流式加密
✅ **安全考虑**：威胁模型分析、安全最佳实践
✅ **清晰的实现路线图**：分 5 个阶段，共 10 周完成

---

## 13. 常见疑问解答（产品团队必读）

### Q1: 加密会影响服务端性能吗？

**答：完全不会！服务端无需做任何加密工作。**

服务端（Cloudflare Workers + Durable Objects + R2）的工作流程与之前**完全相同**：
- 接收数据 → 存储数据 → 转发数据
- 唯一的区别是存储的内容从明文变为密文
- 服务端 CPU、内存、存储开销**零增长**
- 延迟**无变化**（加解密在客户端，不阻塞服务端）

```javascript
// 服务端代码（加密前后对比）

// ===== 加密前 =====
await storage.put(timestamp, {
  message: "Hello World"  // 明文
});

// ===== 加密后 =====
await storage.put(timestamp, {
  message: "ENCRYPTED:{...}"  // 密文
});

// 👆 代码完全相同！只是数据内容不同
// 服务端性能影响：0%
```

### Q2: 服务端需要做什么改动吗？

**答：服务端几乎零改动！**

| 组件 | 需要修改吗 | 说明 |
|------|-----------|------|
| Durable Objects API | ❌ 不需要 | 继续存储 `message` 字段，只是内容变了 |
| R2 存储 | ❌ 不需要 | 继续存储文件，只是文件是加密的 |
| WebSocket 转发 | ❌ 不需要 | 继续转发消息，只是转发密文 |
| 数据结构 | ❌ 不需要 | JSON 结构完全一致 |
| HTTP API | ❌ 不需要 | 接口签名不变 |

**服务端唯一可能需要的改动**（可选）：
- 添加一个 `encryptionType` 字段用于标识加密类型
- 添加一个房间元数据字段标记房间是否启用加密
- 这些都是**元数据**，不影响加密本身

### Q3: 数据库存储的是什么？

**答：数据库存储的是密文，服务器无法解密。**

**存储示例**：

```json
// Durable Objects 中的实际存储数据
{
  "2025-10-26T10:30:00.000Z": {
    "name": "Alice",
    "message": "ENCRYPTED:{iv:[12,34,56,78,90,...], ciphertext:[11,22,33,44,55,...]}",
    "messageId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1729936200000,
    "encryptionType": "e2ee-aes256-gcm"
  }
}
```

**关键点**：
- `name`: 明文（公开信息）
- `message`: **密文**（服务器无法解密）
- `messageId`: 明文（公开信息）
- `timestamp`: 明文（公开信息）

**即使数据库管理员也无法读取 `message` 的内容！**

### Q4: 性能会影响用户体验吗？

**答：不会！设计上已经充分考虑性能。**

**性能保证**：

| 操作 | 目标时间 | 用户感知 |
|------|---------|---------|
| 发送消息 | < 5ms 加密 | ✅ 无感知 |
| 接收消息 | < 5ms 解密 | ✅ 无感知 |
| 加载 100 条历史 | < 500ms | ✅ 流畅 |
| 上传 10MB 图片 | < 2s 加密 | ✅ 可接受 |

**性能优化手段**：

1. **Web Workers 异步处理**
   - 所有加密操作在后台线程
   - UI 主线程完全不阻塞
   - 多线程并行处理

2. **智能缓存**
   - 密钥缓存（避免重复派生）
   - 解密消息缓存（避免重复解密）
   - LRU 策略防止内存溢出

3. **批量处理**
   - 历史消息批量解密
   - 文件分块并行加密
   - 减少线程切换开销

4. **渐进式加载**
   - 先显示消息结构
   - 后台异步解密
   - 用户无需等待

5. **设备自适应**
   - 检测设备性能
   - 低端设备降低并发数
   - 高端设备充分利用多核

**实际体验**：
```
用户视角：
1. 输入消息 → 点击发送
2. 立即显示在界面上（< 10ms）
3. 背景异步加密并发送（< 5ms）
4. 接收方立即看到消息（< 5ms 解密）

✅ 用户感觉：和未加密时一模一样！
```

### Q5: 历史消息加载会很慢吗？

**答：不会！采用渐进式解密，用户体验流畅。**

**加载策略**：

```javascript
// 第一阶段：快速显示结构（< 50ms）
加载消息列表 → 显示消息框架（占位符）

// 第二阶段：后台解密（批量并行）
使用 Worker 池批量解密 → 逐步更新内容

// 第三阶段：按需加载
滚动到顶部 → 加载更多历史 → 重复上述过程
```

**用户看到的效果**：

```
加载第一屏（50条消息）：
- 0-50ms: 显示消息框架（灰色占位符）
- 50-300ms: 逐步显示解密内容（10条/批次）
- 用户感觉：快速且流畅

加载更多历史：
- 滚动到顶部触发
- 预加载机制（提前解密）
- 无缝加载体验
```

### Q6: 移动端性能怎么样？

**答：专门优化了移动端，低端设备也能流畅运行。**

**自适应策略**：

```javascript
// 自动检测设备性能
if (低端设备) {
  - 2 个 Worker 线程
  - 批次大小: 20 条/批
  - PBKDF2 迭代: 50,000 次
  - 文件分块: 1MB
}

if (中端设备) {
  - 4 个 Worker 线程
  - 批次大小: 50 条/批
  - PBKDF2 迭代: 100,000 次
  - 文件分块: 2MB
}

if (高端设备) {
  - 8 个 Worker 线程
  - 批次大小: 100 条/批
  - PBKDF2 迭代: 100,000 次
  - 文件分块: 4MB
}
```

**移动端测试数据**（预期）：

| 设备 | 发送消息 | 接收消息 | 加载50条历史 |
|------|---------|---------|-------------|
| iPhone 15 Pro | < 3ms | < 3ms | < 200ms |
| iPhone 12 | < 5ms | < 5ms | < 400ms |
| 中端 Android | < 8ms | < 8ms | < 600ms |
| 低端手机 | < 15ms | < 15ms | < 1s |

✅ **即使是低端手机，用户体验依然流畅！**

### Q7: 与现有功能兼容吗？

**答：完全兼容！支持逐步迁移。**

**兼容性设计**：

1. **房间级别开关**
   - 未加密房间：继续使用明文（向后兼容）
   - 加密房间：使用 E2EE
   - 两种房间可以共存

2. **逐步迁移**
   - 新房间默认启用加密
   - 旧房间继续使用明文
   - 用户可选择是否加密

3. **消息标识**
   ```javascript
   // 系统自动识别消息类型
   if (message.startsWith("ENCRYPTED:")) {
     解密显示
   } else {
     直接显示
   }
   ```

4. **功能无缺失**
   - 线程回复：支持✅
   - @提及：支持✅
   - 表情回应：支持✅
   - 文件上传：支持✅
   - 图片预览：支持✅
   - 搜索历史：支持✅（客户端解密后搜索）

### Q8: 开发工作量有多大？

**答：主要工作在客户端，约 8-10 周完成。**

**工作量分解**：

| 阶段 | 工作内容 | 时间 | 人员 |
|------|---------|------|------|
| Phase 1 | 加密工具库、Worker 池 | 2 周 | 1 前端 |
| Phase 2 | 消息加密、UI 集成 | 2 周 | 1 前端 |
| Phase 3 | 文件加密、流式处理 | 2 周 | 1 前端 |
| Phase 4 | 性能优化、移动端 | 2 周 | 1 前端 |
| Phase 5 | 测试、文档、发布 | 2 周 | 1 前端 + 1 QA |

**服务端工作量**：
- 基本无需修改
- 可选：添加房间加密标识（< 1 天）
- 可选：添加元数据字段（< 1 天）

**总计**：
- 前端开发：8-10 周（1 人）
- 后端开发：0-2 天（可选）
- 测试 + 文档：2 周

### Q9: 有什么风险吗？

**答：主要风险可控，建议分阶段推出。**

**技术风险**：

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|-------|------|---------|
| 浏览器兼容性 | 低 | 中 | Web Crypto API 广泛支持，降级处理 |
| 性能问题 | 低 | 中 | 充分的性能测试和优化 |
| 密钥管理复杂 | 中 | 高 | 简化为房间密码方案 |
| 用户忘记密码 | 高 | 中 | 提供密码恢复机制、备份功能 |

**产品风险**：

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|-------|------|---------|
| 用户学习成本 | 中 | 低 | 简化 UI，像 WiFi 密码一样简单 |
| 密码分享困难 | 中 | 中 | 提供多种分享方式（链接、QR 码） |
| 跨设备同步 | 高 | 中 | 密码自动保存，支持手动导入导出 |

**推荐发布策略**：

```
第一阶段：内测（2 周）
- 10-20 个内部用户
- 收集反馈，修复 bug
- 验证性能指标

第二阶段：Beta 测试（4 周）
- 100-500 个外部用户
- 监控性能数据
- 优化用户体验

第三阶段：逐步推广（6 周）
- 新房间默认启用加密
- 旧房间保持不变
- 观察用户反馈和采用率

第四阶段：全量发布
- 所有新房间启用加密
- 提供加密迁移工具
- 发布用户指南
```

### Q10: 为什么选择这个方案？

**答：平衡了安全性、易用性和实现成本。**

**方案对比**：

| 方案 | 安全性 | 易用性 | 实现难度 | 服务端改动 |
|------|-------|-------|---------|-----------|
| **房间密码（选择）** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ 无 |
| Signal 协议 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 需要 |
| PGP 公钥交换 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ✅ 需要 |
| 中心化加密 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ✅ 需要 |

**我们方案的优势**：

✅ **安全性**：
- 真正的端对端加密
- 服务器无法解密
- 抵抗服务器攻击

✅ **易用性**：
- 就像设置 WiFi 密码一样简单
- 支持 URL 分享、QR 码
- 密码自动保存

✅ **实现成本**：
- 服务端几乎零改动
- 主要工作在客户端
- 8-10 周完成

✅ **性能**：
- Web Workers 异步处理
- UI 主线程不阻塞
- 移动端流畅运行

✅ **兼容性**：
- 向后兼容现有房间
- 支持逐步迁移
- 所有功能完整支持

### Q11: 错误的密码能进入房间吗？用户会看到什么？

**答：可以连接，但无法看到内容。密码通过"解密测试"验证。**

**关键理解**：

```
服务端层面：
- ✅ 任何人都可以连接到房间的 WebSocket
- ✅ 服务器不验证密码（因为服务器不知道密码）
- ✅ 服务器只转发密文

客户端层面：
- ✅ 通过尝试解密来验证密码
- ❌ 密码错误 = 解密失败 = 无法看到内容
- ✅ 密码正确 = 解密成功 = 正常使用
```

**详细流程**：

**1️⃣ 输入密码阶段（推荐方式）**

```javascript
用户尝试加入房间
   ↓
系统提示输入密码
   ↓
用户输入密码（正确或错误）
   ↓
客户端获取房间的一条加密消息
   ↓
尝试用输入的密码解密
   ↓
┌─────────────────────────────────────┐
│  密码正确？                          │
├─────────────────────────────────────┤
│  ✅ YES: 解密成功                    │
│    → 保存密码到 IndexedDB           │
│    → 进入房间                        │
│    → 显示所有解密后的消息            │
│                                     │
│  ❌ NO: 解密失败（AES-GCM 抛出异常） │
│    → 显示"密码错误"提示              │
│    → 要求重新输入                    │
│    → 不允许进入房间                  │
└─────────────────────────────────────┘
```

**界面示例（密码错误）**：

```
┌────────────────────────────────────┐
│  ❌ Incorrect Password             │
├────────────────────────────────────┤
│                                    │
│  The password you entered is       │
│  incorrect. Please try again.      │
│                                    │
│  Attempts: 2/∞                     │
│                                    │
│  Password:                         │
│  [____________________]            │
│                                    │
│  [Try Again] [Cancel]              │
│                                    │
│  💡 Tips:                          │
│  • Ask the room creator            │
│  • Check for typos                 │
│  • Password is case-sensitive      │
│                                    │
└────────────────────────────────────┘
```

**2️⃣ 如果用户绕过密码验证（理论上）**

虽然正常流程会阻止用户，但如果有人修改客户端代码绕过验证：

```javascript
// 假设用户强行进入房间（没有正确密码）

// 场景 A: 完全没有密钥
┌────────────────────────────────────────────┐
│  Room: Secret Chat                         │
├────────────────────────────────────────────┤
│                                            │
│  ⚠️ You don't have the encryption key     │
│     for this room.                         │
│                                            │
│  🔒 [10:30] Alice: [🔐 Encrypted - No Key] │
│  🔒 [10:31] Bob: [🔐 Encrypted - No Key]   │
│  🔒 [10:32] Carol: [🔐 Encrypted - No Key] │
│                                            │
│  [Request Access] [Enter Password]         │
└────────────────────────────────────────────┘

// 场景 B: 有错误的密钥
┌────────────────────────────────────────────┐
│  Room: Secret Chat                         │
├────────────────────────────────────────────┤
│                                            │
│  🔒 [10:30] Alice: [🔐 Decryption Failed]  │
│  🔒 [10:31] Bob: [🔐 Decryption Failed]    │
│  🔒 [10:32] Carol: [🔐 Decryption Failed]  │
│                                            │
│  ⚠️ Unable to decrypt messages.            │
│     Your password may be incorrect.        │
│                                            │
│  [Change Password] [Leave Room]            │
└────────────────────────────────────────────┘

// 用户尝试发送消息
┌────────────────────────────────────┐
│  ❌ Cannot Send Message            │
├────────────────────────────────────┤
│                                    │
│  You need the correct password     │
│  to send encrypted messages.       │
│                                    │
│  [Enter Password]                  │
│                                    │
└────────────────────────────────────┘
```

**3️⃣ 技术验证机制**

```javascript
// 接收到加密消息时的处理
ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  
  if (data.message && data.message.startsWith("ENCRYPTED:")) {
    const encryptedData = JSON.parse(data.message.substring(10));
    const roomKey = await keyManager.getRoomKey(currentRoomId);
    
    if (!roomKey) {
      // 情况 1：完全没有密钥
      displayMessage({
        ...data,
        message: "[🔐 Encrypted message - No key available]",
        encrypted: true,
        cannotDecrypt: true
      });
      
      // 显示提示
      showEncryptionWarning("You need to enter the room password to read messages.");
      return;
    }
    
    try {
      // 情况 2：尝试解密
      const plaintext = await CryptoUtils.decryptMessage(encryptedData, roomKey);
      
      // 解密成功
      displayMessage({
        ...data,
        message: plaintext,
        decrypted: true
      });
    } catch (error) {
      // 情况 3：解密失败（密钥错误）
      console.error("Decryption failed:", error);
      
      displayMessage({
        ...data,
        message: "[🔐 Decryption failed - Incorrect password?]",
        decryptionFailed: true
      });
      
      // 提示用户密码可能错误
      showEncryptionWarning(
        "Unable to decrypt messages. Your password may be incorrect. " +
        "Click here to update your password."
      );
    }
  }
};

// 发送消息时的验证
async function sendMessage(plaintext) {
  const roomKey = await keyManager.getRoomKey(currentRoomId);
  
  if (!roomKey) {
    // 没有密钥，阻止发送
    alert("❌ Cannot send message: Room password required");
    showPasswordPrompt();
    return;
  }
  
  try {
    // 加密消息
    const encrypted = await CryptoUtils.encryptMessage(plaintext, roomKey);
    
    // 发送
    ws.send(JSON.stringify({
      message: `ENCRYPTED:${JSON.stringify(encrypted)}`,
      messageId: crypto.randomUUID(),
      encryptionType: "e2ee-aes256-gcm"
    }));
  } catch (error) {
    alert("❌ Encryption failed: " + error.message);
  }
}
```

**4️⃣ 为什么这样设计？**

**优势**：
- ✅ **真正的零信任**：服务器完全不参与密码验证
- ✅ **服务器无法阻止访问**：没有中心化控制
- ✅ **隐私保护**：服务器不知道谁有正确的密码
- ✅ **简化服务端**：不需要密码验证逻辑

**权衡**：
- ⚠️ 用户可以"连接"到房间，但看不到内容（不是真正的"进入"）
- ⚠️ 密码验证在客户端，理论上可以被绕过（但无意义，因为还是看不到内容）
- ✅ 但这正是端对端加密的精髓：**内容保护，而非访问控制**

**对比传统方案**：

| 传统方案（服务端验证） | E2EE 方案（客户端验证） |
|---------------------|----------------------|
| 服务器存储密码哈希 | 服务器不知道密码 |
| 服务器决定谁能进入 | 客户端解密决定能否阅读 |
| 密码错误无法连接 | 密码错误无法解密 |
| 中心化访问控制 | 去中心化内容保护 |
| 服务器被攻破=密码泄露 | 服务器被攻破=仍然安全 |

**5️⃣ 实际用户体验**

```
✅ 正常用户（有正确密码）：
1. 输入密码
2. 密码验证成功
3. 进入房间
4. 看到所有解密的消息
5. 可以正常聊天

❌ 恶意用户（没有密码）：
1. 尝试各种密码
2. 全部验证失败
3. 无法进入房间
4. 即使绕过验证，也只看到乱码
5. 无法发送有效消息（其他人也解密不了）

⚠️ 粗心用户（忘记密码）：
1. 输入错误密码
2. 验证失败
3. 看到友好提示
4. 可以重试或请求帮助
5. 找回密码后正常使用
```

**总结**：
- 🔑 **密码是看懂内容的钥匙**，而不是进入房间的门禁卡
- 🔒 **错误的密码** = 能"看到"房间，但全是乱码
- ✅ **正确的密码** = 一切正常
- 🛡️ **服务器永远不知道** 谁有正确的密码
