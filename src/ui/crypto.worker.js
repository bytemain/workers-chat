/**
 * E2EE Crypto Worker
 * Performs encryption/decryption operations in a separate thread to avoid blocking the main thread
 * Supports multiple encryption task types
 */

import { CryptoUtils } from '../common/crypto-utils.js';

// Message handler in Worker
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

    // Return success result
    self.postMessage({
      taskId,
      success: true,
      result,
    });
  } catch (error) {
    // Return error
    self.postMessage({
      taskId,
      success: false,
      error: error.message,
    });
  }
};

// ===== Worker Helper Functions =====
// These functions wrap CryptoUtils methods to handle key import/export for Worker communication

/**
 * Derive key from password (executed in Worker to avoid blocking UI)
 * Uses CryptoUtils and exports key in transferable format
 */
async function deriveKeyFromPassword(password, roomId, iterations) {
  const key = await CryptoUtils.deriveKeyFromPassword(
    password,
    roomId,
    iterations,
  );

  // Export to transferable format
  const exported = await crypto.subtle.exportKey('raw', key);
  return { keyData: Array.from(new Uint8Array(exported)) };
}

/**
 * Encrypt message using CryptoUtils
 * Converts CryptoKey to raw format for Worker communication
 */
async function encryptMessage(plaintext, keyData) {
  const key = await CryptoUtils.importKeyFromRaw(keyData);
  return await CryptoUtils.encryptMessage(plaintext, key);
}

/**
 * Decrypt message using CryptoUtils
 */
async function decryptMessage(encryptedData, keyData) {
  const key = await CryptoUtils.importKeyFromRaw(keyData);
  return await CryptoUtils.decryptMessage(encryptedData, key);
}

/**
 * Batch decrypt (performance optimized)
 * Decrypts multiple messages in one Worker task
 */
async function batchDecrypt(messages, keyData) {
  const key = await CryptoUtils.importKeyFromRaw(keyData);
  const results = [];

  for (const msg of messages) {
    try {
      const decrypted = await CryptoUtils.decryptMessage(msg, key);
      results.push({ success: true, plaintext: decrypted });
    } catch (error) {
      results.push({ success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Encrypt file chunk
 * Uses custom IV generation to ensure unique IV per chunk
 */
async function encryptFileChunk(chunkData, keyData, chunkIndex) {
  const key = await CryptoUtils.importKeyFromRaw(keyData);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Include chunk index in IV to ensure unique IV for each chunk
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
 * Decrypt file chunk
 */
async function decryptFileChunk(encryptedChunk, keyData, chunkIndex) {
  const key = await CryptoUtils.importKeyFromRaw(keyData);
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
 * Calculate data hash using CryptoUtils
 */
async function hashData(data) {
  return await CryptoUtils.hash(data);
}

console.log('✅ Crypto Worker initialized');
