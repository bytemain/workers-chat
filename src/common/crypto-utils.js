/**
 * E2EE 加密工具类
 * 提供 AES-GCM 加密/解密、PBKDF2 密钥派生等功能
 * 所有操作都在客户端完成，服务器只存储和转发密文
 */

/**
 * 加密工具类
 * 使用 Web Crypto API 实现端对端加密
 */
export class CryptoUtils {
    // 加密版本，用于向后兼容
    static VERSION = '1.0';

    // PBKDF2 默认迭代次数（100,000 次，平衡安全性和性能）
    static PBKDF2_ITERATIONS = 100000;

    // AES-GCM IV 长度（12 字节 = 96 位）
    static IV_LENGTH = 12;

    /**
     * 从密码派生加密密钥（推荐方法）
     * 使用 PBKDF2-SHA256 从用户密码派生 AES-256 密钥
     * 
     * @param {string} password - 用户输入的房间密码
     * @param {string} roomId - 房间ID（作为salt，确保不同房间不同密钥）
     * @param {number} iterations - PBKDF2迭代次数（默认100000）
     * @returns {Promise<CryptoKey>} AES-GCM密钥
     * 
     * @example
     * const key = await CryptoUtils.deriveKeyFromPassword('myPassword123', 'room-abc');
     */
    static async deriveKeyFromPassword(password, roomId, iterations = CryptoUtils.PBKDF2_ITERATIONS) {
        // 1. 将密码转换为密钥材料
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);

        const baseKey = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // 2. 使用 roomId 作为 salt（确保不同房间派生不同密钥）
        const salt = encoder.encode(roomId);

