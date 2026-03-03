/**
 * VirtualMessageList - A unified sorted message collection
 *
 * Manages all message types (regular, temp, system) in a single
 * sorted-by-timestamp array. Insertions maintain sort order via
 * binary search, avoiding full re-sort on every render.
 *
 * @example
 * const vml = new VirtualMessageList();
 * vml.addItem({ messageId: 'msg-1', timestamp: 1000, message: 'hello' });
 * vml.addSystemMessage('* Alice joined', 'general');
 * const items = vml.getItemsByChannel('general');
 */

/**
 * @typedef {'regular'|'temp'|'system'} MessageType
 */

/**
 * @typedef {Object} VirtualMessage
 * @property {string} messageId
 * @property {number} timestamp
 * @property {string} channel
 * @property {MessageType} _type - Internal type discriminator
 * @property {boolean} [_isSystem] - True for system messages
 * @property {boolean} [_isTemp] - True for temp messages
 * @property {string} [name] - Username (regular/temp messages)
 * @property {string} [message] - Message text
 */

export class VirtualMessageList {
  constructor() {
    /** @type {VirtualMessage[]} Sorted by timestamp ascending */
    this._items = [];
    /** @type {number} Monotonic counter to break timestamp ties */
    this._seq = 0;
  }

  /**
   * Binary search for insertion index to maintain timestamp sort order.
   * Uses _seq as tie-breaker for items with equal timestamps.
   * @param {number} timestamp
   * @param {number} seq
   * @returns {number} Index to insert at
   */
  _findInsertIndex(timestamp, seq) {
    let lo = 0;
    let hi = this._items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = this._items[mid];
      if (m.timestamp < timestamp || (m.timestamp === timestamp && (m._seq || 0) <= seq)) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Insert a single item at the correct sorted position.
   * @param {VirtualMessage} item
   */
  _insertSorted(item) {
    item._seq = this._seq++;
    const idx = this._findInsertIndex(item.timestamp, item._seq);
    this._items.splice(idx, 0, item);
  }

  /**
   * Add a regular message (from TinyBase).
   * @param {Object} msg - RawMessage-like object
   */
  addItem(msg) {
    this._insertSorted({ ...msg, _type: 'regular' });
  }

  /**
   * Add a temporary (optimistic) message.
   * @param {Object} msg - Message object with _isTemp marker
   */
  addTempItem(msg) {
    this._insertSorted({ ...msg, _type: 'temp', _isTemp: true });
  }

  /**
   * Add a system message (join/quit/welcome).
   * @param {string} text - System message text
   * @param {string} channel - Channel where the message should appear
   * @returns {string} Generated message ID
   */
  addSystemMessage(text, channel) {
    const sysId = `sys-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._insertSorted({
      messageId: sysId,
      message: text,
      timestamp: Date.now(),
      channel: channel,
      _type: 'system',
      _isSystem: true,
    });
    return sysId;
  }

  /**
   * Bulk-replace all regular messages (e.g. after TinyBase sync).
   * Keeps temp and system items, merges in new regular items using
   * linear merge (O(n)) since both arrays are already sorted.
   * @param {Object[]} regularItems - Array of regular messages (already sorted by timestamp)
   */
  setRegularItems(regularItems) {
    // Keep non-regular items (already sorted within _items)
    const kept = this._items.filter((it) => it._type !== 'regular');
    // Tag incoming items with _type
    const tagged = regularItems.map((msg) => ({ ...msg, _type: 'regular' }));

    // Linear merge of two sorted arrays
    const merged = [];
    let i = 0;
    let j = 0;
    while (i < kept.length && j < tagged.length) {
      if (kept[i].timestamp <= tagged[j].timestamp) {
        merged.push(kept[i++]);
      } else {
        merged.push(tagged[j++]);
      }
    }
    while (i < kept.length) merged.push(kept[i++]);
    while (j < tagged.length) merged.push(tagged[j++]);

    this._items = merged;
  }

  /**
   * Remove an item by messageId.
   * @param {string} messageId
   */
  removeItem(messageId) {
    const idx = this._items.findIndex((it) => it.messageId === messageId);
    if (idx !== -1) {
      this._items.splice(idx, 1);
    }
  }

  /**
   * Update a temp message in-place.
   * @param {string} messageId
   * @param {Object} updates - Partial fields to merge
   */
  updateTempItem(messageId, updates) {
    const idx = this._items.findIndex((it) => it.messageId === messageId);
    if (idx !== -1) {
      this._items[idx] = { ...this._items[idx], ...updates };
    }
  }

  /**
   * Get all items for a given channel, already sorted by timestamp.
   * @param {string} channel
   * @returns {VirtualMessage[]}
   */
  getItemsByChannel(channel) {
    const lc = channel.toLowerCase();
    return this._items.filter(
      (it) => (it.channel || 'general').toLowerCase() === lc,
    );
  }

  /**
   * Get the full sorted list (all channels).
   * @returns {VirtualMessage[]}
   */
  getAllItems() {
    return this._items;
  }

  /**
   * Clear all items of a given type.
   * @param {MessageType} type
   */
  clearType(type) {
    this._items = this._items.filter((it) => it._type !== type);
  }

  /**
   * Clear everything.
   */
  clear() {
    this._items = [];
  }

  /**
   * Number of items.
   */
  get length() {
    return this._items.length;
  }
}
