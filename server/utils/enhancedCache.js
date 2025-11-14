/**
 * Enhanced Cache Implementation with Metrics
 * Provides caching with hit/miss tracking, TTL management, and size limits
 */

class EnhancedCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 1000; // Maximum number of entries
    this.defaultTTL = options.defaultTTL || 3600000; // 1 hour default
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: 0,
    };
    this.lastCleanup = Date.now();
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found/expired
   */
  get(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      this.metrics.misses++;
      return null;
    }

    // Check if expired
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.cache.delete(key);
      this.metrics.misses++;
      this.metrics.size = this.cache.size;
      return null;
    }

    // Cache hit
    this.metrics.hits++;
    return cached.value;
  }

  /**
   * Check if a key exists and is valid
   * @param {string} key - Cache key
   * @returns {boolean} - True if key exists and is not expired
   */
  has(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return false;
    }

    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.cache.delete(key);
      this.metrics.size = this.cache.size;
      return false;
    }

    return true;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional, uses default if not provided)
   */
  set(key, value, ttl = null) {
    // Evict if at max size (LRU - remove oldest)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });

    this.metrics.sets++;
    this.metrics.size = this.cache.size;

    // Periodic cleanup
    this.cleanupIfNeeded();
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if key was deleted
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.metrics.deletes++;
      this.metrics.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.metrics.size = 0;
  }

  /**
   * Get cache size
   * @returns {number} - Number of entries in cache
   */
  size() {
    return this.cache.size;
  }

  /**
   * Get cache metrics
   * @returns {Object} - Cache metrics
   */
  getMetrics() {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 ? (this.metrics.hits / totalRequests) * 100 : 0;

    return {
      ...this.metrics,
      hitRate: hitRate.toFixed(2) + '%',
      totalRequests,
    };
  }

  /**
   * Evict oldest entry (LRU)
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metrics.evictions++;
    }
  }

  /**
   * Clean up expired entries periodically
   */
  cleanupIfNeeded() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    this.lastCleanup = now;
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    this.metrics.size = this.cache.size;

    if (cleaned > 0) {
      const logger = require('./logger');
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`, {
        module: 'cache',
        remaining: this.cache.size,
      });
    }
  }

  /**
   * Get all keys in cache
   * @returns {Array<string>} - Array of cache keys
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache statistics for monitoring
   * @returns {Object} - Cache statistics
   */
  getStats() {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 ? (this.metrics.hits / totalRequests) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: hitRate.toFixed(2) + '%',
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      evictions: this.metrics.evictions,
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(2) + '%',
    };
  }
}

module.exports = EnhancedCache;

