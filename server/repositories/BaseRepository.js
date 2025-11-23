/**
 * Base Repository
 * Provides common database operations for all repositories
 * Abstracts database connection and provides consistent error handling
 */

const { getDatabase } = require("../db/connection");
const logger = require("../utils/logger");

// Simple in-memory cache for query results
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class BaseRepository {
  /**
   * Get database connection
   * @returns {Object} Database connection instance
   */
  getDb() {
    return getDatabase();
  }

  /**
   * Execute a query and return results
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result with lastID and changes
   */
  async execute(query, params = []) {
    return new Promise((resolve, reject) => {
      const db = this.getDb();
      if (!db) {
        return reject(new Error("Database connection not available"));
      }

      db.run(query, params, function (err) {
        if (err) {
          logger.error("Database execute error", {
            query: query.substring(0, 100),
            error: err.message,
            params: params.length,
          });
          return reject(err);
        }
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  /**
   * Find one record
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Options (cache, cacheKey)
   * @returns {Promise<Object|null>} Record or null
   */
  async findOne(query, params = [], options = {}) {
    // Check cache if enabled
    if (options.cache && options.cacheKey) {
      const cached = cache.get(options.cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    return new Promise((resolve, reject) => {
      const db = this.getDb();
      if (!db) {
        return reject(new Error("Database connection not available"));
      }

      db.get(query, params, (err, row) => {
        if (err) {
          logger.error("Database findOne error", {
            query: query.substring(0, 100),
            error: err.message,
            params: params.length,
          });
          return reject(err);
        }

        // Cache result if enabled
        if (options.cache && options.cacheKey) {
          cache.set(options.cacheKey, {
            data: row || null,
            timestamp: Date.now(),
          });
        }

        resolve(row || null);
      });
    });
  }

  /**
   * Find all records
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Options (cache, cacheKey)
   * @returns {Promise<Array>} Array of records
   */
  async findAll(query, params = [], options = {}) {
    // Check cache if enabled
    if (options.cache && options.cacheKey) {
      const cached = cache.get(options.cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    return new Promise((resolve, reject) => {
      const db = this.getDb();
      if (!db) {
        return reject(new Error("Database connection not available"));
      }

      db.all(query, params, (err, rows) => {
        if (err) {
          logger.error("Database findAll error", {
            query: query.substring(0, 100),
            error: err.message,
            params: params.length,
          });
          return reject(err);
        }

        // Cache result if enabled
        if (options.cache && options.cacheKey) {
          cache.set(options.cacheKey, {
            data: rows || [],
            timestamp: Date.now(),
          });
        }

        resolve(rows || []);
      });
    });
  }

  /**
   * Execute a transaction
   * @param {Function} callback - Transaction callback
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    return new Promise((resolve, reject) => {
      const db = this.getDb();
      if (!db) {
        return reject(new Error("Database connection not available"));
      }

      db.serialize(() => {
        db.run("BEGIN IMMEDIATE TRANSACTION", (err) => {
          if (err) {
            return reject(err);
          }

          // Execute callback
          Promise.resolve(callback(this))
            .then((result) => {
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  db.run("ROLLBACK", () => {
                    reject(commitErr);
                  });
                } else {
                  resolve(result);
                }
              });
            })
            .catch((error) => {
              db.run("ROLLBACK", () => {
                reject(error);
              });
            });
        });
      });
    });
  }

  /**
   * Invalidate cache entries matching a prefix
   * @param {string} prefix - Cache key prefix
   */
  static invalidateCache(prefix) {
    const keysToDelete = [];
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => cache.delete(key));
    logger.debug(`Invalidated ${keysToDelete.length} cache entries with prefix: ${prefix}`);
  }

  /**
   * Clear all cache
   */
  static clearCache() {
    cache.clear();
    logger.debug("Cleared all cache");
  }
}

module.exports = BaseRepository;
