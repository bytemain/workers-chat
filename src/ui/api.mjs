import { decryptPins } from './utils/pin-crypto.mjs';
import { MultipartUploader } from './utils/multipart-uploader.mjs';

// API Client class for server requests
class ChatAPI {
  constructor() {
    this.hostname = window.location.host;
    this.baseUrl = `${window.location.protocol}//${this.hostname}/api`;
  }

  // Create private room
  async createPrivateRoom() {
    const response = await fetch(`${this.baseUrl}/room`, { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to create private room');
    }
    return await response.text();
  }

  // Get room info
  async getRoomInfo(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/info`);
    if (!response.ok) {
      throw new Error('Failed to load room info');
    }
    return await response.json();
  }

  // Update room info
  async updateRoomInfo(roomName, data) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/info`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || 'Failed to save room info');
      Object.assign(error, { code: errorData.code, status: response.status });
      throw error;
    }
    return await response.json();
  }

  // Upload file (legacy - single request, kept for backward compatibility)
  async uploadFile(roomName, formData) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }
    return await response.json();
  }

  /**
   * Upload file using multipart upload (supports progress tracking and large files)
   * @param {string} roomName - Room name
   * @param {File} file - File to upload
   * @param {Object} options - Upload options
   * @param {number} [options.chunkSize] - Chunk size in bytes (default: 10MB)
   * @param {number} [options.maxConcurrency] - Max parallel uploads (default: 5)
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Function} [options.onChunkComplete] - Chunk complete callback
   * @returns {Promise<Object>} Upload result
   */
  async uploadFileMultipart(roomName, file, options = {}) {
    const uploader = new MultipartUploader({
      file,
      roomName,
      baseUrl: this.baseUrl,
      ...options,
    });

    return await uploader.start();
  }

  /**
   * Smart upload
   * @param {string} roomName - Room name
   * @param {File} file - File to upload
   * @param {Object} options - Upload options (for multipart)
   * @returns {Promise<Object>} Upload result
   */
  async uploadFileAuto(roomName, file, options = {}) {
    const MULTIPART_THRESHOLD = 2 * 1024 * 1024;

    if (file.size > MULTIPART_THRESHOLD) {
      // Use multipart for large files
      return await this.uploadFileMultipart(roomName, file, options);
    } else {
      // Use legacy single upload for small files
      const formData = new FormData();
      formData.append('file', file);
      return await this.uploadFile(roomName, formData);
    }
  }

  // Get thread replies
  async getThreadReplies(roomName, messageId, nested = true) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/thread/${messageId}?nested=${nested}`,
    );
    if (!response.ok) {
      throw new Error('Failed to load thread');
    }
    return await response.json();
  }

  // Get messages for a specific channel
  async getChannelMessages(roomName, channelName, limit = 100) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/channel/${channelName}/messages?limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error('Failed to load channel messages');
    }
    return await response.json();
  }

  // Get WebSocket URL
  getWebSocketUrl(roomName) {
    const wss = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
    return `${wss}${this.hostname}/api/room/${roomName}/websocket`;
  }

  getTinybaseSyncUrl(storeName) {
    const wss = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
    return `${wss}${this.hostname}/api/tinybase/${storeName}`;
  }

  // destruction/start
  async destroyRoom(roomName, minutes) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/destruction/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      },
    );

    if (!response.ok) {
      throw new Error('Failed to start destruction');
    }

    const data = await response.json();
    return data;
  }

  async cancelRoomDestruction(roomName) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/destruction/cancel`,
      {
        method: 'POST',
      },
    );

    if (!response.ok) {
      throw new Error('Failed to cancel destruction');
    }
    const data = await response.json();
    return data;
  }

  // Delete message
  async deleteMessage(roomName, messageId, username) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/message/${messageId}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete message');
    }
    return await response.json();
  }

  // Edit message
  async editMessage(roomName, messageId, username, newMessage) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/message/${messageId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          newMessage,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to edit message');
    }
    return await response.json();
  }
}

// Initialize API client
export const api = new ChatAPI();
