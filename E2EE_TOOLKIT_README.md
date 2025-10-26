# E2EE 加密工具包 (Encryption Toolkit)

端对端加密工具库，为 Workers Chat 提供完整的客户端加密支持。

## 📦 包含组件

### 1. **CryptoUtils** (`src/common/crypto-utils.js`)
核心加密工具类，提供：
- ✅ AES-256-GCM 消息加密/解密
- ✅ PBKDF2 密钥派生（从密码生成密钥）
- ✅ 密码验证机制
- ✅ 密钥导入/导出
- ✅ RSA 密钥对生成（用于高级密钥交换）

### 2. **KeyManager** (`src/common/key-manager.js`)
密钥管理器，负责：
- ✅ 使用 IndexedDB 持久化存储密码和密钥
- ✅ 内存缓存优化（避免重复派生）
- ✅ 密码验证
- ✅ 密钥备份/恢复

### 3. **CryptoWorkerPool** (`src/ui/crypto-worker-pool.js`)
Web Worker 线程池，实现：
- ✅ 异步加密处理（不阻塞 UI）
- ✅ 负载均衡
- ✅ 任务队列管理
- ✅ 批量处理优化

### 4. **CryptoWorker** (`src/ui/crypto-worker.js`)
Worker 线程实现，支持：
- ✅ 消息加密/解密
- ✅ 密钥派生
- ✅ 文件分块加密
- ✅ 批量解密

### 5. **FileCrypto** (`src/common/file-crypto.js`)
文件加密工具，提供：
- ✅ 流式文件加密（支持大文件）
- ✅ 分块处理（2MB per chunk）
- ✅ 进度回调
- ✅ 上传/下载集成

## 🚀 快速开始

### 安装依赖

```bash
# 无需额外依赖，使用浏览器原生 Web Crypto API
```

### 基本用法

#### 1. 加密/解密消息

```javascript
import CryptoUtils from './src/common/crypto-utils.js';

// 从密码派生密钥
const password = 'myRoomPassword123';
const roomId = 'room-abc';
const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

// 加密消息
const plaintext = 'Hello, this is a secret message!';
const encrypted = await CryptoUtils.encryptMessage(plaintext, key);

// 发送到服务器
const encryptedMessage = CryptoUtils.formatEncryptedMessage(encrypted);
// encryptedMessage = "ENCRYPTED:{iv:[...], ciphertext:[...], version:'1.0'}"

// 解密消息
const parsed = CryptoUtils.parseEncryptedMessage(encryptedMessage);
const decrypted = await CryptoUtils.decryptMessage(parsed, key);
console.log(decrypted); // "Hello, this is a secret message!"
```

#### 2. 使用 KeyManager

```javascript
import { KeyManager } from './src/common/key-manager.js';

// 初始化
const keyManager = new KeyManager();
await keyManager.init();

// 保存密码
await keyManager.saveRoomPassword('room-abc', 'myPassword123');

// 获取密钥（自动派生）
const key = await keyManager.getRoomKey('room-abc');

// 验证密码
const result = await keyManager.verifyRoomPassword(
  'room-abc',
  'myPassword123',
  verificationData
);
if (result.success) {
  console.log('Password correct!');
}
```

#### 3. 使用 Worker 池（异步加密）

```javascript
import { getCryptoPool } from './src/ui/crypto-worker-pool.js';

// 获取 Worker 池实例
const cryptoPool = getCryptoPool();

// 异步派生密钥（不阻塞 UI）
const keyResult = await cryptoPool.submitTask('derive-key', {
  password: 'myPassword',
  roomId: 'room-abc',
  iterations: 100000
});

// 异步加密消息
const encrypted = await cryptoPool.submitTask('encrypt', {
  plaintext: 'Hello!',
  key: keyResult.keyData
});

// 批量解密
const messages = [/* 加密消息列表 */];
const results = await cryptoPool.submitTask('batch-decrypt', {
  messages: messages,
  key: keyResult.keyData
});
```

