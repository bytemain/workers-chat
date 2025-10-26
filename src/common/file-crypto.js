/**
 * E2EE File Encryption Utilities
 * Provides streaming file encryption/decryption, supports large file chunked processing
 * Avoids memory overflow, provides progress callbacks
 */

import { getCryptoPool } from '../ui/crypto-worker-pool.js';

/**
 * File encryption utility class
 */
export class FileCrypto {
  // File chunk size (2MB per chunk)
  static CHUNK_SIZE = 2 * 1024 * 1024;

  // Metadata separator
  static METADATA_SEPARATOR = 0x00;

  /**
   * Encrypt file (streaming processing, supports large files)
   *
   * @param {File} file - File to encrypt
   * @param {CryptoKey} key - Encryption key
   * @param {function} onProgress - Progress callback (progress: 0-100, stage: string)
   * @returns {Promise<Blob>} Encrypted file Blob
   *
   * @example
   * const encryptedBlob = await FileCrypto.encryptFile(file, key, (progress, stage) => {
   *   console.log(`${stage}: ${progress}%`);
   * });
   */
  static async encryptFile(file, key, onProgress = null) {
    const totalChunks = Math.ceil(file.size / FileCrypto.CHUNK_SIZE);
    const encryptedChunks = [];

    console.log(
      `🔐 Encrypting file: ${file.name} (${file.size} bytes, ${totalChunks} chunks)`,
    );

    // Export key as transferable format
    const keyData = Array.from(
      new Uint8Array(await crypto.subtle.exportKey('raw', key)),
    );

    // Get Worker pool
    const cryptoPool = getCryptoPool();

    // Chunk encryption
    for (let i = 0; i < totalChunks; i++) {
      const start = i * FileCrypto.CHUNK_SIZE;
      const end = Math.min(start + FileCrypto.CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      // Read chunk data
      const arrayBuffer = await chunk.arrayBuffer();

      // Submit encryption task to Worker
      const encrypted = await cryptoPool.submitTask('encrypt-file-chunk', {
        chunk: Array.from(new Uint8Array(arrayBuffer)),
        keyData: keyData,
        chunkIndex: i,
      });

      encryptedChunks.push(encrypted);

      // Update progress
      const progress = ((i + 1) / totalChunks) * 100;
      if (onProgress) {
        onProgress(progress, 'encrypting');
      }
    }

    console.log(`✅ File encryption complete`);

    // Create metadata
    const metadata = {
      originalName: file.name,
      originalType: file.type,
      originalSize: file.size,
      chunkSize: FileCrypto.CHUNK_SIZE,
      totalChunks: totalChunks,
      encrypted: true,
      version: '2.0',
      encryptedAt: Date.now(),
    };

    // Build encrypted file
    return FileCrypto.buildEncryptedBlob(metadata, encryptedChunks);
  }

  /**
   * Decrypt file (streaming processing)
   *
   * @param {Blob} encryptedBlob - Encrypted file Blob
   * @param {CryptoKey} key - Decryption key
   * @param {function} onProgress - Progress callback
   * @returns {Promise<{blob: Blob, metadata: object}>} Decrypted file and metadata
   */
  static async decryptFile(encryptedBlob, key, onProgress = null) {
    // 1. Parse metadata and encrypted data
    const { metadata, chunks } =
      await FileCrypto.parseEncryptedBlob(encryptedBlob);

    console.log(
      `🔓 Decrypting file: ${metadata.originalName} (${chunks.length} chunks)`,
    );

    // 2. Export key as transferable format
    const keyData = Array.from(
      new Uint8Array(await crypto.subtle.exportKey('raw', key)),
    );

    // 3. Get Worker pool
    const cryptoPool = getCryptoPool();

    // 4. Chunk decryption
    const decryptedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const decrypted = await cryptoPool.submitTask('decrypt-file-chunk', {
        encryptedChunk: chunks[i],
        keyData: keyData,
        chunkIndex: i,
      });

      decryptedChunks.push(new Uint8Array(decrypted));

      // Update progress
      const progress = ((i + 1) / chunks.length) * 100;
      if (onProgress) {
        onProgress(progress, 'decrypting');
      }
    }

    console.log(`✅ File decryption complete`);

    // 5. Merge all chunks
    const totalSize = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );
    const combined = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of decryptedChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // 6. Create Blob
    const blob = new Blob([combined], { type: metadata.originalType });

