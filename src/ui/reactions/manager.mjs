/**
 * Reaction Manager - TinyBase Relationships
 * Manages message reactions with foreign key relationships
 */

import { REACTION_TYPES, REACTION_ORDER } from './config.mjs';

/**
 * ReactionManager class
 * Handles all reaction operations using TinyBase store, relationships, and indexes
 */
export class ReactionManager {
  constructor(store, relationships, indexes, getCurrentUsername) {
    this.store = store;
    this.relationships = relationships;
    this.indexes = indexes;
    this.getCurrentUsername = getCurrentUsername;
  }

  /**
   * Generate unique reaction ID
   */
  generateReactionId() {
    return `reaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add a reaction to a message
   * @param {string} messageId - Message ID
   * @param {string} reactionId - Reaction type ID (like, love, etc.)
   * @param {string} username - Username (optional, defaults to current user)
   * @returns {string|null} - Created reaction instance ID or null if failed
   */
  addReaction(messageId, reactionId, username = null) {
    // Validate reaction type
    if (!REACTION_TYPES[reactionId]) {
      console.error('Invalid reaction ID:', reactionId);
      return null;
    }

    // Check if message exists
    if (!this.store.hasRow('messages', messageId)) {
      console.error('Message not found:', messageId);
      return null;
    }

    const user = username || this.getCurrentUsername();

    // Check for duplicate
    if (this.hasUserReacted(messageId, reactionId, user)) {
      console.log('User already reacted with this type');
      return null;
    }

    const rowId = this.generateReactionId();

    this.store.setRow('reaction_instances', rowId, {
      messageId,
      reactionId,
      username: user,
      timestamp: Date.now(),
    });

    console.log(`✅ Added reaction: ${reactionId} by ${user} on ${messageId}`);
    return rowId;
  }

  /**
   * Remove a reaction from a message
   * @param {string} messageId - Message ID
   * @param {string} reactionId - Reaction type ID
   * @param {string} username - Username (optional)
   * @returns {boolean} - True if removed, false if not found
   */
  removeReaction(messageId, reactionId, username = null) {
    const user = username || this.getCurrentUsername();

    const reactionRowId = this.findUserReaction(messageId, reactionId, user);

    if (reactionRowId) {
      this.store.delRow('reaction_instances', reactionRowId);
      console.log(
        `🗑️ Removed reaction: ${reactionId} by ${user} on ${messageId}`,
      );
      return true;
    }

    return false;
  }

  /**
   * Toggle a reaction (add if not exists, remove if exists)
   * @param {string} messageId - Message ID
   * @param {string} reactionId - Reaction type ID
   * @param {string} username - Username (optional)
   * @returns {boolean} - True if added, false if removed
   */
  toggleReaction(messageId, reactionId, username = null) {
    const user = username || this.getCurrentUsername();

    if (this.hasUserReacted(messageId, reactionId, user)) {
      this.removeReaction(messageId, reactionId, user);
      return false; // Removed
    } else {
      this.addReaction(messageId, reactionId, user);
      return true; // Added
    }
  }

  /**
   * Find a user's specific reaction instance ID
   * @param {string} messageId - Message ID
   * @param {string} reactionId - Reaction type ID
   * @param {string} username - Username
   * @returns {string|null} - Reaction instance ID or null
   */
  findUserReaction(messageId, reactionId, username) {
    const key = `${messageId}:${reactionId}:${username}`;
    const rowIds = this.indexes.getSliceRowIds(
      'reactionsByMessageAndType',
      key,
    );
    return rowIds[0] || null;
  }

  /**
   * Check if user has reacted with a specific reaction type
   * @param {string} messageId - Message ID
   * @param {string} reactionId - Reaction type ID
   * @param {string} username - Username (optional)
   * @returns {boolean}
   */
  hasUserReacted(messageId, reactionId, username = null) {
    const user = username || this.getCurrentUsername();
    return !!this.findUserReaction(messageId, reactionId, user);
  }

  /**
   * Get all reactions for a message (grouped by reaction type)
   * @param {string} messageId - Message ID
   * @returns {Array} - Array of reaction groups with counts and users
   */
  getReactions(messageId) {
    const currentUser = this.getCurrentUsername();

    // Use index for O(log n) query
    const rowIds = this.indexes.getSliceRowIds('reactionsByMessage', messageId);
    console.log(
      `🔍 getReactions(${messageId}): found ${rowIds.length} reaction instances`,
      rowIds,
    );
    const reactions = rowIds.map((id) =>
      this.store.getRow('reaction_instances', id),
    );
    console.log(`📊 Raw reactions:`, reactions);

    // Group by reactionId
    const grouped = {};
    reactions.forEach((r) => {
      if (!grouped[r.reactionId]) {
        grouped[r.reactionId] = {
          reactionId: r.reactionId,
          config: REACTION_TYPES[r.reactionId],
          count: 0,
          users: [],
          userReacted: false,
        };
      }
      grouped[r.reactionId].count++;
      grouped[r.reactionId].users.push(r.username);
      if (r.username === currentUser) {
        grouped[r.reactionId].userReacted = true;
      }
    });

    console.log(`📦 Grouped reactions:`, grouped);

    // Return in consistent order
    const result = REACTION_ORDER.map((id) => grouped[id]).filter(Boolean);
    console.log(`✅ Final result:`, result);
    return result;
  }

  /**
   * Get total reaction count for a message
   * @param {string} messageId - Message ID
   * @returns {number}
   */
  getReactionCount(messageId) {
    const rowIds = this.indexes.getSliceRowIds('reactionsByMessage', messageId);
    return rowIds.length;
  }

  /**
   * Get all reaction types a user has added to a message
   * @param {string} messageId - Message ID
   * @param {string} username - Username (optional)
   * @returns {Array<string>} - Array of reaction IDs
   */
  getUserReactionsOnMessage(messageId, username = null) {
    const user = username || this.getCurrentUsername();
    const rowIds = this.indexes.getSliceRowIds('reactionsByMessage', messageId);

    return rowIds
      .map((id) => this.store.getRow('reaction_instances', id))
      .filter((r) => r.username === user)
      .map((r) => r.reactionId);
  }

  /**
   * Delete all reactions for a message (cascade delete)
   * Call this when deleting a message
   * @param {string} messageId - Message ID
   */
  deleteMessageReactions(messageId) {
    const rowIds = this.indexes.getSliceRowIds('reactionsByMessage', messageId);
    rowIds.forEach((id) => {
      this.store.delRow('reaction_instances', id);
    });
    console.log(
      `🗑️ Cascade deleted ${rowIds.length} reactions for message ${messageId}`,
    );
  }
}