#### 4. 加密文件

```javascript
import FileCrypto from './src/common/file-crypto.js';
import { keyManager } from './src/common/key-manager.js';

// 获取文件
const file = document.querySelector('input[type=file]').files[0];

// 获取密钥
const key = await keyManager.getRoomKey('room-abc');

// 加密文件（带进度）
const encryptedBlob = await FileCrypto.encryptFileV2(file, key, (progress, stage) => {
  console.log(`${stage}: ${progress}%`);
});

// 上传到服务器
const formData = new FormData();
formData.append('file', encryptedBlob, `${file.name}.enc`);
await fetch('/api/room/abc/upload', { method: 'POST', body: formData });

// 下载并解密
const { blob, metadata } = await FileCrypto.downloadAndDecrypt(
  '/api/files/encrypted-file.enc',
  key,
  (progress, stage) => console.log(`${stage}: ${progress}%`)
);

// 显示文件
const url = URL.createObjectURL(blob);
window.open(url);
```

## 🔒 安全特性

### 核心原则：客户端加密，服务端盲传

- ✅ **零信任架构**：服务器只存储和转发密文，无法解密
- ✅ **密钥不离开客户端**：所有密钥派生和加解密在浏览器中完成
- ✅ **密码验证**：通过"解密测试"验证密码，无需服务器参与
- ✅ **认证加密**：使用 AES-256-GCM，内置完整性验证
- ✅ **唯一 IV**：每条消息/文件分块使用唯一的初始化向量

### 加密算法

- **对称加密**：AES-256-GCM
- **密钥派生**：PBKDF2-SHA256（100,000 次迭代）
- **密钥交换**：RSA-OAEP-2048（可选）
- **哈希**：SHA-256

## 📊 性能指标

基于现代浏览器（Chrome/Firefox）的典型性能：

| 操作 | 平均时间 | 目标 |
|------|---------|------|
| 密钥派生 (PBKDF2) | ~80ms | < 100ms |
| 消息加密 | ~2ms | < 5ms |
| 消息解密 | ~2ms | < 5ms |
| 100条消息批量解密 | ~300ms | < 500ms |
| 10MB 文件加密 | ~1.5s | < 2s |

*注意：性能会根据设备和浏览器有所不同*

## 🧪 测试

打开测试页面运行完整测试套件：

```bash
# 启动开发服务器
npm run dev

# 在浏览器中打开
open http://localhost:8787/test/crypto-test.html
```

测试包括：
- ✅ 消息加密/解密正确性
- ✅ 密钥派生一致性
- ✅ 密码验证机制
- ✅ KeyManager IndexedDB 操作
- ✅ 性能基准测试

## 📖 API 文档

### CryptoUtils

#### `deriveKeyFromPassword(password, roomId, iterations = 100000)`
从密码派生 AES-256 密钥。

**参数：**
- `password` (string): 用户密码
- `roomId` (string): 房间 ID（作为 salt）
- `iterations` (number): PBKDF2 迭代次数

**返回：** `Promise<CryptoKey>`

#### `encryptMessage(plaintext, key)`
加密文本消息。

**参数：**
- `plaintext` (string): 明文消息
- `key` (CryptoKey): 加密密钥

**返回：** `Promise<{iv: Array, ciphertext: Array, version: string}>`

#### `decryptMessage(encryptedData, key)`
解密文本消息。

**参数：**
- `encryptedData` (object): 加密数据对象
- `key` (CryptoKey): 解密密钥

**返回：** `Promise<string>` - 明文消息

**抛出：** 解密失败（密钥错误或数据损坏）

#### `generateVerificationData(roomId, password)`
生成密码验证数据。

**返回：** `Promise<string>` - 加密的验证数据

#### `verifyPassword(password, roomId, verificationData)`
验证密码是否正确。

**返回：** `Promise<{success: boolean, error?: string}>`

