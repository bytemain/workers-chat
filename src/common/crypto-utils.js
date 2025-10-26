/**
 * E2EE Encryption Utilities
 * Provides AES-GCM encryption/decryption, PBKDF2 key derivation, etc.
 * All operations are performed on the client side, server only stores and forwards ciphertext
 */

/**
 * Encryption utility class
 * Implements end-to-end encryption using Web Crypto API
 */
export class CryptoUtils {
  // Encryption version for backward compatibility
  static VERSION = '1.0';

  // PBKDF2 default iterations (100,000 times, balancing security and performance)
  static PBKDF2_ITERATIONS = 100000;

  // AES-GCM IV length (12 bytes = 96 bits)
  static IV_LENGTH = 12;

  /**
   * Derive encryption key from password (recommended method)
   * Uses PBKDF2-SHA256 to derive AES-256 key from user password
   *
   * @param {string} password - User entered room password
   * @param {string} roomId - Room ID (used as salt, ensures different keys for different rooms)
   * @param {number} iterations - PBKDF2 iterations (default 100000)
   * @returns {Promise<CryptoKey>} AES-GCM key
   *
   * @example
   * const key = await CryptoUtils.deriveKeyFromPassword('myPassword123', 'room-abc');
   */
  static async deriveKeyFromPassword(
    password,
    roomId,
    iterations = CryptoUtils.PBKDF2_ITERATIONS,
  ) {
    // 1. Convert password to key material
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey'],
    );

    // 2. Use roomId as salt (ensures different rooms derive different keys)
    const salt = encoder.encode(roomId);

