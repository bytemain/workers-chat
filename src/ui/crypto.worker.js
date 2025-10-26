/**
 * E2EE Crypto Worker
 * 在独立线程中执行加密/解密操作，避免阻塞主线程
 * 支持多种加密任务类型
 */

// Worker 中的消息处理
self.onmessage = async (event) => {
  const { taskId, type, data } = event.data;

  try {
    let result;

    switch (type) {
      case 'encrypt':
        result = await encryptMessage(data.plaintext, data.keyData);
        break;

      case 'decrypt':
        result = await decryptMessage(data.encrypted, data.keyData);
        break;

      case 'derive-key':
        result = await deriveKeyFromPassword(
          data.password,
          data.roomId,
          data.iterations || 100000,
        );
        break;

      case 'encrypt-file-chunk':
        result = await encryptFileChunk(
          data.chunk,
          data.keyData,
          data.chunkIndex,
        );
        break;

      case 'decrypt-file-chunk':
        result = await decryptFileChunk(
          data.encryptedChunk,
          data.keyData,
          data.chunkIndex,
        );
        break;

      case 'batch-decrypt':
        result = await batchDecrypt(data.messages, data.keyData);
        break;

      case 'hash':
        result = await hashData(data.data);
        break;

      default:
        throw new Error(`Unknown task type: ${type}`);
    }

    // 返回成功结果
    self.postMessage({
      taskId,
      success: true,
      result,
    });
  } catch (error) {
    // 返回错误
    self.postMessage({
      taskId,
      success: false,
      error: error.message,
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
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  const salt = encoder.encode(roomId);

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  // 导出为可传递的格式
  const exported = await crypto.subtle.exportKey('raw', derivedKey);
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
    { name: 'AES-GCM', iv },
    key,
    encodedText,
  );

  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    version: '1.0',
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
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
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
    { name: 'AES-GCM', iv: ivWithIndex },
    key,
    new Uint8Array(chunkData),
  );

  return {
    iv: Array.from(ivWithIndex),
    ciphertext: Array.from(new Uint8Array(encrypted)),
    chunkIndex,
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
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return Array.from(new Uint8Array(decrypted));
}

/**
 * 导入密钥
 */
async function importKey(keyData) {
  const keyArray = new Uint8Array(keyData);
  return await crypto.subtle.importKey(
    'raw',
    keyArray,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 计算数据哈希
 */
async function hashData(data) {
  const encoder = new TextEncoder();
  const dataBuffer =
    typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);

  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

console.log('✅ Crypto Worker initialized');
