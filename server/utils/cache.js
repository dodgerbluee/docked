/**
 * Simple in-memory cache implementation
 */

class Cache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get raw cache entry (for debugging)
   * @param {string} key - Cache key
   * @returns {Object|null} - Raw cache entry or null
   */
  getEntry(key) {
    return this.cache.get(key) || null;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found/expired
   */
  get(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if expired
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Return cached value (still valid)
    return cached.value;
  }

  /**
   * Check if a key exists in cache and is valid
   * @param {string} key - Cache key
   * @returns {boolean} - True if key exists and is not expired
   */
  has(key) {
    const cached = this.cache.get(key);
    return cached !== null;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds
   */
  set(key, value, ttl) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   * @returns {number} - Number of entries in cache
   */
  size() {
    return this.cache.size;
  }
}

module.exports = Cache;

