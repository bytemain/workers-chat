/**
 * E2EE Key Manager
 * Manages encryption keys and passwords on client side
 * Uses IndexedDB for persistent storage, supports cross-session access
 */

import CryptoUtils from './crypto-utils.js';

/**
 * Key Manager
 * Manages room passwords, derived key cache, user key pairs, etc.
 */
export class KeyManager {
  constructor() {
    this.dbName = 'ChatKeysDB';
    this.dbVersion = 1;
    this.db = null;

    // Memory cache (performance optimization)
    this.passwordCache = new Map(); // roomId -> password
    this.keyCache = new Map(); // roomId -> {key, timestamp}
    this.keyCacheMaxAge = 5 * 60 * 1000; // 5 minutes expiry
  }

  /**
   * Initialize IndexedDB
   * Must be called before using other methods
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this.db) {
      return; // Already initialized
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ KeyManager initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Room password storage
        if (!db.objectStoreNames.contains('roomPasswords')) {
          const passwordStore = db.createObjectStore('roomPasswords', {
            keyPath: 'roomId',
          });
          passwordStore.createIndex('createdAt', 'createdAt', {
            unique: false,
          });
          console.log('📦 Created roomPasswords object store');
        }

        // Room key cache (optional, for performance optimization)
        if (!db.objectStoreNames.contains('roomKeys')) {
          const keyStore = db.createObjectStore('roomKeys', {
            keyPath: 'roomId',
          });
          keyStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('📦 Created roomKeys object store');
        }

        // User key pair storage (for advanced key exchange)
        if (!db.objectStoreNames.contains('userKeyPairs')) {
          const keyPairStore = db.createObjectStore('userKeyPairs', {
            keyPath: 'userId',
          });
          console.log('📦 Created userKeyPairs object store');
        }
      };
    });
  }

  /**
   * Save room password
   *
   * @param {string} roomId - Room ID
   * @param {string} password - User entered password
   * @returns {Promise<void>}
   */
  async saveRoomPassword(roomId, password) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomPasswords', 'readwrite');
    const store = tx.objectStore('roomPasswords');

    await store.put({
      roomId,
      password: password, // Store plaintext password (for user experience)
      createdAt: Date.now(),
    });

