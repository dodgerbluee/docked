/**
 * Base Repository
 * Abstract base class for repository pattern
 * Provides common database operations, transaction support, and query optimization
 */

const { DatabaseError } = require('../domain/errors');
const logger = require('../utils/logger');

// Simple query result cache (can be enhanced with Redis later)
const queryCache = new Map();
const CACHE_TTL = 5000; // 5 seconds for query results

/**
 * Base Repository class
 * All repositories should extend this class
 */
class BaseRepository {
  constructor(db) {
    if (!db) {
      throw new DatabaseError('Database connection required');
    }
    this.db = db;
  }

  /**
   * Execute a query and return a single row
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options (cache: boolean, cacheKey: string)
   * @returns {Promise<Object|null>} - Single row or null
   */
  async findOne(sql, params = [], options = {}) {
    // Check cache if enabled
    if (options.cache && options.cacheKey) {
      const cacheKey = `${options.cacheKey}:${JSON.stringify(params)}`;
      const cached = queryCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.value;
      }
    }

    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database query error', {
            module: 'BaseRepository',
            operation: 'findOne',
            error: err,
            sql: sql.substring(0, 100), // Log first 100 chars of SQL
          });
          reject(new DatabaseError(`Query failed: ${err.message}`, err));
        } else {
          const result = row || null;
          
          // Cache result if enabled
          if (options.cache && options.cacheKey) {
            const cacheKey = `${options.cacheKey}:${JSON.stringify(params)}`;
            queryCache.set(cacheKey, {
              value: result,
              timestamp: Date.now(),
            });
          }
          
          resolve(result);
        }
      });
    });
  }

  /**
   * Execute a query and return all rows
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options (cache: boolean, cacheKey: string)
   * @returns {Promise<Array>} - Array of rows
   */
  async findAll(sql, params = [], options = {}) {
    // Check cache if enabled
    if (options.cache && options.cacheKey) {
      const cacheKey = `${options.cacheKey}:${JSON.stringify(params)}`;
      const cached = queryCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.value;
      }
    }

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database query error', {
            module: 'BaseRepository',
            operation: 'findAll',
            error: err,
            sql: sql.substring(0, 100),
          });
          reject(new DatabaseError(`Query failed: ${err.message}`, err));
        } else {
          const result = rows || [];
          
          // Cache result if enabled
          if (options.cache && options.cacheKey) {
            const cacheKey = `${options.cacheKey}:${JSON.stringify(params)}`;
            queryCache.set(cacheKey, {
              value: result,
              timestamp: Date.now(),
            });
          }
          
          resolve(result);
        }
      });
    });
  }

  /**
   * Invalidate cache for a specific key pattern
   * @param {string} pattern - Cache key pattern (will match keys starting with pattern)
   */
  static invalidateCache(pattern) {
    for (const key of queryCache.keys()) {
      if (key.startsWith(pattern)) {
        queryCache.delete(key);
      }
    }
  }

  /**
   * Clear all query cache
   */
  static clearCache() {
    queryCache.clear();
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} - Result with lastID and changes
   */
  async execute(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database execute error', {
            module: 'BaseRepository',
            operation: 'execute',
            error: err,
            sql: sql.substring(0, 100),
          });
          reject(new DatabaseError(`Execute failed: ${err.message}`, err));
        } else {
          resolve({
            lastID: this.lastID,
            changes: this.changes,
          });
        }
      });
    });
  }

  /**
   * Begin a transaction
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to begin transaction: ${err.message}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Commit a transaction
   * @returns {Promise<void>}
   */
  async commit() {
    return new Promise((resolve, reject) => {
      this.db.run('COMMIT', (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to commit transaction: ${err.message}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Rollback a transaction
   * @returns {Promise<void>}
   */
  async rollback() {
    return new Promise((resolve, reject) => {
      this.db.run('ROLLBACK', (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to rollback transaction: ${err.message}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Execute a function within a transaction
   * @param {Function} fn - Function to execute
   * @returns {Promise<*>} - Result of function
   */
  async transaction(fn) {
    await this.beginTransaction();
    try {
      const result = await fn();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Prepare a statement for repeated execution
   * @param {string} sql - SQL query
   * @returns {Promise<Object>} - Prepared statement
   */
  async prepare(sql) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(sql, (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to prepare statement: ${err.message}`, err));
        } else {
          resolve(stmt);
        }
      });
    });
  }
}

module.exports = BaseRepository;

