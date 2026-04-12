/**
 * Reaction Manager - RxDB-based
 * Manages message reactions using the compat store layer
 */

import { REACTION_TYPES, REACTION_ORDER } from './config.mjs';

/**
 * ReactionManager class
 * Handles all reaction operations using the RxDB compat store
 */
export class ReactionManager {
  constructor(store, relationships, indexes, getCurrentUsername) {
    this.store = store;
    // relationships and indexes params kept for API compat but not used
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

    this.store.setRow('reactions', rowId, {
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
      this.store.delRow('reactions', reactionRowId);
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
    // Scan reactions table for matching row
    const table = this.store.getTable('reactions');
    for (const [rowId, data] of Object.entries(table)) {
      if (
        data.messageId === messageId &&
        data.reactionId === reactionId &&
        data.username === username
      ) {
        return rowId;
      }
    }
    return null;
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

    // Get all reactions for this message from the reactions table
    const table = this.store.getTable('reactions');
    const reactions = Object.values(table).filter(
      (r) => r.messageId === messageId,
    );

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

    // Return in consistent order
    const result = REACTION_ORDER.map((id) => grouped[id]).filter(Boolean);
    return result;
  }

  /**
   * Get total reaction count for a message
   * @param {string} messageId - Message ID
   * @returns {number}
   */
  getReactionCount(messageId) {
    const table = this.store.getTable('reactions');
    return Object.values(table).filter((r) => r.messageId === messageId).length;
  }

  /**
   * Get all reaction types a user has added to a message
   * @param {string} messageId - Message ID
   * @param {string} username - Username (optional)
   * @returns {Array<string>} - Array of reaction IDs
   */
  getUserReactionsOnMessage(messageId, username = null) {
    const user = username || this.getCurrentUsername();
    const table = this.store.getTable('reactions');
    return Object.values(table)
      .filter((r) => r.messageId === messageId && r.username === user)
      .map((r) => r.reactionId);
  }

  /**
   * Delete all reactions for a message (cascade delete)
   * Call this when deleting a message
   * @param {string} messageId - Message ID
   */
  deleteMessageReactions(messageId) {
    const table = this.store.getTable('reactions');
    const rowIds = Object.entries(table)
      .filter(([, data]) => data.messageId === messageId)
      .map(([id]) => id);

    rowIds.forEach((id) => {
      this.store.delRow('reactions', id);
    });
    console.log(
      `🗑️ Cascade deleted ${rowIds.length} reactions for message ${messageId}`,
    );
  }
}
