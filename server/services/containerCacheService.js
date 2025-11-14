/**
 * Container Cache Service
 * Abstracts container cache operations from direct database access
 */

const { db } = require('../db/database');
const logger = require('../utils/logger');

class ContainerCacheService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Get container cache by key
   * @param {string} cacheKey - Cache key
   * @returns {Promise<Object|null>} - Cached data or null
   */
  async get(cacheKey) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT cache_data, updated_at FROM container_cache WHERE cache_key = ?',
        [cacheKey],
        (err, row) => {
          if (err) {
            logger.error('Error getting container cache', {
              module: 'ContainerCacheService',
              operation: 'get',
              cacheKey,
              error: err,
            });
            reject(err);
          } else if (row) {
            try {
              const data = JSON.parse(row.cache_data);
              resolve(data);
            } catch (parseError) {
              logger.error('Error parsing container cache data', {
                module: 'ContainerCacheService',
                operation: 'get',
                cacheKey,
                error: parseError,
              });
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Set container cache
   * @param {string} cacheKey - Cache key
   * @param {Object} data - Data to cache
   * @returns {Promise<void>}
   */
  async set(cacheKey, data) {
    return new Promise((resolve, reject) => {
      const dataString = JSON.stringify(data);
      this.db.run(
        'INSERT OR REPLACE INTO container_cache (cache_key, cache_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [cacheKey, dataString],
        (err) => {
          if (err) {
            logger.error('Error setting container cache', {
              module: 'ContainerCacheService',
              operation: 'set',
              cacheKey,
              error: err,
            });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Clear all container cache
   * @returns {Promise<void>}
   */
  async clear() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM container_cache', [], (err) => {
        if (err) {
          logger.error('Error clearing container cache', {
            module: 'ContainerCacheService',
            operation: 'clear',
            error: err,
          });
          reject(err);
        } else {
          logger.info('Container cache cleared', {
            module: 'ContainerCacheService',
            operation: 'clear',
          });
          resolve();
        }
      });
    });
  }

  /**
   * Clear specific cache entry
   * @param {string} cacheKey - Cache key to clear
   * @returns {Promise<void>}
   */
  async clearKey(cacheKey) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM container_cache WHERE cache_key = ?', [cacheKey], (err) => {
        if (err) {
          logger.error('Error clearing container cache key', {
            module: 'ContainerCacheService',
            operation: 'clearKey',
            cacheKey,
            error: err,
          });
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = ContainerCacheService;