    return {
      blob,
      metadata,
    };
  }

  /**
   * Build encrypted file Blob
   * Format: [metadata JSON] [0x00 separator] [encrypted chunk1] [encrypted chunk2] ...
   *
   * @param {object} metadata - File metadata
   * @param {Array} encryptedChunks - Encrypted chunk array
   * @returns {Blob} Encrypted file Blob
   */
  static buildEncryptedBlob(metadata, encryptedChunks) {
    // 1. Serialize metadata
    const metadataJson = JSON.stringify(metadata);
    const metadataBytes = new TextEncoder().encode(metadataJson);

    // 2. Calculate total size
    let totalSize = metadataBytes.length + 1; // Metadata + separator
    for (const chunk of encryptedChunks) {
      totalSize += chunk.ciphertext.length;
    }

    // 3. Build complete data
    const buffer = new Uint8Array(totalSize);
    let offset = 0;

    // Write metadata
    buffer.set(metadataBytes, offset);
    offset += metadataBytes.length;

    // Write separator
    buffer[offset] = FileCrypto.METADATA_SEPARATOR;
    offset += 1;

    // Write encrypted data
    for (const chunk of encryptedChunks) {
      buffer.set(new Uint8Array(chunk.ciphertext), offset);
      offset += chunk.ciphertext.length;
    }

    // 4. Create Blob (add custom MIME type marker)
    return new Blob([buffer], { type: 'application/x-encrypted' });
  }

  /**
   * Parse encrypted file Blob
   *
   * @param {Blob} encryptedBlob - Encrypted file Blob
   * @returns {Promise<{metadata: object, chunks: Array}>} Metadata and encrypted chunks
   */
  static async parseEncryptedBlob(encryptedBlob) {
    // 1. Read all data
    const arrayBuffer = await encryptedBlob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // 2. Find separator
    let separatorIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === FileCrypto.METADATA_SEPARATOR) {
        separatorIndex = i;
        break;
      }
    }

    if (separatorIndex === -1) {
      throw new Error('Invalid encrypted file format: separator not found');
    }

    // 3. Parse metadata
    const metadataBytes = data.slice(0, separatorIndex);
    const metadataJson = new TextDecoder().decode(metadataBytes);
    const metadata = JSON.parse(metadataJson);

    // 4. Extract encrypted data
    const encryptedData = data.slice(separatorIndex + 1);

    // 5. Rebuild encrypted chunks
    // Note: We need to store IV information for each chunk
    // Simplified here, should actually record each chunk's IV in metadata
    const chunks = [];
    const chunkSize = metadata.chunkSize || FileCrypto.CHUNK_SIZE;

    // TODO: Improve storage format, record each chunk's IV in metadata
    // Currently assuming IV was already handled during file encryption

    throw new Error(
      'parseEncryptedBlob: Not fully implemented - need to store IV per chunk',
    );
  }

  /**
   * Encrypt file (improved version, includes complete chunk metadata)
   *
   * @param {File} file - File to encrypt
   * @param {CryptoKey} key - Encryption key
   * @param {function} onProgress - Progress callback
   * @returns {Promise<Blob>} Encrypted file Blob
   */
  static async encryptFileV2(file, key, onProgress = null) {
    const totalChunks = Math.ceil(file.size / FileCrypto.CHUNK_SIZE);
    const encryptedChunks = [];

    console.log(
      `🔐 Encrypting file (v2): ${file.name} (${file.size} bytes, ${totalChunks} chunks)`,
    );

    // Export key as transferable format
    const keyData = Array.from(
      new Uint8Array(await crypto.subtle.exportKey('raw', key)),
    );

    // Get Worker pool
    const cryptoPool = getCryptoPool();

    // Chunk encryption
    for (let i = 0; i < totalChunks; i++) {
      const start = i * FileCrypto.CHUNK_SIZE;
      const end = Math.min(start + FileCrypto.CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      // Read chunk data
      const arrayBuffer = await chunk.arrayBuffer();

      // Submit encryption task to Worker
      const encrypted = await cryptoPool.submitTask('encrypt-file-chunk', {
        chunk: Array.from(new Uint8Array(arrayBuffer)),
        keyData: keyData,
        chunkIndex: i,
      });

      encryptedChunks.push(encrypted);

      // Update progress
      const progress = ((i + 1) / totalChunks) * 100;
      if (onProgress) {
        onProgress(progress, 'encrypting');
      }
    }

    console.log(`✅ File encryption complete (v2)`);

    // Create complete metadata (includes IV for each chunk)
    const metadata = {
      originalName: file.name,
      originalType: file.type,
      originalSize: file.size,
      chunkSize: FileCrypto.CHUNK_SIZE,
      totalChunks: totalChunks,
      encrypted: true,
      version: '2.1',
      encryptedAt: Date.now(),
      chunks: encryptedChunks.map((c) => ({
        iv: c.iv,
        size: c.ciphertext.length,
        index: c.chunkIndex,
      })),
    };

    // Build encrypted file
    const parts = [
      // Metadata part
      new TextEncoder().encode(JSON.stringify(metadata)),
      new Uint8Array([FileCrypto.METADATA_SEPARATOR]),
      // Encrypted data part (only store ciphertext, IV in metadata)
      ...encryptedChunks.map((c) => new Uint8Array(c.ciphertext)),
    ];

    return new Blob(parts, { type: 'application/x-encrypted-v2' });
  }

  /**
   * Decrypt file (improved version)
   *
   * @param {Blob} encryptedBlob - Encrypted file Blob
   * @param {CryptoKey} key - Decryption key
   * @param {function} onProgress - Progress callback
   * @returns {Promise<{blob: Blob, metadata: object}>}
   */
  static async decryptFileV2(encryptedBlob, key, onProgress = null) {
    // 1. Read data
    const arrayBuffer = await encryptedBlob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // 2. Find separator
    let separatorIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === FileCrypto.METADATA_SEPARATOR) {
        separatorIndex = i;
        break;
      }
    }

    if (separatorIndex === -1) {
      throw new Error('Invalid encrypted file format');
    }

    // 3. Parse metadata
    const metadataBytes = data.slice(0, separatorIndex);
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));

    console.log(
      `🔓 Decrypting file (v2): ${metadata.originalName} (${metadata.totalChunks} chunks)`,
    );

    // 4. Extract ciphertext data
    const encryptedData = data.slice(separatorIndex + 1);

    // 5. Rebuild encrypted chunks
    const chunks = [];
    let offset = 0;
    for (const chunkMeta of metadata.chunks) {
      const ciphertext = encryptedData.slice(offset, offset + chunkMeta.size);
      chunks.push({
        iv: chunkMeta.iv,
        ciphertext: Array.from(ciphertext),
        chunkIndex: chunkMeta.index,
      });
      offset += chunkMeta.size;
    }

    // 6. Export key
    const keyData = Array.from(
      new Uint8Array(await crypto.subtle.exportKey('raw', key)),
    );

    // 7. Decrypt all chunks
    const cryptoPool = getCryptoPool();
    const decryptedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const decrypted = await cryptoPool.submitTask('decrypt-file-chunk', {
        encryptedChunk: chunks[i],
        keyData: keyData,
        chunkIndex: i,
      });

      decryptedChunks.push(new Uint8Array(decrypted));

      // Update progress
      const progress = ((i + 1) / chunks.length) * 100;
      if (onProgress) {
        onProgress(progress, 'decrypting');
      }
    }

    console.log(`✅ File decryption complete (v2)`);

    // 8. Merge all chunks
    const totalSize = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );
    const combined = new Uint8Array(totalSize);
    let combineOffset = 0;

    for (const chunk of decryptedChunks) {
      combined.set(chunk, combineOffset);
      combineOffset += chunk.length;
    }

    // 9. Create Blob
    const blob = new Blob([combined], { type: metadata.originalType });

    return {
      blob,
      metadata: {
        fileName: metadata.originalName,
        fileType: metadata.originalType,
        fileSize: metadata.originalSize,
        encryptedAt: metadata.encryptedAt,
      },
    };
  }

  /**
   * Encrypt and upload file to server
   *
   * @param {File} file - File to upload
   * @param {CryptoKey} key - Encryption key
   * @param {string} uploadUrl - Upload URL
   * @param {function} onProgress - Progress callback
   * @returns {Promise<object>} Upload result
   */
  static async encryptAndUpload(file, key, uploadUrl, onProgress = null) {
    // 1. Encrypt file
    const encryptedBlob = await FileCrypto.encryptFileV2(
      file,
      key,
      (progress, stage) => {
        if (onProgress) {
          // Encryption takes 70% of progress
          onProgress(progress * 0.7, stage);
        }
      },
    );

    // 2. Upload to server
    const formData = new FormData();
    formData.append('file', encryptedBlob, `${file.name}.enc`);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (onProgress) {
      onProgress(100, 'uploaded');
    }

    return await response.json();
  }

  /**
   * Download and decrypt file
   *
   * @param {string} fileUrl - File URL
   * @param {CryptoKey} key - Decryption key
   * @param {function} onProgress - Progress callback
   * @returns {Promise<{blob: Blob, metadata: object}>}
   */
  static async downloadAndDecrypt(fileUrl, key, onProgress = null) {
    // 1. Download encrypted file
    if (onProgress) {
      onProgress(10, 'downloading');
    }

    const response = await fetch(fileUrl);
    const encryptedBlob = await response.blob();

    if (onProgress) {
      onProgress(30, 'downloaded');
    }

    // 2. Decrypt file
    return await FileCrypto.decryptFileV2(
      encryptedBlob,
      key,
      (progress, stage) => {
        if (onProgress) {
          // Decryption takes 30-100% of progress
          onProgress(30 + progress * 0.7, stage);
        }
      },
    );
  }
}

// Default export
export default FileCrypto;
