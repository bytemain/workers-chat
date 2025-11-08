/**
 * Pin Message Decryption Utilities
 * Shared utilities for decrypting pinned messages across components
 */

import { decryptMessageText } from './message-crypto.mjs';

/**
 * Decrypt an array of pinned messages
 * @param {Array} pins - Array of pin objects with message property
 * @param {CryptoKey} roomKey - Optional room encryption key (defaults to window.encryptionState.roomKey)
 * @returns {Promise<Array>} - Array of pins with decrypted messages
 */
export async function decryptPins(pins, roomKey = null) {
  if (!pins || pins.length === 0) {
    return [];
  }

  const key = roomKey || window.encryptionState?.roomKey;

  return Promise.all(
    pins.map(async (pin) => {
      try {
        const decryptedMessage = await decryptMessageText(pin.message, key);
        return { ...pin, message: decryptedMessage };
      } catch (error) {
        console.warn('Failed to decrypt pin message:', pin.messageId, error);
        // Return original message if decryption fails
        return pin;
      }
    }),
  );
}