    // 3. Derive AES-GCM key
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true, // Exportable (for storage and transmission)
      ['encrypt', 'decrypt'],
    );

    return derivedKey;
  }

  /**
   * Generate new random AES-256 key (advanced mode)
   * For encryption scenarios not based on password
   *
   * @returns {Promise<CryptoKey>} AES-GCM key
   */
  static async generateRoomKey() {
    return await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt text message
   *
   * @param {string} plaintext - Plain text message
   * @param {CryptoKey} key - AES-GCM key
   * @returns {Promise<Object>} Encrypted data object {iv, ciphertext, version}
   *
   * @example
   * const encrypted = await CryptoUtils.encryptMessage('Hello!', key);
   * // Returns: {iv: [1,2,3,...], ciphertext: [4,5,6,...], version: '1.0'}
   */
  static async encryptMessage(plaintext, key) {
    // 1. Generate random IV (Initialization Vector)
    // AES-GCM requires unique IV, different for each message
    const iv = crypto.getRandomValues(new Uint8Array(CryptoUtils.IV_LENGTH));

    // 2. Encode text as bytes
    const encodedText = new TextEncoder().encode(plaintext);

    // 3. Encrypt
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encodedText,
    );

    // 4. Return structured data (serializable)
    return {
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      version: CryptoUtils.VERSION,
    };
  }

  /**
   * Decrypt text message
   *
   * @param {Object} encryptedData - Encrypted data {iv, ciphertext, version}
   * @param {CryptoKey} key - AES-GCM key
   * @returns {Promise<string>} Plain text message
   * @throws {Error} Decryption failed (wrong key or corrupted data)
   *
   * @example
   * const plaintext = await CryptoUtils.decryptMessage(encrypted, key);
   */
  static async decryptMessage(encryptedData, key) {
    // 1. Restore IV and ciphertext
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    // 2. Decrypt
    // Note: AES-GCM will throw an exception if key is wrong or data is tampered
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext,
    );

    // 3. Decode bytes to text
    return new TextDecoder().decode(decrypted);
  }

  /**
   * Export key as Base64 string (for storage)
   *
   * @param {CryptoKey} key - Key to export
   * @returns {Promise<string>} Base64 encoded key
   */
  static async exportKey(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  /**
   * Import key from Base64 string
   *
   * @param {string} keyBase64 - Base64 encoded key
   * @returns {Promise<CryptoKey>} AES-GCM key
   */
  static async importKey(keyBase64) {
    const keyData = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Generate RSA key pair (for key exchange)
   *
   * @returns {Promise<CryptoKeyPair>} {publicKey, privateKey}
   */
  static async generateKeyPair() {
    return await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt symmetric key with RSA public key
   *
   * @param {CryptoKey} symmetricKey - AES-GCM symmetric key
   * @param {CryptoKey} publicKey - RSA public key
   * @returns {Promise<Array<number>>} Encrypted key (byte array)
   */
  static async encryptKeyWithPublicKey(symmetricKey, publicKey) {
    const exported = await crypto.subtle.exportKey('raw', symmetricKey);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      exported,
    );
    return Array.from(new Uint8Array(encrypted));
  }

  /**
   * Decrypt symmetric key with RSA private key
   *
   * @param {Array<number>} encryptedKey - Encrypted key (byte array)
   * @param {CryptoKey} privateKey - RSA private key
   * @returns {Promise<CryptoKey>} Decrypted AES-GCM key
   */
  static async decryptKeyWithPrivateKey(encryptedKey, privateKey) {
    const keyData = new Uint8Array(encryptedKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      keyData,
    );

    return await crypto.subtle.importKey(
      'raw',
      decrypted,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt file data
   *
   * @param {ArrayBuffer} fileData - File data
   * @param {CryptoKey} key - AES-GCM key
   * @returns {Promise<Object>} Encrypted data {iv, ciphertext, version}
   */
  static async encryptFile(fileData, key) {
    const iv = crypto.getRandomValues(new Uint8Array(CryptoUtils.IV_LENGTH));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      fileData,
    );

    return {
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      version: CryptoUtils.VERSION,
    };
  }

  /**
   * Decrypt file data
   *
   * @param {Object} encryptedData - Encrypted data {iv, ciphertext}
   * @param {CryptoKey} key - AES-GCM key
   * @returns {Promise<ArrayBuffer>} Decrypted file data
   */
  static async decryptFile(encryptedData, key) {
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext,
    );
  }

  /**
   * Generate verification data (for password verification)
   * Create an encrypted payload containing room information to verify if user entered password is correct
   *
   * @param {string} roomId - Room ID
   * @param {string} password - Room password
   * @returns {Promise<string>} Encrypted verification data (JSON string)
   */
  static async generateVerificationData(roomId, password) {
    // 1. Derive key from password
    const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

    // 2. Construct verification payload
    const verificationPayload = {
      type: 'room-verification',
      roomId: roomId,
      version: CryptoUtils.VERSION,
      timestamp: Date.now(),
      salt: crypto.randomUUID(), // Random salt to prevent prediction attacks
    };

    // 3. Encrypt verification payload
    const encrypted = await CryptoUtils.encryptMessage(
      JSON.stringify(verificationPayload),
      key,
    );

    // 4. Return formatted verification data
    return `ENCRYPTED:${JSON.stringify(encrypted)}`;
  }

  /**
   * Verify room password
   * Try to decrypt verification data, success means password is correct
   *
   * @param {string} password - Password to verify
   * @param {string} roomId - Room ID
   * @param {string} verificationData - Encrypted verification data
   * @returns {Promise<Object>} {success: boolean, error?: string}
   */
  static async verifyPassword(password, roomId, verificationData) {
    try {
      // 1. Parse verification data
      if (!verificationData.startsWith('ENCRYPTED:')) {
        return { success: false, error: 'Invalid verification data format' };
      }

      const encrypted = JSON.parse(verificationData.substring(10));

      // 2. Derive key from password
      const key = await CryptoUtils.deriveKeyFromPassword(password, roomId);

      // 3. Try to decrypt verification data
      const decrypted = await CryptoUtils.decryptMessage(encrypted, key);

      // 4. Parse verification payload
      const payload = JSON.parse(decrypted);

      // 5. Verify payload content
      if (payload.type === 'room-verification' && payload.roomId === roomId) {
        return { success: true };
      } else {
        return { success: false, error: 'Invalid verification payload' };
      }
    } catch (error) {
      // Decryption failed = wrong password
      // AES-GCM will throw OperationError when key is wrong
      return { success: false, error: 'Incorrect password' };
    }
  }

  /**
   * Format encrypted message (for sending to server)
   *
   * @param {Object} encryptedData - Encrypted data object
   * @returns {string} Formatted encrypted message string
   */
  static formatEncryptedMessage(encryptedData) {
    return `ENCRYPTED:${JSON.stringify(encryptedData)}`;
  }

  /**
   * Parse encrypted message (received from server)
   *
   * @param {string} encryptedMessage - Formatted encrypted message string
   * @returns {Object|null} Encrypted data object, or null (if format is invalid)
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
   * Check if message is encrypted
   *
   * @param {string} message - Message string
   * @returns {boolean} true means encrypted
   */
  static isEncrypted(message) {
    return typeof message === 'string' && message.startsWith('ENCRYPTED:');
  }

  /**
   * Generate random password
   * Used for auto-generating password when creating room
   *
   * @param {number} length - Password length (default 16)
   * @returns {string} Random password
   */
  static generateRandomPassword(length = 16) {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(randomValues)
      .map((x) => charset[x % charset.length])
      .join('');
  }

  /**
   * Calculate SHA-256 hash of data (for integrity verification)
   *
   * @param {string|ArrayBuffer} data - Data to hash
   * @returns {Promise<string>} Hexadecimal hash string
   */
  static async hash(data) {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;

    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

// Default export
export default CryptoUtils;
