/**
 * Container Cache Service
 *
 * In-memory cache bookkeeping for container data. The container read path
 * itself is served by the Go GraphQL backend; this module only tracks the
 * Node-side memory cache so writers (upgrade pipeline) and admin tooling
 * (debug routes) can invalidate and inspect it.
 */

const logger = require("../../utils/logger");

// Memory cache with TTL
const memoryCache = new Map();

/**
 * Invalidate memory cache for a container or all containers
 *
 * @param {number} userId - User ID
 * @param {string|null} containerId - Container ID (null for all)
 * @param {string|null} sourceUrl - Source URL (null for all)
 */
function invalidateCache(userId, containerId = null, sourceUrl = null) {
  if (containerId) {
    // Invalidate specific container - clear all cache entries for this user
    const keys = Array.from(memoryCache.keys());
    keys.forEach((key) => {
      if (key.includes(`_${userId}_`)) {
        memoryCache.delete(key);
      }
    });
  } else if (sourceUrl) {
    // Invalidate cache for specific source URL
    const cacheKey = `containers_${userId}_${sourceUrl}`;
    memoryCache.delete(cacheKey);
    // Also clear the "all" cache for this user
    const allCacheKey = `containers_${userId}_all`;
    memoryCache.delete(allCacheKey);
  } else {
    // Invalidate all cache entries for this user (no containerId, no sourceUrl)
    const keys = Array.from(memoryCache.keys());
    keys.forEach((key) => {
      if (key.startsWith(`containers_${userId}_`)) {
        memoryCache.delete(key);
      }
    });
  }

  logger.debug("Invalidated memory cache", { userId, containerId, sourceUrl });
}

/**
 * Clear all memory cache
 */
function clearMemoryCache() {
  memoryCache.clear();
  logger.debug("Cleared all memory cache");
}

/**
 * Return the current number of entries in the memory cache.
 * @returns {number}
 */
function getMemoryCacheSize() {
  return memoryCache.size;
}

module.exports = {
  invalidateCache,
  clearMemoryCache,
  getMemoryCacheSize,
};
