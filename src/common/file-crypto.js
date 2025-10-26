/**
 * E2EE File Encryption Utilities
 * 提供文件流式加密/解密功能，支持大文件分块处理
 * 避免内存溢出，提供进度回调
 */

import CryptoUtils from './crypto-utils.js';
import { getCryptoPool } from '../ui/crypto-worker-pool.js';

/**
 * 文件加密工具类
 */
export class FileCrypto {
    // 文件分块大小（2MB per chunk）
    static CHUNK_SIZE = 2 * 1024 * 1024;

    // 元数据分隔符
    static METADATA_SEPARATOR = 0x00;

    /**
     * 加密文件（流式处理，支持大文件）
     * 
     * @param {File} file - 要加密的文件
     * @param {CryptoKey} key - 加密密钥
     * @param {function} onProgress - 进度回调 (progress: 0-100, stage: string)
     * @returns {Promise<Blob>} 加密后的文件 Blob
     * 
     * @example
     * const encryptedBlob = await FileCrypto.encryptFile(file, key, (progress, stage) => {
     *   console.log(`${stage}: ${progress}%`);
     * });
     */
    static async encryptFile(file, key, onProgress = null) {
        const totalChunks = Math.ceil(file.size / FileCrypto.CHUNK_SIZE);
        const encryptedChunks = [];

        console.log(`🔐 Encrypting file: ${file.name} (${file.size} bytes, ${totalChunks} chunks)`);

        // 导出密钥为可传递格式
        const keyData = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

        // 获取 Worker 池
        const cryptoPool = getCryptoPool();

        // 分块加密
        for (let i = 0; i < totalChunks; i++) {
            const start = i * FileCrypto.CHUNK_SIZE;
            const end = Math.min(start + FileCrypto.CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            // 读取 chunk 数据
            const arrayBuffer = await chunk.arrayBuffer();

            // 提交加密任务到 Worker
            const encrypted = await cryptoPool.submitTask('encrypt-file-chunk', {
                chunk: Array.from(new Uint8Array(arrayBuffer)),
                keyData: keyData,
                chunkIndex: i
            });

            encryptedChunks.push(encrypted);

            // 更新进度
            const progress = ((i + 1) / totalChunks) * 100;
            if (onProgress) {
                onProgress(progress, 'encrypting');
            }
        }

        console.log(`✅ File encryption complete`);

        // 创建元数据
        const metadata = {
            originalName: file.name,
            originalType: file.type,
            originalSize: file.size,
            chunkSize: FileCrypto.CHUNK_SIZE,
            totalChunks: totalChunks,
            encrypted: true,
            version: '2.0',
            encryptedAt: Date.now()
        };

        // 构建加密文件
        return FileCrypto.buildEncryptedBlob(metadata, encryptedChunks);
    }

    /**
     * 解密文件（流式处理）
     * 
     * @param {Blob} encryptedBlob - 加密的文件 Blob
     * @param {CryptoKey} key - 解密密钥
     * @param {function} onProgress - 进度回调
     * @returns {Promise<{blob: Blob, metadata: object}>} 解密后的文件和元数据
     */
    static async decryptFile(encryptedBlob, key, onProgress = null) {
        // 1. 解析元数据和加密数据
        const { metadata, chunks } = await FileCrypto.parseEncryptedBlob(encryptedBlob);

        console.log(`🔓 Decrypting file: ${metadata.originalName} (${chunks.length} chunks)`);

        // 2. 导出密钥为可传递格式
        const keyData = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

        // 3. 获取 Worker 池
        const cryptoPool = getCryptoPool();

        // 4. 分块解密
        const decryptedChunks = [];
        for (let i = 0; i < chunks.length; i++) {
            const decrypted = await cryptoPool.submitTask('decrypt-file-chunk', {
                encryptedChunk: chunks[i],
                keyData: keyData,
                chunkIndex: i
            });

            decryptedChunks.push(new Uint8Array(decrypted));

            // 更新进度
            const progress = ((i + 1) / chunks.length) * 100;
            if (onProgress) {
                onProgress(progress, 'decrypting');
            }
        }

        console.log(`✅ File decryption complete`);

        // 5. 合并所有 chunk
        const totalSize = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;

        for (const chunk of decryptedChunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        // 6. 创建 Blob
        const blob = new Blob([combined], { type: metadata.originalType });

        return {
            blob,
            metadata
        };
    }

    /**
     * 构建加密文件 Blob
     * 格式: [元数据JSON] [0x00分隔符] [加密chunk1] [加密chunk2] ...
     * 
     * @param {object} metadata - 文件元数据
     * @param {Array} encryptedChunks - 加密的分块数组
     * @returns {Blob} 加密文件 Blob
     */
    static buildEncryptedBlob(metadata, encryptedChunks) {
        // 1. 序列化元数据
        const metadataJson = JSON.stringify(metadata);
        const metadataBytes = new TextEncoder().encode(metadataJson);

        // 2. 计算总大小
        let totalSize = metadataBytes.length + 1; // 元数据 + 分隔符
        for (const chunk of encryptedChunks) {
            totalSize += chunk.ciphertext.length;
        }

        // 3. 构建完整数据
        const buffer = new Uint8Array(totalSize);
        let offset = 0;

        // 写入元数据
        buffer.set(metadataBytes, offset);
        offset += metadataBytes.length;

        // 写入分隔符
        buffer[offset] = FileCrypto.METADATA_SEPARATOR;
        offset += 1;

        // 写入加密数据
        for (const chunk of encryptedChunks) {
            buffer.set(new Uint8Array(chunk.ciphertext), offset);
            offset += chunk.ciphertext.length;
        }

        // 4. 创建 Blob（添加自定义 MIME 类型标记）
        return new Blob([buffer], { type: 'application/x-encrypted' });
    }

    /**
     * 解析加密文件 Blob
     * 
     * @param {Blob} encryptedBlob - 加密文件 Blob
     * @returns {Promise<{metadata: object, chunks: Array}>} 元数据和加密分块
     */
    static async parseEncryptedBlob(encryptedBlob) {
        // 1. 读取所有数据
        const arrayBuffer = await encryptedBlob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // 2. 查找分隔符
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

        // 3. 解析元数据
        const metadataBytes = data.slice(0, separatorIndex);
        const metadataJson = new TextDecoder().decode(metadataBytes);
        const metadata = JSON.parse(metadataJson);

        // 4. 提取加密数据
        const encryptedData = data.slice(separatorIndex + 1);

        // 5. 重建加密分块
        // 注意：我们需要存储每个 chunk 的 IV 信息
        // 这里简化处理，实际应该在元数据中记录每个 chunk 的 IV
        const chunks = [];
        const chunkSize = metadata.chunkSize || FileCrypto.CHUNK_SIZE;

        // TODO: 改进存储格式，在元数据中记录每个 chunk 的 IV
        // 目前假设 IV 在文件加密时已经处理

        throw new Error('parseEncryptedBlob: Not fully implemented - need to store IV per chunk');
    }

    /**
     * 加密文件（改进版，包含完整的 chunk 元数据）
     * 
     * @param {File} file - 要加密的文件
     * @param {CryptoKey} key - 加密密钥
     * @param {function} onProgress - 进度回调
     * @returns {Promise<Blob>} 加密后的文件 Blob
     */
    static async encryptFileV2(file, key, onProgress = null) {
        const totalChunks = Math.ceil(file.size / FileCrypto.CHUNK_SIZE);
        const encryptedChunks = [];

        console.log(`🔐 Encrypting file (v2): ${file.name} (${file.size} bytes, ${totalChunks} chunks)`);

        // 导出密钥为可传递格式
        const keyData = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

        // 获取 Worker 池
        const cryptoPool = getCryptoPool();

        // 分块加密
        for (let i = 0; i < totalChunks; i++) {
            const start = i * FileCrypto.CHUNK_SIZE;
            const end = Math.min(start + FileCrypto.CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            // 读取 chunk 数据
            const arrayBuffer = await chunk.arrayBuffer();

            // 提交加密任务到 Worker
            const encrypted = await cryptoPool.submitTask('encrypt-file-chunk', {
                chunk: Array.from(new Uint8Array(arrayBuffer)),
                keyData: keyData,
                chunkIndex: i
            });

            encryptedChunks.push(encrypted);

            // 更新进度
            const progress = ((i + 1) / totalChunks) * 100;
            if (onProgress) {
                onProgress(progress, 'encrypting');
            }
        }

        console.log(`✅ File encryption complete (v2)`);

        // 创建完整元数据（包含每个 chunk 的 IV）
        const metadata = {
            originalName: file.name,
            originalType: file.type,
            originalSize: file.size,
            chunkSize: FileCrypto.CHUNK_SIZE,
            totalChunks: totalChunks,
            encrypted: true,
            version: '2.1',
            encryptedAt: Date.now(),
            chunks: encryptedChunks.map(c => ({
                iv: c.iv,
                size: c.ciphertext.length,
                index: c.chunkIndex
            }))
        };

        // 构建加密文件
        const parts = [
            // 元数据部分
            new TextEncoder().encode(JSON.stringify(metadata)),
            new Uint8Array([FileCrypto.METADATA_SEPARATOR]),
            // 加密数据部分（只存储密文，IV 在元数据中）
            ...encryptedChunks.map(c => new Uint8Array(c.ciphertext))
        ];

        return new Blob(parts, { type: 'application/x-encrypted-v2' });
    }

    /**
     * 解密文件（改进版）
     * 
     * @param {Blob} encryptedBlob - 加密的文件 Blob
     * @param {CryptoKey} key - 解密密钥
     * @param {function} onProgress - 进度回调
     * @returns {Promise<{blob: Blob, metadata: object}>}
     */
    static async decryptFileV2(encryptedBlob, key, onProgress = null) {
        // 1. 读取数据
        const arrayBuffer = await encryptedBlob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // 2. 查找分隔符
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

        // 3. 解析元数据
        const metadataBytes = data.slice(0, separatorIndex);
        const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));

        console.log(`🔓 Decrypting file (v2): ${metadata.originalName} (${metadata.totalChunks} chunks)`);

        // 4. 提取密文数据
        const encryptedData = data.slice(separatorIndex + 1);

        // 5. 重建加密分块
        const chunks = [];
        let offset = 0;
        for (const chunkMeta of metadata.chunks) {
            const ciphertext = encryptedData.slice(offset, offset + chunkMeta.size);
            chunks.push({
                iv: chunkMeta.iv,
                ciphertext: Array.from(ciphertext),
                chunkIndex: chunkMeta.index
            });
            offset += chunkMeta.size;
        }

        // 6. 导出密钥
        const keyData = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

        // 7. 解密所有分块
        const cryptoPool = getCryptoPool();
        const decryptedChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            const decrypted = await cryptoPool.submitTask('decrypt-file-chunk', {
                encryptedChunk: chunks[i],
                keyData: keyData,
                chunkIndex: i
            });

            decryptedChunks.push(new Uint8Array(decrypted));

            // 更新进度
            const progress = ((i + 1) / chunks.length) * 100;
            if (onProgress) {
                onProgress(progress, 'decrypting');
            }
        }

        console.log(`✅ File decryption complete (v2)`);

        // 8. 合并所有分块
        const totalSize = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalSize);
        let combineOffset = 0;

