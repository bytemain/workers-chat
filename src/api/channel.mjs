// ===============================
// Channel Management Module
// ===============================
//
// This module provides channel management functionality for the chat application.
// Channels are explicit message categories (similar to Discord), not extracted from content.
// Each message belongs to exactly ONE channel.

/**
 * Validate and normalize channel name
 * @param {string} channel - The channel name to validate
 * @returns {string} - Normalized channel name
 * @throws {Error} - If channel name is invalid
 */
export function validateChannelName(channel) {
  if (!channel || typeof channel !== 'string') {
    throw new Error('Channel name must be a non-empty string');
  }

  const trimmed = channel.trim();

  if (trimmed.length === 0) {
    throw new Error('Channel name cannot be empty');
  }

  if (trimmed.length > 100) {
    throw new Error('Channel name too long (max 100 characters)');
  }

  // Allow alphanumeric, hyphens, underscores, and Unicode characters
  // No special validation - server accepts any reasonable string
  return trimmed;
}

/**
 * Storage key prefix for channel indexes
 */
const CHANNEL_INDEX_PREFIX = 'channel:';
const CHANNEL_META_PREFIX = 'channel_meta:';
const CHANNEL_LIST_KEY = 'channels:all';

/**
 * Generate storage key for a channel index
 * @param {string} channel - The channel name
 * @returns {string} - Storage key
 */
export function getChannelIndexKey(channel) {
  return CHANNEL_INDEX_PREFIX + channel.toLowerCase();
}

/**
 * Generate storage key for channel metadata
 * @param {string} channel - The channel name
 * @returns {string} - Storage key
 */
export function getChannelMetaKey(channel) {
  return CHANNEL_META_PREFIX + channel.toLowerCase();
}

/**
 * ChannelManager class - manages channel indexing and retrieval
 */
export class ChannelManager {
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Index a message in its channel
   * @param {string} messageKey - The storage key of the message (ISO timestamp)
   * @param {string} channel - The channel name
   * @param {number} timestamp - Message timestamp
   */
  async indexMessage(messageKey, channel, timestamp) {
    const normalizedChannel = channel.toLowerCase();
    const indexKey = getChannelIndexKey(normalizedChannel);
    const metaKey = getChannelMetaKey(normalizedChannel);

    // Get existing index
    let index = await this.storage.get(indexKey);
    if (!index) {
      index = [];
    } else if (typeof index === 'string') {
      index = JSON.parse(index);
    }

    // Add message key if not already present
    if (!index.includes(messageKey)) {
      index.push(messageKey);

      // Keep only the latest 10000 messages per channel to avoid unbounded growth
      if (index.length > 10000) {
        index = index.slice(-10000);
      }

      await this.storage.put(indexKey, JSON.stringify(index));
    }

    // Update metadata (count and last used timestamp)
    let meta = await this.storage.get(metaKey);
    if (!meta) {
      meta = { count: 0, firstUsed: timestamp, lastUsed: timestamp };
    } else if (typeof meta === 'string') {
      meta = JSON.parse(meta);
    }

    meta.count = index.length;
    meta.lastUsed = timestamp;
    if (!meta.firstUsed) {
      meta.firstUsed = timestamp;
    }

    await this.storage.put(metaKey, JSON.stringify(meta));

    // Update the global channel list
    await this.updateChannelList(normalizedChannel, timestamp);
  }

  /**
   * Update the global list of all channels
   * @param {string} channel - The channel to add
   * @param {number} timestamp - Last used timestamp
   */
  async updateChannelList(channel, timestamp) {
    let allChannels = await this.storage.get(CHANNEL_LIST_KEY);
    if (!allChannels) {
      allChannels = {};
    } else if (typeof allChannels === 'string') {
      allChannels = JSON.parse(allChannels);
    }

    allChannels[channel] = timestamp;

    await this.storage.put(CHANNEL_LIST_KEY, JSON.stringify(allChannels));
  }

  /**
   * Get all channels used in this room
   * @param {number} limit - Maximum number of channels to return
   * @returns {Promise<Array>} - Array of {channel, count, lastUsed}
   */
  async getAllChannels(limit = 100) {
    const allChannels = await this.storage.get(CHANNEL_LIST_KEY);
    if (!allChannels) {
      return [];
    }

    const channelList =
      typeof allChannels === 'string' ? JSON.parse(allChannels) : allChannels;
    const channelNames = Object.keys(channelList);

    // Fetch metadata for all channels
    const metaPromises = channelNames.map(async (channel) => {
      const metaKey = getChannelMetaKey(channel);
      let meta = await this.storage.get(metaKey);

      if (!meta) {
        return { channel, count: 0, lastUsed: channelList[channel] };
      }

      if (typeof meta === 'string') {
        meta = JSON.parse(meta);
      }

      return {
        channel,
        count: meta.count || 0,
        lastUsed: meta.lastUsed || channelList[channel],
      };
    });

    const results = await Promise.all(metaPromises);

    // Sort by last used (most recent first)
    results.sort((a, b) => b.lastUsed - a.lastUsed);

    return results.slice(0, limit);
  }

