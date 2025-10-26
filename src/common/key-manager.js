/**
 * E2EE Key Manager
 * Manages encryption keys and passwords on client side
 * Uses LocalStorage for persistent storage, supports cross-session access
 */

import CryptoUtils from './crypto-utils.js';

/**
 * Key Manager
 * Manages room passwords, derived key cache, user key pairs, etc.
 */
export class KeyManager {
  constructor() {
    this.storagePrefix = 'chatKeys_';

    // Memory cache (performance optimization)
    this.keyCache = new Map(); // roomId -> {key, timestamp}
    this.keyCacheMaxAge = 5 * 60 * 1000; // 5 minutes expiry
  }

  /**
   * Save room password
   *
   * @param {string} roomId - Room ID
   * @param {string} password - User entered password
   * @returns {Promise<void>}
   */
  async saveRoomPassword(roomId, password) {
    const key = `${this.storagePrefix}password_${roomId}`;
    const data = {
      roomId,
      password,
      createdAt: Date.now(),
    };

    try {
      localStorage.setItem(key, JSON.stringify(data));
      console.log(`🔑 Saved password for room ${roomId}`);
    } catch (error) {
      console.error('Failed to save password:', error);
      throw error;
    }
  }

  /**
   * Get room password
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<string|null>} Password or null (if not found)
   */
  async getRoomPassword(roomId) {
    const key = `${this.storagePrefix}password_${roomId}`;

    try {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.password;
      }
      return null;
    } catch (error) {
      console.error('Failed to get password:', error);
      return null;
    }
  }

  /**
   * Delete room password
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<void>}
   */
  async deleteRoomPassword(roomId) {
    const key = `${this.storagePrefix}password_${roomId}`;

    try {
      localStorage.removeItem(key);
      // Clear memory cache
      this.keyCache.delete(roomId);
      console.log(`🗑️ Deleted password for room ${roomId}`);
    } catch (error) {
      console.error('Failed to delete password:', error);
      throw error;
    }
  }

  /**
   * Get all rooms with saved passwords
   *
   * @returns {Promise<Array<{roomId: string, createdAt: number}>>}
   */
  async listRooms() {
    const rooms = [];
    const prefix = `${this.storagePrefix}password_`;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const data = localStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            rooms.push({
              roomId: parsed.roomId,
              createdAt: parsed.createdAt,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to list rooms:', error);
    }

    return rooms;
  }

  /**
   * Get or derive room key from password (with cache)
   *
   * @param {string} roomId - Room ID
   * @param {string} password - Room password (optional, if not provided will read from storage)
   * @returns {Promise<CryptoKey|null>} Encryption key or null
   */
  async getRoomKey(roomId, password = null) {
    // 1. Check memory cache
    const cached = this.keyCache.get(roomId);
    if (cached && Date.now() - cached.timestamp < this.keyCacheMaxAge) {
      console.log(`📦 Key cache hit for room ${roomId}`);
      return cached.key;
    }

    // 2. Get password
    if (!password) {
      password = await this.getRoomPassword(roomId);
    }

    if (!password) {
      return null;
    }

    // 3. Derive key from password
    console.log(`🔑 Deriving key for room ${roomId}...`);
    const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

    // 4. Cache key (in memory, avoid frequent derivation)
    this.keyCache.set(roomId, {
      key: key,
      timestamp: Date.now(),
    });

    return key;
  }

  /**
   * Verify if room password is correct
   *
   * @param {string} roomId - Room ID
   * @param {string} password - Password to verify
   * @param {string} verificationData - Encrypted verification data for testing
   * @returns {Promise<{success: boolean, key?: CryptoKey, error?: string}>}
   */
  async verifyRoomPassword(roomId, password, verificationData) {
    try {
      // Use CryptoUtils to verify password
      const result = await CryptoUtils.verifyPassword(
        password,
        roomId,
        verificationData,
      );

      if (result.success) {
        // Password correct, save password and cache key
        await this.saveRoomPassword(roomId, password);
        const key = await this.getRoomKey(roomId, password);
        return { success: true, key };
      } else {
        return result;
      }
    } catch (error) {
      console.error('Password verification failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up expired key cache (memory cache)
   */
  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [roomId, cached] of this.keyCache) {
      if (now - cached.timestamp > this.keyCacheMaxAge) {
        this.keyCache.delete(roomId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired key cache entries`);
    }
  }

  /**
   * Clear all stored keys and passwords
   * ⚠️ Dangerous operation, will prevent decryption of historical messages
   *
   * @returns {Promise<void>}
   */
  async clearAll() {
    const prefix = this.storagePrefix;
    const keysToRemove = [];

    try {
      // Find all keys with our prefix
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      // Remove them
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      // Clear memory cache
      this.keyCache.clear();

      console.warn(
        `⚠️ Cleared all encryption keys and passwords (${keysToRemove.length} items)`,
      );
    } catch (error) {
      console.error('Failed to clear all:', error);
      throw error;
    }
  }

  /**
   * Export all passwords (for backup)
   *
   * @returns {Promise<Array<{roomId: string, password: string}>>}
   */
  async exportPasswords() {
    const passwords = [];
    const prefix = `${this.storagePrefix}password_`;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const data = localStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            passwords.push({
              roomId: parsed.roomId,
              password: parsed.password,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to export passwords:', error);
    }

    return passwords;
  }

  /**
   * Import passwords (restore from backup)
   *
   * @param {Array<{roomId: string, password: string}>} passwords - Password list
   * @returns {Promise<number>} Number of successfully imported passwords
   */
  async importPasswords(passwords) {
    let imported = 0;

    for (const { roomId, password } of passwords) {
      try {
        await this.saveRoomPassword(roomId, password);
        imported++;
      } catch (error) {
        console.error(`Failed to import password for ${roomId}:`, error);
      }
    }

    console.log(`✅ Imported ${imported} passwords`);
    return imported;
  }
}

// Create global singleton instance
export const keyManager = new KeyManager();
