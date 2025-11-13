/**
 * Shared message decryption utilities
 * Used by both main chat (index.mjs) and pinned messages (pinned-messages.mjs)
 */

import CryptoUtils from '../../common/crypto-utils.js';
import { getCryptoPool } from '../crypto-worker-pool.js';
import { initCryptoCompatCheck } from '../../common/crypto-compat.js';
import { LRUCache } from './lru-cache.mjs';

// Get crypto pool instance
const cryptoPool = getCryptoPool();

// Check crypto support (async - may load polyfill)
let cryptoSupported = false;
(async () => {
  cryptoSupported = await initCryptoCompatCheck();
})();

// LRU cache for decrypted messages (max 100 entries)
const decryptionCache = new LRUCache(100);

/**
 * Try to decrypt a message if it's encrypted
 * @param {Object} data - Message data object with `message` property
 * @param {CryptoKey|null} roomKey - Current room encryption key
 * @param {boolean} isRoomEncrypted - Whether the room is encrypted
 * @returns {Promise<string>} Decrypted message or original/error message
 */
export async function tryDecryptMessage(data, roomKey, isRoomEncrypted) {
  let messageText = data.message;

  if (CryptoUtils.isEncrypted(data.message)) {
    // Check cache first
    const cached = decryptionCache.get(data.message);
    if (cached !== undefined) {
      console.log('✨ Using cached decryption');
      return cached;
    }

    // Check if crypto is supported
    if (!cryptoSupported) {
      console.warn(
        '⚠️ Received encrypted message but crypto API is not supported',
      );
      messageText = '[Encrypted message - browser not supported]';
      return messageText;
    }

    if (isRoomEncrypted && roomKey) {
      try {
        console.log('🔓 Decrypting message via worker pool...');
        const encryptedData = CryptoUtils.parseEncryptedMessage(data.message);
        if (encryptedData) {
          // Export key for worker
          const keyData = Array.from(
            new Uint8Array(await crypto.subtle.exportKey('raw', roomKey)),
          );

          // Decrypt via worker pool
          messageText = await cryptoPool.submitTask('decrypt', {
            encrypted: encryptedData,
            keyData: keyData,
          });

          console.log('✅ Message decrypted');

          // Cache the decrypted result
          decryptionCache.set(data.message, messageText);
        } else {
          console.error('❌ Failed to parse encrypted message');
          messageText = '[Encrypted message - failed to parse]';
        }
      } catch (error) {
        console.error('❌ Failed to decrypt message:', error);
        messageText = '[Encrypted message - decryption failed]';
      }
    } else {
      console.warn('⚠️ Received encrypted message but no room key available');
      messageText = '[Encrypted message]';
    }
  }

  return messageText;
}

/**
 * Decrypt a single message string (simpler version for pinned messages)
 * @param {string} message - Message text (possibly encrypted)
 * @param {CryptoKey|null} roomKey - Current room encryption key
 * @returns {Promise<string>} Decrypted message or original/error message
 */
export async function decryptMessageText(message, roomKey) {
  return tryDecryptMessage({ message }, roomKey, !!roomKey);
}

/**
 * Clear the decryption cache (call when switching rooms or room key changes)
 */
export function clearDecryptionCache() {
  decryptionCache.clear();
  console.log('🗑️ Decryption cache cleared');
}