### KeyManager

#### `init()`
初始化 IndexedDB。必须在使用前调用。

**返回：** `Promise<void>`

#### `saveRoomPassword(roomId, password)`
保存房间密码。

**返回：** `Promise<void>`

#### `getRoomPassword(roomId)`
获取房间密码。

**返回：** `Promise<string|null>`

#### `getRoomKey(roomId, password?)`
获取或派生房间密钥（带缓存）。

**返回：** `Promise<CryptoKey|null>`

#### `verifyRoomPassword(roomId, password, verificationData)`
验证房间密码并保存。

**返回：** `Promise<{success: boolean, key?: CryptoKey, error?: string}>`

### CryptoWorkerPool

#### `submitTask(type, data)`
提交任务到 Worker 池。

**任务类型：**
- `'encrypt'`: 加密消息
- `'decrypt'`: 解密消息
- `'derive-key'`: 派生密钥
- `'encrypt-file-chunk'`: 加密文件分块
- `'decrypt-file-chunk'`: 解密文件分块
- `'batch-decrypt'`: 批量解密

**返回：** `Promise<任务结果>`

### FileCrypto

#### `encryptFileV2(file, key, onProgress)`
加密文件（流式处理）。

**参数：**
- `file` (File): 要加密的文件
- `key` (CryptoKey): 加密密钥
- `onProgress` (function): 进度回调 `(progress: 0-100, stage: string) => void`

**返回：** `Promise<Blob>` - 加密文件

#### `decryptFileV2(encryptedBlob, key, onProgress)`
解密文件。

**返回：** `Promise<{blob: Blob, metadata: object}>`

## 🔧 配置

### 调整性能参数

```javascript
// 修改 PBKDF2 迭代次数（安全性 vs 性能）
CryptoUtils.PBKDF2_ITERATIONS = 50000; // 默认 100000

// 修改文件分块大小
FileCrypto.CHUNK_SIZE = 5 * 1024 * 1024; // 5MB，默认 2MB

// 修改密钥缓存过期时间
keyManager.keyCacheMaxAge = 10 * 60 * 1000; // 10分钟，默认 5分钟
```

## 🐛 已知限制

1. **浏览器兼容性**
   - 需要现代浏览器（Chrome 60+, Firefox 57+, Safari 11+）
   - 需要 Web Crypto API 支持
   - 需要 IndexedDB 支持

2. **性能限制**
   - PBKDF2 在低端设备上可能较慢（~300ms）
   - 大文件加密需要足够的内存

3. **安全考虑**
   - 密码强度完全依赖用户
   - 浏览器扩展可能访问内存中的密钥
   - 物理访问设备可以提取 IndexedDB 数据

## 🛠️ 开发指南

### 添加新的加密算法

```javascript
// 在 CryptoUtils 中添加新方法
static async encryptWithChaCha20(plaintext, key) {
  // 实现 ChaCha20-Poly1305 加密
}
```

### 扩展 Worker 功能

```javascript
// 在 crypto-worker.js 中添加新任务类型
case 'new-task-type':
  result = await handleNewTask(data);
  break;
```

## 📝 变更日志

### v1.0.0 (2025-10-26)
- ✨ 初始版本
- ✅ 实现 CryptoUtils 核心加密功能
- ✅ 实现 KeyManager IndexedDB 存储
- ✅ 实现 CryptoWorkerPool 异步处理
- ✅ 实现 FileCrypto 文件加密
- ✅ 完整的测试套件

## 📄 许可证

MIT License - 详见项目根目录 LICENSE 文件

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请查看：
- [PRD 文档](../E2EE_PRD.md)
- [测试页面](test/crypto-test.html)
- [Copilot Instructions](../.github/copilot-instructions.md)

---

**⚠️ 安全提示**：此工具包提供客户端加密，但安全性最终取决于用户的密码强度和设备安全。请确保使用强密码并保护好设备。