  /**
   * Get all messages in a specific channel
   * @param {string} channel - The channel name
   * @param {number} limit - Maximum number of messages to return
   * @returns {Promise<Array>} - Array of message data
   */
  async getMessagesForChannel(channel, limit = 100) {
    const normalizedChannel = channel.toLowerCase();
    const indexKey = getChannelIndexKey(normalizedChannel);
    let index = await this.storage.get(indexKey);

    if (!index) {
      return [];
    }

    if (typeof index === 'string') {
      index = JSON.parse(index);
    }

    // Get the most recent messages (index is chronological)
    const messageKeys = index.slice(-limit);

    // Fetch all messages
    const messages = [];
    for (const key of messageKeys) {
      const message = await this.storage.get(key);
      if (message) {
        const data =
          typeof message === 'string' ? JSON.parse(message) : message;
        messages.push(data);
      }
    }

    return messages;
  }

  /**
   * Search channels by prefix
   * @param {string} prefix - The search prefix
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Array of matching {channel, count, lastUsed}
   */
  async searchChannels(prefix, limit = 10) {
    const allChannels = await this.getAllChannels(1000);

    if (!prefix) {
      return allChannels.slice(0, limit);
    }

    const normalizedPrefix = prefix.toLowerCase();
    const matches = allChannels.filter((item) =>
      item.channel.toLowerCase().startsWith(normalizedPrefix),
    );

    return matches.slice(0, limit);
  }

  /**
   * Get statistics for a specific channel
   * @param {string} channel - The channel name
   * @returns {Promise<Object|null>} - Metadata object or null
   */
  async getChannelStats(channel) {
    const normalizedChannel = channel.toLowerCase();
    const metaKey = getChannelMetaKey(normalizedChannel);
    let meta = await this.storage.get(metaKey);

    if (!meta) {
      return null;
    }

    if (typeof meta === 'string') {
      meta = JSON.parse(meta);
    }

    return {
      channel: normalizedChannel,
      count: meta.count || 0,
      firstUsed: meta.firstUsed || null,
      lastUsed: meta.lastUsed || null,
    };
  }

  /**
   * Remove a message from a channel's index
   * IMPORTANT: This does NOT delete the channel even if it becomes empty.
   * Channels persist until the room is destroyed.
   * @param {string} channel - The channel name
   * @param {string} messageKey - The storage key of the message to remove
   */
  async removeMessageFromChannel(channel, messageKey) {
    const normalizedChannel = channel.toLowerCase();
    const indexKey = getChannelIndexKey(normalizedChannel);
    const metaKey = getChannelMetaKey(normalizedChannel);

    console.log(
      `[ChannelManager] Removing message ${messageKey} from channel #${normalizedChannel}`,
    );

    // Get existing index
    let index = await this.storage.get(indexKey);
    if (!index) {
      console.log(
        `[ChannelManager] Channel #${normalizedChannel} has no index, nothing to remove`,
      );
      return; // Channel doesn't exist, nothing to remove
    }

    if (typeof index === 'string') {
      index = JSON.parse(index);
    }

    console.log(
      `[ChannelManager] Current index for #${normalizedChannel}:`,
      index,
    );

    // Remove the message key from index
    const originalLength = index.length;
    index = index.filter((key) => key !== messageKey);

    console.log(
      `[ChannelManager] After filtering: ${index.length} messages (was ${originalLength})`,
    );

    if (index.length === originalLength) {
      console.log(
        `[ChannelManager] Message ${messageKey} was not in channel #${normalizedChannel}`,
      );
      return; // Message wasn't in this channel's index
    }

    // Update the index even if it's empty - channel persists
    console.log(
      `[ChannelManager] Updating index for #${normalizedChannel} with ${index.length} messages`,
    );
    await this.storage.put(indexKey, JSON.stringify(index));

    // Update metadata count
    let meta = await this.storage.get(metaKey);
    if (meta) {
      if (typeof meta === 'string') {
        meta = JSON.parse(meta);
      }
      meta.count = index.length;
      await this.storage.put(metaKey, JSON.stringify(meta));
    }

    // NOTE: We do NOT remove the channel from the global list even if empty
    // Channels persist until room destruction
  }

  /**
   * Delete all channels and their indexes
   * Should only be called when destroying a room
   * @returns {Promise<void>}
   */
  async deleteAllChannels() {
    console.log('[ChannelManager] Deleting all channels for room destruction');

    // Get all channels
    const allChannels = await this.storage.get(CHANNEL_LIST_KEY);
    if (!allChannels) {
      console.log('[ChannelManager] No channels to delete');
      return;
    }

    const channelList =
      typeof allChannels === 'string' ? JSON.parse(allChannels) : allChannels;
    const channelNames = Object.keys(channelList);

    console.log(`[ChannelManager] Deleting ${channelNames.length} channels`);

    // Delete all channel indexes and metadata
    const deletions = [];
    for (const channel of channelNames) {
      const indexKey = getChannelIndexKey(channel);
      const metaKey = getChannelMetaKey(channel);
      deletions.push(this.storage.delete(indexKey));
      deletions.push(this.storage.delete(metaKey));
    }

    // Delete the global channel list
    deletions.push(this.storage.delete(CHANNEL_LIST_KEY));

    await Promise.all(deletions);
    console.log('[ChannelManager] All channels deleted');
  }
}
