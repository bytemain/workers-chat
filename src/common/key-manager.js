/**
 * E2EE 密钥管理器
 * 负责在客户端管理加密密钥和密码
 * 使用 IndexedDB 持久化存储，支持跨会话访问
 */

import CryptoUtils from './crypto-utils.js';

/**
 * 密钥管理器
 * 管理房间密码、派生密钥缓存、用户密钥对等
 */
export class KeyManager {
    constructor() {
        this.dbName = 'ChatKeysDB';
        this.dbVersion = 1;
        this.db = null;

        // 内存缓存（性能优化）
        this.passwordCache = new Map(); // roomId -> password
        this.keyCache = new Map(); // roomId -> {key, timestamp}
        this.keyCacheMaxAge = 5 * 60 * 1000; // 5分钟过期
    }

    /**
     * 初始化 IndexedDB
     * 必须在使用其他方法前调用
     * 
     * @returns {Promise<void>}
     */
    async init() {
        if (this.db) {
            return; // 已初始化
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

                // 房间密码存储
                if (!db.objectStoreNames.contains('roomPasswords')) {
                    const passwordStore = db.createObjectStore('roomPasswords', { keyPath: 'roomId' });
                    passwordStore.createIndex('createdAt', 'createdAt', { unique: false });
                    console.log('📦 Created roomPasswords object store');
                }

                // 房间密钥缓存（可选，用于性能优化）
                if (!db.objectStoreNames.contains('roomKeys')) {
                    const keyStore = db.createObjectStore('roomKeys', { keyPath: 'roomId' });
                    keyStore.createIndex('createdAt', 'createdAt', { unique: false });
                    console.log('📦 Created roomKeys object store');
                }

                // 用户密钥对存储（用于高级密钥交换）
                if (!db.objectStoreNames.contains('userKeyPairs')) {
                    const keyPairStore = db.createObjectStore('userKeyPairs', { keyPath: 'userId' });
                    console.log('📦 Created userKeyPairs object store');
                }
            };
        });
    }

    /**
     * 保存房间密码
     * 
     * @param {string} roomId - 房间ID
     * @param {string} password - 用户输入的密码
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
            password: password, // 存储明文密码（为了用户体验）
            createdAt: Date.now()
        });

        // 同时缓存到内存
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
     * 获取房间密码
     * 
     * @param {string} roomId - 房间ID
     * @returns {Promise<string|null>} 密码或null（如果未找到）
     */
    async getRoomPassword(roomId) {
        // 先检查内存缓存
        if (this.passwordCache.has(roomId)) {
            return this.passwordCache.get(roomId);
        }

        if (!this.db) {
            throw new Error('KeyManager not initialized. Call init() first.');
        }

        // 从数据库读取
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
     * 删除房间密码
     * 
     * @param {string} roomId - 房间ID
     * @returns {Promise<void>}
     */
    async deleteRoomPassword(roomId) {
        if (!this.db) {
            throw new Error('KeyManager not initialized. Call init() first.');
        }

        const tx = this.db.transaction('roomPasswords', 'readwrite');
        const store = tx.objectStore('roomPasswords');
        await store.delete(roomId);

        // 清除内存缓存
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
     * 获取所有已保存密码的房间
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
                const rooms = request.result.map(r => ({
                    roomId: r.roomId,
                    createdAt: r.createdAt
                }));
                resolve(rooms);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 从密码获取或派生房间密钥（带缓存）
     * 
     * @param {string} roomId - 房间ID
     * @param {string} password - 房间密码（可选，如果不提供则从存储读取）
     * @returns {Promise<CryptoKey|null>} 加密密钥或null
     */
    async getRoomKey(roomId, password = null) {
        // 1. 检查内存缓存
        const cached = this.keyCache.get(roomId);
        if (cached && Date.now() - cached.timestamp < this.keyCacheMaxAge) {
            console.log(`📦 Key cache hit for room ${roomId}`);
            return cached.key;
        }

        // 2. 获取密码
        if (!password) {
            password = await this.getRoomPassword(roomId);
        }

        if (!password) {
            return null;
        }

        // 3. 从密码派生密钥
        console.log(`🔑 Deriving key for room ${roomId}...`);
        const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

        // 4. 缓存密钥（内存中，避免频繁派生）
        this.keyCache.set(roomId, {
            key: key,
            timestamp: Date.now()
        });

        return key;
    }

    /**
     * 验证房间密码是否正确
     * 
     * @param {string} roomId - 房间ID
     * @param {string} password - 要验证的密码
     * @param {string} verificationData - 用于测试的加密验证数据
     * @returns {Promise<{success: boolean, key?: CryptoKey, error?: string}>}
     */
    async verifyRoomPassword(roomId, password, verificationData) {
        try {
            // 使用 CryptoUtils 验证密码
            const result = await CryptoUtils.verifyPassword(password, roomId, verificationData);

            if (result.success) {
                // 密码正确，保存密码和缓存密钥
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
     * 存储房间密钥（高级方案，直接存储派生的密钥）
     * 
     * @param {string} roomId - 房间ID
     * @param {CryptoKey} key - 加密密钥
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
            createdAt: Date.now()
        });

        // 同时缓存到内存
        this.keyCache.set(roomId, {
            key: key,
            timestamp: Date.now()
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
     * 获取存储的房间密钥
     * 
     * @param {string} roomId - 房间ID
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
                    // 缓存到内存
                    this.keyCache.set(roomId, {
                        key: key,
                        timestamp: Date.now()
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
     * 检查是否有房间密钥
     * 
     * @param {string} roomId - 房间ID
     * @returns {Promise<boolean>}
     */
    async hasRoomKey(roomId) {
        // 检查内存缓存
        if (this.keyCache.has(roomId)) {
            const cached = this.keyCache.get(roomId);
            if (Date.now() - cached.timestamp < this.keyCacheMaxAge) {
                return true;
            }
        }

        // 检查密码存储
        const password = await this.getRoomPassword(roomId);
        if (password) {
            return true;
        }

        // 检查密钥存储
        const key = await this.getStoredRoomKey(roomId);
        return key !== null;
    }

    /**
     * 保存用户密钥对（用于高级密钥交换）
     * 
     * @param {string} userId - 用户ID
     * @param {CryptoKeyPair} keyPair - RSA密钥对
     * @returns {Promise<void>}
     */
    async saveUserKeyPair(userId, keyPair) {
        if (!this.db) {
            throw new Error('KeyManager not initialized. Call init() first.');
        }

        // 导出密钥
        const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
        const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

        const tx = this.db.transaction('userKeyPairs', 'readwrite');
        const store = tx.objectStore('userKeyPairs');

        await store.put({
            userId,
            publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKey))),
            privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKey))),
            createdAt: Date.now()
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
     * 获取用户密钥对
     * 
     * @param {string} userId - 用户ID
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
                    const { publicKey: pubKeyB64, privateKey: privKeyB64 } = request.result;

                    // 导入公钥
                    const pubKeyData = Uint8Array.from(atob(pubKeyB64), c => c.charCodeAt(0));
                    const publicKey = await crypto.subtle.importKey(
                        'spki',
                        pubKeyData,
                        { name: 'RSA-OAEP', hash: 'SHA-256' },
                        true,
                        ['encrypt']
                    );

                    // 导入私钥
                    const privKeyData = Uint8Array.from(atob(privKeyB64), c => c.charCodeAt(0));
                    const privateKey = await crypto.subtle.importKey(
                        'pkcs8',
                        privKeyData,
                        { name: 'RSA-OAEP', hash: 'SHA-256' },
                        true,
                        ['decrypt']
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
     * 清理过期的密钥缓存（内存缓存）
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
     * 清空所有存储的密钥和密码
     * ⚠️ 危险操作，会导致无法解密历史消息
     * 
     * @returns {Promise<void>}
     */
    async clearAll() {
        if (!this.db) {
            throw new Error('KeyManager not initialized. Call init() first.');
        }

        const tx = this.db.transaction(
            ['roomPasswords', 'roomKeys', 'userKeyPairs'],
            'readwrite'
        );

        const passwordStore = tx.objectStore('roomPasswords');
        const keyStore = tx.objectStore('roomKeys');
        const keyPairStore = tx.objectStore('userKeyPairs');

        await passwordStore.clear();
        await keyStore.clear();
        await keyPairStore.clear();

        // 清除内存缓存
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
     * 导出所有密码（用于备份）
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
                const passwords = request.result.map(r => ({
                    roomId: r.roomId,
                    password: r.password
                }));
                resolve(passwords);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 导入密码（从备份恢复）
     * 
     * @param {Array<{roomId: string, password: string}>} passwords - 密码列表
     * @returns {Promise<number>} 成功导入的数量
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
                    createdAt: Date.now()
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

// 创建全局单例实例
export const keyManager = new KeyManager();

// 默认导出
export default KeyManager;
