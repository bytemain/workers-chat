/**
 * MultipartUploader - Client-side multipart file upload utility
 *
 * Features:
 * - Parallel chunk uploads with configurable concurrency
 * - Progress tracking for each chunk and overall upload
 * - Automatic retry on failure
 * - Abort/cancel support
 * - Resume capability (when server supports listing uploaded parts)
 *
 * Usage:
 * ```js
 * const uploader = new MultipartUploader({
 *   file: file,
 *   roomName: 'my-room',
 *   baseUrl: '/api',
 *   chunkSize: 10 * 1024 * 1024, // 10MB
 *   maxConcurrency: 5,
 *   onProgress: (progress) => {
 *     console.log(`${progress.percentage}% uploaded`);
 *   },
 * });
 *
 * const result = await uploader.start();
 * console.log('File uploaded:', result.fileUrl);
 * ```
 */

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB (R2 minimum is 5MB except last part)
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_MAX_RETRIES = 3;

export class MultipartUploader {
  /**
   * @param {Object} options - Upload configuration
   * @param {File} options.file - File to upload
   * @param {string} options.roomName - Chat room name
   * @param {string} [options.baseUrl] - API base URL
   * @param {number} [options.chunkSize] - Size of each chunk in bytes (default: 10MB)
   * @param {number} [options.maxConcurrency] - Maximum parallel uploads (default: 5)
   * @param {number} [options.maxRetries] - Maximum retry attempts per chunk (default: 3)
   * @param {Function} [options.onProgress] - Progress callback (progress) => {}
   * @param {Function} [options.onChunkComplete] - Chunk completion callback (chunkInfo) => {}
   * @param {Function} [options.onError] - Error callback (error) => {}
   */
  constructor(options) {
    this.file = options.file;
    this.roomName = options.roomName;
    this.baseUrl = options.baseUrl || '/api';
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    this.maxConcurrency = options.maxConcurrency || DEFAULT_MAX_CONCURRENCY;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.onProgress = options.onProgress || (() => {});
    this.onChunkComplete = options.onChunkComplete || (() => {});
    this.onError = options.onError || (() => {});

    // Calculate total chunks
    this.totalChunks = Math.ceil(this.file.size / this.chunkSize);

    // Upload state
    this.uploadId = null;
    this.fileKey = null;
    this.fileId = null;
    this.uploadedParts = []; // Array of {partNumber, etag}
    this.completedChunks = 0;
    this.uploadedBytes = 0;
    this.aborted = false;

    // Concurrency control
    this.activeUploads = 0;
    this.uploadQueue = [];
  }

  /**
   * Start the multipart upload
   * @returns {Promise<Object>} Upload result with fileUrl, fileName, etc.
   */
  async start() {
    try {
      // Step 1: Create multipart upload
      await this.createMultipartUpload();

      // Step 2: Upload all chunks
      await this.uploadChunks();

      // Step 3: Complete multipart upload
      const result = await this.completeMultipartUpload();

      return result;
    } catch (error) {
      // Cleanup on error
      if (this.uploadId && this.fileKey && !this.aborted) {
        try {
          await this.abortMultipartUpload();
        } catch (abortError) {
          console.error('Failed to abort multipart upload:', abortError);
        }
      }
      throw error;
    }
  }

  /**
   * Abort the upload
   */
  async abort() {
    this.aborted = true;

    // Cancel pending uploads
    this.uploadQueue = [];

    // Abort multipart upload on server
    if (this.uploadId && this.fileKey) {
      await this.abortMultipartUpload();
    }
  }

  /**
   * Create multipart upload session
   */
  async createMultipartUpload() {
    const response = await fetch(
      `${this.baseUrl}/room/${this.roomName}/upload/mpu-create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: this.file.name,
          fileType: this.file.type,
          fileSize: this.file.size,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create multipart upload');
    }

    const data = await response.json();
    this.uploadId = data.uploadId;
    this.fileKey = data.fileKey;
    this.fileId = data.fileId;

    return data;
  }

  /**
   * Upload all chunks with concurrency control
   */
  async uploadChunks() {
    // Initialize queue with all chunks
    for (let i = 0; i < this.totalChunks; i++) {
      this.uploadQueue.push(i);
    }

    // Start concurrent uploads
    const uploadPromises = [];
    for (let i = 0; i < this.maxConcurrency; i++) {
      uploadPromises.push(this.uploadWorker());
    }

    // Wait for all uploads to complete
    await Promise.all(uploadPromises);

    if (this.aborted) {
      throw new Error('Upload aborted');
    }
  }

  /**
   * Worker that processes the upload queue
   */
  async uploadWorker() {
    while (this.uploadQueue.length > 0 && !this.aborted) {
      const chunkIndex = this.uploadQueue.shift();
      if (chunkIndex === undefined) break;

      await this.uploadChunk(chunkIndex);
    }
  }

  /**
   * Upload a single chunk with retry logic
   */
  async uploadChunk(chunkIndex) {
    const partNumber = chunkIndex + 1; // Part numbers are 1-indexed
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const chunk = this.file.slice(start, end);

    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.aborted) {
        throw new Error('Upload aborted');
      }

      try {
        this.activeUploads++;

        const response = await fetch(
          `${this.baseUrl}/room/${this.roomName}/upload/mpu-uploadpart?uploadId=${this.uploadId}&partNumber=${partNumber}&key=${this.fileKey}`,
          {
            method: 'PUT',
            body: chunk,
          },
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to upload chunk');
        }

        const data = await response.json();

        // Store uploaded part info
        this.uploadedParts[chunkIndex] = {
          partNumber: data.partNumber,
          etag: data.etag,
        };

        // Update progress
        this.completedChunks++;
        this.uploadedBytes += chunk.size;
        this.updateProgress();

        // Notify chunk completion
        this.onChunkComplete({
          chunkIndex,
          partNumber: data.partNumber,
          chunkSize: chunk.size,
          totalChunks: this.totalChunks,
        });

        this.activeUploads--;
        return; // Success
      } catch (error) {
        this.activeUploads--;
        lastError = error;

        if (attempt < this.maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.onError(
      new Error(
        `Failed to upload chunk ${chunkIndex + 1} after ${this.maxRetries + 1} attempts: ${lastError.message}`,
      ),
    );
    throw lastError;
  }

  /**
   * Complete the multipart upload
   */
  async completeMultipartUpload() {
    // Sort parts by part number
    const parts = this.uploadedParts
      .filter((part) => part) // Remove empty slots
      .sort((a, b) => a.partNumber - b.partNumber);

    const response = await fetch(
      `${this.baseUrl}/room/${this.roomName}/upload/mpu-complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId: this.uploadId,
          key: this.fileKey,
          parts: parts,
          fileName: this.file.name,
          fileType: this.file.type,
          fileSize: this.file.size,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to complete multipart upload');
    }

    return await response.json();
  }

  /**
   * Abort the multipart upload
   */
  async abortMultipartUpload() {
    const response = await fetch(
      `${this.baseUrl}/room/${this.roomName}/upload/mpu-abort`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId: this.uploadId,
          key: this.fileKey,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to abort multipart upload');
    }

    return await response.json();
  }

  /**
   * Update progress and notify callback
   */
  updateProgress() {
    const percentage = Math.round((this.uploadedBytes / this.file.size) * 100);

    this.onProgress({
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.file.size,
      percentage: percentage,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
      activeUploads: this.activeUploads,
    });
  }

  /**
   * Get current progress
   */
  getProgress() {
    return {
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.file.size,
      percentage: Math.round((this.uploadedBytes / this.file.size) * 100),
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
      activeUploads: this.activeUploads,
    };
  }
}