        // 3. 派生 AES-GCM 密钥
        const derivedKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: iterations,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true, // 可导出（用于存储和传输）
            ['encrypt', 'decrypt']
        );

        return derivedKey;
    }

    /**
     * 生成新的随机 AES-256 密钥（高级方案）
     * 用于不基于密码的加密场景
     * 
     * @returns {Promise<CryptoKey>} AES-GCM密钥
     */
    static async generateRoomKey() {
        return await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * 加密文本消息
     * 
     * @param {string} plaintext - 明文消息
     * @param {CryptoKey} key - AES-GCM密钥
     * @returns {Promise<Object>} 加密数据对象 {iv, ciphertext, version}
     * 
     * @example
     * const encrypted = await CryptoUtils.encryptMessage('Hello!', key);
     * // 返回: {iv: [1,2,3,...], ciphertext: [4,5,6,...], version: '1.0'}
     */
    static async encryptMessage(plaintext, key) {
        // 1. 生成随机 IV (初始化向量)
        // AES-GCM 需要唯一的 IV，每条消息都不同
        const iv = crypto.getRandomValues(new Uint8Array(CryptoUtils.IV_LENGTH));

        // 2. 将文本编码为字节
        const encodedText = new TextEncoder().encode(plaintext);

        // 3. 加密
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encodedText
        );

        // 4. 返回结构化数据（可序列化）
        return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext)),
            version: CryptoUtils.VERSION
        };
    }

    /**
     * 解密文本消息
     * 
     * @param {Object} encryptedData - 加密数据 {iv, ciphertext, version}
     * @param {CryptoKey} key - AES-GCM密钥
     * @returns {Promise<string>} 明文消息
     * @throws {Error} 解密失败（密钥错误或数据损坏）
     * 
     * @example
     * const plaintext = await CryptoUtils.decryptMessage(encrypted, key);
     */
    static async decryptMessage(encryptedData, key) {
        // 1. 恢复 IV 和密文
        const iv = new Uint8Array(encryptedData.iv);
        const ciphertext = new Uint8Array(encryptedData.ciphertext);

        // 2. 解密
        // 注意：如果密钥错误或数据被篡改，AES-GCM 会抛出异常
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );

        // 3. 将字节解码为文本
        return new TextDecoder().decode(decrypted);
    }

    /**
     * 导出密钥为 Base64 字符串（用于存储）
     * 
     * @param {CryptoKey} key - 要导出的密钥
     * @returns {Promise<string>} Base64编码的密钥
     */
    static async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    }

    /**
     * 从 Base64 字符串导入密钥
     * 
     * @param {string} keyBase64 - Base64编码的密钥
     * @returns {Promise<CryptoKey>} AES-GCM密钥
     */
    static async importKey(keyBase64) {
        const keyData = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * 生成 RSA 密钥对（用于密钥交换）
     * 
     * @returns {Promise<CryptoKeyPair>} {publicKey, privateKey}
     */
    static async generateKeyPair() {
        return await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * 使用 RSA 公钥加密对称密钥
     * 
     * @param {CryptoKey} symmetricKey - AES-GCM对称密钥
     * @param {CryptoKey} publicKey - RSA公钥
     * @returns {Promise<Array<number>>} 加密后的密钥（字节数组）
     */
    static async encryptKeyWithPublicKey(symmetricKey, publicKey) {
        const exported = await crypto.subtle.exportKey('raw', symmetricKey);
        const encrypted = await crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            publicKey,
            exported
        );
        return Array.from(new Uint8Array(encrypted));
    }

    /**
     * 使用 RSA 私钥解密对称密钥
     * 
     * @param {Array<number>} encryptedKey - 加密的密钥（字节数组）
     * @param {CryptoKey} privateKey - RSA私钥
     * @returns {Promise<CryptoKey>} 解密后的AES-GCM密钥
     */
    static async decryptKeyWithPrivateKey(encryptedKey, privateKey) {
        const keyData = new Uint8Array(encryptedKey);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            privateKey,
            keyData
        );

        return await crypto.subtle.importKey(
            'raw',
            decrypted,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * 加密文件数据
     * 
     * @param {ArrayBuffer} fileData - 文件数据
     * @param {CryptoKey} key - AES-GCM密钥
     * @returns {Promise<Object>} 加密数据 {iv, ciphertext, version}
     */
    static async encryptFile(fileData, key) {
        const iv = crypto.getRandomValues(new Uint8Array(CryptoUtils.IV_LENGTH));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            fileData
        );

        return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext)),
            version: CryptoUtils.VERSION
        };
    }

    /**
     * 解密文件数据
     * 
     * @param {Object} encryptedData - 加密数据 {iv, ciphertext}
     * @param {CryptoKey} key - AES-GCM密钥
     * @returns {Promise<ArrayBuffer>} 解密后的文件数据
     */
    static async decryptFile(encryptedData, key) {
        const iv = new Uint8Array(encryptedData.iv);
        const ciphertext = new Uint8Array(encryptedData.ciphertext);

        return await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );
    }

    /**
     * 生成验证数据（用于密码验证）
     * 创建一个包含房间信息的加密载荷，用于验证用户输入的密码是否正确
     * 
     * @param {string} roomId - 房间ID
     * @param {string} password - 房间密码
     * @returns {Promise<string>} 加密的验证数据（JSON字符串）
     */
    static async generateVerificationData(roomId, password) {
        // 1. 从密码派生密钥
        const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

        // 2. 构造验证载荷
        const verificationPayload = {
            type: 'room-verification',
            roomId: roomId,
            version: CryptoUtils.VERSION,
            timestamp: Date.now(),
            salt: crypto.randomUUID() // 随机盐值，防止预测攻击
        };

        // 3. 加密验证载荷
        const encrypted = await CryptoUtils.encryptMessage(
            JSON.stringify(verificationPayload),
            key
        );

        // 4. 返回格式化的验证数据
        return `ENCRYPTED:${JSON.stringify(encrypted)}`;
    }

    /**
     * 验证房间密码
     * 尝试解密验证数据，成功则密码正确
     * 
     * @param {string} password - 要验证的密码
     * @param {string} roomId - 房间ID
     * @param {string} verificationData - 加密的验证数据
     * @returns {Promise<Object>} {success: boolean, error?: string}
     */
    static async verifyPassword(password, roomId, verificationData) {
        try {
            // 1. 解析验证数据
            if (!verificationData.startsWith('ENCRYPTED:')) {
                return { success: false, error: 'Invalid verification data format' };
            }

            const encrypted = JSON.parse(verificationData.substring(10));

            // 2. 从密码派生密钥
            const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

            // 3. 尝试解密验证数据
            const decrypted = await CryptoUtils.decryptMessage(encrypted, key);

            // 4. 解析验证载荷
            const payload = JSON.parse(decrypted);

            // 5. 验证载荷内容
            if (payload.type === 'room-verification' && payload.roomId === roomId) {
                return { success: true };
            } else {
                return { success: false, error: 'Invalid verification payload' };
            }
        } catch (error) {
            // 解密失败 = 密码错误
            // AES-GCM 会在密钥错误时抛出 OperationError
            return { success: false, error: 'Incorrect password' };
        }
    }

    /**
     * 格式化加密消息（用于发送到服务器）
     * 
     * @param {Object} encryptedData - 加密数据对象
     * @returns {string} 格式化的加密消息字符串
     */
    static formatEncryptedMessage(encryptedData) {
        return `ENCRYPTED:${JSON.stringify(encryptedData)}`;
    }

    /**
     * 解析加密消息（从服务器接收）
     * 
     * @param {string} encryptedMessage - 格式化的加密消息字符串
     * @returns {Object|null} 加密数据对象，或null（如果格式错误）
     */
    static parseEncryptedMessage(encryptedMessage) {
        if (!encryptedMessage.startsWith('ENCRYPTED:')) {
            return null;
        }

        try {
            return JSON.parse(encryptedMessage.substring(10));
        } catch (error) {
            console.error('Failed to parse encrypted message:', error);
            return null;
        }
    }

    /**
     * 检查消息是否已加密
     * 
     * @param {string} message - 消息字符串
     * @returns {boolean} true表示已加密
     */
    static isEncrypted(message) {
        return typeof message === 'string' && message.startsWith('ENCRYPTED:');
    }

    /**
     * 生成随机密码
     * 用于创建房间时自动生成密码
     * 
     * @param {number} length - 密码长度（默认16）
     * @returns {string} 随机密码
     */
    static generateRandomPassword(length = 16) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const randomValues = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(randomValues)
            .map(x => charset[x % charset.length])
            .join('');
    }

    /**
     * 计算数据的 SHA-256 哈希（用于完整性验证）
     * 
     * @param {string|ArrayBuffer} data - 要哈希的数据
     * @returns {Promise<string>} 十六进制哈希字符串
     */
    static async hash(data) {
        const encoder = new TextEncoder();
        const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;

        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

// 默认导出
export default CryptoUtils;
