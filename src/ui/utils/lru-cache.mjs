/**
 * Simple LRU (Least Recently Used) Cache implementation
 * Uses Map to maintain insertion order (keys are iterated in insertion order)
 */
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map(); // Map maintains insertion order
  }

  /**
   * Get value from cache
   * Moves the key to end (most recently used) if found
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set value in cache
   * Evicts oldest entry if cache is full
   */
  set(key, value) {
    // Delete if exists (to re-add at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Add to end
    this.cache.set(key, value);
    // Evict oldest if over size
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Check if key exists in cache
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get current cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Delete a specific key
   */
  delete(key) {
    return this.cache.delete(key);
  }
}
