import { regex } from '../common/hashtag.mjs';
// ===============================
// Hashtag Management Module
// ===============================
//
// This module provides hashtag extraction, indexing, and retrieval functionality
// for the chat application. It allows users to tag messages and quickly find
// related conversations.

/**
 * Extract hashtags from a text message
 * Supports alphanumeric characters, underscores, and Chinese characters
 * @param {string} text - The message text to parse
 * @returns {string[]} - Array of unique hashtags (lowercase, without #)
 */
export function extractHashtags(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Match #word patterns, supporting:
  // - English letters (a-z, A-Z)
  // - Numbers (0-9)
  // - Underscores (_)
  // - Hyphens (-)
  // - Chinese characters (Unicode range \u4e00-\u9fa5)
  // Minimum length: 2 characters after #
  const matches = [...text.matchAll(regex)];

  // Extract unique hashtags, convert to lowercase for consistency
  const tags = matches.map(m => m[1].toLowerCase());
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Storage key prefix for hashtag indexes
 */
const HASHTAG_INDEX_PREFIX = 'hashtag:';
const HASHTAG_META_PREFIX = 'hashtag_meta:';
const HASHTAG_LIST_KEY = 'hashtags:all';

/**
 * Generate storage key for a hashtag index
 * @param {string} tag - The hashtag (without #)
 * @returns {string} - Storage key
 */
export function getHashtagIndexKey(tag) {
  return HASHTAG_INDEX_PREFIX + tag.toLowerCase();
}

/**
 * Generate storage key for hashtag metadata
 * @param {string} tag - The hashtag (without #)
 * @returns {string} - Storage key
 */
export function getHashtagMetaKey(tag) {
  return HASHTAG_META_PREFIX + tag.toLowerCase();
}

/**
 * HashtagManager class - manages hashtag indexing and retrieval
 */
export class HashtagManager {
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Index hashtags from a message
   * @param {string} messageKey - The storage key of the message (ISO timestamp)
   * @param {string} messageText - The message content
   * @param {number} timestamp - Message timestamp
   */
  async indexMessage(messageKey, messageText, timestamp) {
    const tags = extractHashtags(messageText);

    if (tags.length === 0) {
      return;
    }

    // Update each hashtag's index
    const updates = [];
    for (const tag of tags) {
      updates.push(this.addMessageToTag(tag, messageKey, timestamp));
    }

    await Promise.all(updates);
  }

  /**
   * Add a message to a hashtag's index
   * @param {string} tag - The hashtag (without #)
   * @param {string} messageKey - The storage key of the message
   * @param {number} timestamp - Message timestamp
   */
  async addMessageToTag(tag, messageKey, timestamp) {
    const indexKey = getHashtagIndexKey(tag);
    const metaKey = getHashtagMetaKey(tag);

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

      // Keep only the latest 1000 messages per tag to avoid unbounded growth
      if (index.length > 1000) {
        index = index.slice(-1000);
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

    await this.storage.put(metaKey, JSON.stringify(meta));

    // Update the global hashtag list
    await this.updateHashtagList(tag, timestamp);
  }

  /**
   * Update the global list of all hashtags
   * @param {string} tag - The hashtag to add
   * @param {number} timestamp - Last used timestamp
   */
  async updateHashtagList(tag, timestamp) {
    let allTags = await this.storage.get(HASHTAG_LIST_KEY);
    if (!allTags) {
      allTags = {};
    } else if (typeof allTags === 'string') {
      allTags = JSON.parse(allTags);
    }

    allTags[tag] = timestamp;

    await this.storage.put(HASHTAG_LIST_KEY, JSON.stringify(allTags));
  }

  /**
   * Get all hashtags used in this room
   * @param {number} limit - Maximum number of tags to return
   * @returns {Promise<Array>} - Array of {tag, count, lastUsed}
   */
  async getAllHashtags(limit = 100) {
    const allTags = await this.storage.get(HASHTAG_LIST_KEY);
    if (!allTags) {
      return [];
    }

    const tagList = typeof allTags === 'string' ? JSON.parse(allTags) : allTags;
    const tagNames = Object.keys(tagList);

    // Fetch metadata for all tags
    const metaPromises = tagNames.map(async (tag) => {
      const metaKey = getHashtagMetaKey(tag);
      let meta = await this.storage.get(metaKey);

      if (!meta) {
        return { tag, count: 0, lastUsed: tagList[tag] };
      }

      if (typeof meta === 'string') {
        meta = JSON.parse(meta);
      }

      return {
        tag,
        count: meta.count || 0,
        lastUsed: meta.lastUsed || tagList[tag]
      };
    });

    const results = await Promise.all(metaPromises);

    // Sort by last used (most recent first)
    results.sort((a, b) => b.lastUsed - a.lastUsed);

    return results.slice(0, limit);
  }

  /**
   * Get all messages associated with a specific hashtag
   * @param {string} tag - The hashtag (without #)
   * @param {number} limit - Maximum number of messages to return
   * @returns {Promise<Array>} - Array of message data
   */
  async getMessagesForTag(tag, limit = 100) {
    const indexKey = getHashtagIndexKey(tag);
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
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        messages.push(data);
      }
    }

    return messages;
  }

  /**
   * Search hashtags by prefix
   * @param {string} prefix - The search prefix (without #)
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Array of matching {tag, count, lastUsed}
   */
  async searchHashtags(prefix, limit = 10) {
    const allTags = await this.getAllHashtags(1000);

    if (!prefix) {
      return allTags.slice(0, limit);
    }

    const normalizedPrefix = prefix.toLowerCase();
    const matches = allTags.filter(item =>
      item.tag.toLowerCase().startsWith(normalizedPrefix)
    );

    return matches.slice(0, limit);
  }

  /**
   * Get statistics for a specific hashtag
   * @param {string} tag - The hashtag (without #)
   * @returns {Promise<Object|null>} - Metadata object or null
   */
  async getHashtagStats(tag) {
    const metaKey = getHashtagMetaKey(tag);
    let meta = await this.storage.get(metaKey);

    if (!meta) {
      return null;
    }

    if (typeof meta === 'string') {
      meta = JSON.parse(meta);
    }

    return {
      tag,
      count: meta.count || 0,
      firstUsed: meta.firstUsed || null,
      lastUsed: meta.lastUsed || null
    };
  }
}