        for (const chunk of decryptedChunks) {
            combined.set(chunk, combineOffset);
            combineOffset += chunk.length;
        }

        // 9. 创建 Blob
        const blob = new Blob([combined], { type: metadata.originalType });

        return {
            blob,
            metadata: {
                fileName: metadata.originalName,
                fileType: metadata.originalType,
                fileSize: metadata.originalSize,
                encryptedAt: metadata.encryptedAt
            }
        };
    }

    /**
     * 加密并上传文件到服务器
     * 
     * @param {File} file - 要上传的文件
     * @param {CryptoKey} key - 加密密钥
     * @param {string} uploadUrl - 上传 URL
     * @param {function} onProgress - 进度回调
     * @returns {Promise<object>} 上传结果
     */
    static async encryptAndUpload(file, key, uploadUrl, onProgress = null) {
        // 1. 加密文件
        const encryptedBlob = await FileCrypto.encryptFileV2(file, key, (progress, stage) => {
            if (onProgress) {
                // 加密占 70% 进度
                onProgress(progress * 0.7, stage);
            }
        });

        // 2. 上传到服务器
        const formData = new FormData();
        formData.append('file', encryptedBlob, `${file.name}.enc`);

        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });

        if (onProgress) {
            onProgress(100, 'uploaded');
        }

        return await response.json();
    }

    /**
     * 下载并解密文件
     * 
     * @param {string} fileUrl - 文件 URL
     * @param {CryptoKey} key - 解密密钥
     * @param {function} onProgress - 进度回调
     * @returns {Promise<{blob: Blob, metadata: object}>}
     */
    static async downloadAndDecrypt(fileUrl, key, onProgress = null) {
        // 1. 下载加密文件
        if (onProgress) {
            onProgress(10, 'downloading');
        }

        const response = await fetch(fileUrl);
        const encryptedBlob = await response.blob();

        if (onProgress) {
            onProgress(30, 'downloaded');
        }

        // 2. 解密文件
        return await FileCrypto.decryptFileV2(encryptedBlob, key, (progress, stage) => {
            if (onProgress) {
                // 解密占 30-100% 进度
                onProgress(30 + progress * 0.7, stage);
            }
        });
    }
}

// 默认导出
export default FileCrypto;
