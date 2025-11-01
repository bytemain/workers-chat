// API Client class for server requests
class ChatAPI {
  constructor() {
    this.hostname = window.location.host;
    this.baseUrl = `https://${this.hostname}/api`;
  }

  // Create private room
  async createPrivateRoom() {
    const response = await fetch(`${this.baseUrl}/room`, { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to create private room');
    }
    return await response.text();
  }

  // Get channels for a room
  async getChannels(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/channels`);
    if (!response.ok) {
      throw new Error('Failed to load channels');
    }
    return await response.json();
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

  // Upload file
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

  async exportData(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/export`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error('Failed to export data');
    }
    return await response.json();
  }

  // destruction/start
  async destroyRoom(roomName, minutes) {
    const response = await fetch(`/api/room/${roomName}/destruction/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes }),
    });

    if (!response.ok) {
      throw new Error('Failed to start destruction');
    }

    const data = await response.json();
    return data;
  }

  async cancelRoomDestruction(roomName) {
    const response = await fetch(`/api/room/${roomName}/destruction/cancel`, {
      method: 'POST',
    });

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