    // Also cache in memory
    this.passwordCache.set(roomId, password);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`🔑 Saved password for room ${roomId}`);
        resolve();
      };
      tx.onerror = () => {
        console.error('Failed to save password:', tx.error);
        reject(tx.error);
      };
    });
  }

  /**
   * Get room password
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<string|null>} Password or null (if not found)
   */
  async getRoomPassword(roomId) {
    // Check memory cache first
    if (this.passwordCache.has(roomId)) {
      return this.passwordCache.get(roomId);
    }

    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    // Read from database
    const tx = this.db.transaction('roomPasswords', 'readonly');
    const store = tx.objectStore('roomPasswords');
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
      request.onerror = () => {
        console.error('Failed to get password:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Delete room password
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<void>}
   */
  async deleteRoomPassword(roomId) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomPasswords', 'readwrite');
    const store = tx.objectStore('roomPasswords');
    await store.delete(roomId);

    // Clear memory cache
    this.passwordCache.delete(roomId);
    this.keyCache.delete(roomId);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`🗑️ Deleted password for room ${roomId}`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get all rooms with saved passwords
   *
   * @returns {Promise<Array<{roomId: string, createdAt: number}>>}
   */
  async listRooms() {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomPasswords', 'readonly');
    const store = tx.objectStore('roomPasswords');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const rooms = request.result.map((r) => ({
          roomId: r.roomId,
          createdAt: r.createdAt,
        }));
        resolve(rooms);
      };
      request.onerror = () => reject(request.error);
    });
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
   * Store room key (advanced mode, directly store derived key)
   *
   * @param {string} roomId - Room ID
   * @param {CryptoKey} key - Encryption key
   * @returns {Promise<void>}
   */
  async saveRoomKey(roomId, key) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const exported = await CryptoUtils.exportKey(key);
    const tx = this.db.transaction('roomKeys', 'readwrite');
    const store = tx.objectStore('roomKeys');

    await store.put({
      roomId,
      key: exported,
      createdAt: Date.now(),
    });

    // Also cache in memory
    this.keyCache.set(roomId, {
      key: key,
      timestamp: Date.now(),
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`🔐 Saved key for room ${roomId}`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get stored room key
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<CryptoKey|null>}
   */
  async getStoredRoomKey(roomId) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomKeys', 'readonly');
    const store = tx.objectStore('roomKeys');
    const request = store.get(roomId);

    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        if (request.result) {
          const key = await CryptoUtils.importKey(request.result.key);
          // Cache in memory
          this.keyCache.set(roomId, {
            key: key,
            timestamp: Date.now(),
          });
          resolve(key);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if room key exists
   *
   * @param {string} roomId - Room ID
   * @returns {Promise<boolean>}
   */
  async hasRoomKey(roomId) {
    // Check memory cache
    if (this.keyCache.has(roomId)) {
      const cached = this.keyCache.get(roomId);
      if (Date.now() - cached.timestamp < this.keyCacheMaxAge) {
        return true;
      }
    }

    // Check password storage
    const password = await this.getRoomPassword(roomId);
    if (password) {
      return true;
    }

    // Check key storage
    const key = await this.getStoredRoomKey(roomId);
    return key !== null;
  }

  /**
   * Save user key pair (for advanced key exchange)
   *
   * @param {string} userId - User ID
   * @param {CryptoKeyPair} keyPair - RSA key pair
   * @returns {Promise<void>}
   */
  async saveUserKeyPair(userId, keyPair) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    // Export keys
    const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey(
      'pkcs8',
      keyPair.privateKey,
    );

    const tx = this.db.transaction('userKeyPairs', 'readwrite');
    const store = tx.objectStore('userKeyPairs');

    await store.put({
      userId,
      publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKey))),
      privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKey))),
      createdAt: Date.now(),
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`🔐 Saved key pair for user ${userId}`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get user key pair
   *
   * @param {string} userId - User ID
   * @returns {Promise<CryptoKeyPair|null>}
   */
  async getUserKeyPair(userId) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('userKeyPairs', 'readonly');
    const store = tx.objectStore('userKeyPairs');
    const request = store.get(userId);

    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        if (request.result) {
          const { publicKey: pubKeyB64, privateKey: privKeyB64 } =
            request.result;

          // Import public key
          const pubKeyData = Uint8Array.from(atob(pubKeyB64), (c) =>
            c.charCodeAt(0),
          );
          const publicKey = await crypto.subtle.importKey(
            'spki',
            pubKeyData,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt'],
          );

          // Import private key
          const privKeyData = Uint8Array.from(atob(privKeyB64), (c) =>
            c.charCodeAt(0),
          );
          const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            privKeyData,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt'],
          );

          resolve({ publicKey, privateKey });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
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
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction(
      ['roomPasswords', 'roomKeys', 'userKeyPairs'],
      'readwrite',
    );

    const passwordStore = tx.objectStore('roomPasswords');
    const keyStore = tx.objectStore('roomKeys');
    const keyPairStore = tx.objectStore('userKeyPairs');

    await passwordStore.clear();
    await keyStore.clear();
    await keyPairStore.clear();

    // Clear memory cache
    this.passwordCache.clear();
    this.keyCache.clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.warn('⚠️ Cleared all encryption keys and passwords');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Export all passwords (for backup)
   *
   * @returns {Promise<Array<{roomId: string, password: string}>>}
   */
  async exportPasswords() {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomPasswords', 'readonly');
    const store = tx.objectStore('roomPasswords');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const passwords = request.result.map((r) => ({
          roomId: r.roomId,
          password: r.password,
        }));
        resolve(passwords);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Import passwords (restore from backup)
   *
   * @param {Array<{roomId: string, password: string}>} passwords - Password list
   * @returns {Promise<number>} Number of successfully imported passwords
   */
  async importPasswords(passwords) {
    if (!this.db) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    const tx = this.db.transaction('roomPasswords', 'readwrite');
    const store = tx.objectStore('roomPasswords');

    let imported = 0;
    for (const { roomId, password } of passwords) {
      try {
        await store.put({
          roomId,
          password,
          createdAt: Date.now(),
        });
        imported++;
      } catch (error) {
        console.error(`Failed to import password for ${roomId}:`, error);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`✅ Imported ${imported} passwords`);
        resolve(imported);
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Create global singleton instance
export const keyManager = new KeyManager();
