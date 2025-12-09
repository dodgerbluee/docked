/**
 * Migration Helper Functions
 *
 * Shared utility functions for writing database migrations.
 * These helpers make migrations more readable and reduce boilerplate.
 *
 * Usage in migrations:
 *   const { addColumnIfNotExists, columnExists } = require("./helpers");
 */

const { getDatabase, queueDatabaseOperation } = require("../connection");
const logger = require("../../utils/logger");

/**
 * Check if a column exists in a table
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @returns {Promise<boolean>}
 */
async function columnExists(tableName, columnName) {
  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT name FROM pragma_table_info(?) WHERE name = ?",
        [tableName, columnName],
        (err, row) => {
          if (err) {
            return reject(err);
          }
          resolve(Boolean(row));
        },
      );
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Add a column to a table if it doesn't exist
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @param {string} columnDefinition - Column definition (e.g., "TEXT", "INTEGER DEFAULT 0")
 * @returns {Promise<void>}
 */
async function addColumnIfNotExists(tableName, columnName, columnDefinition) {
  const exists = await columnExists(tableName, columnName);
  if (exists) {
    logger.debug(`Column ${tableName}.${columnName} already exists, skipping`);
    return;
  }

  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`, err => {
        if (err) {
          logger.error(`Error adding column ${tableName}.${columnName}:`, { error: err });
          return reject(err);
        }
        logger.info(`Added column ${tableName}.${columnName}`);
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Check if a table exists
 * @param {string} tableName - Table name
 * @returns {Promise<boolean>}
 */
async function tableExists(tableName) {
  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName],
        (err, row) => {
          if (err) {
            return reject(err);
          }
          resolve(Boolean(row));
        },
      );
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Check if an index exists
 * @param {string} indexName - Index name
 * @returns {Promise<boolean>}
 */
async function indexExists(indexName) {
  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        [indexName],
        (err, row) => {
          if (err) {
            return reject(err);
          }
          resolve(Boolean(row));
        },
      );
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Create an index if it doesn't exist
 * @param {string} indexName - Index name
 * @param {string} tableName - Table name
 * @param {string} columns - Column(s) to index (e.g., "user_id" or "user_id, created_at")
 * @param {boolean} [unique=false] - Whether the index should be unique
 * @returns {Promise<void>}
 */

async function createIndexIfNotExists(indexName, tableName, columns, unique = false) {
  const exists = await indexExists(indexName);
  if (exists) {
    logger.debug(`Index ${indexName} already exists, skipping`);
    return;
  }

  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const uniqueClause = unique ? "UNIQUE" : "";
      db.run(
        `CREATE ${uniqueClause} INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columns})`,
        err => {
          if (err) {
            logger.error(`Error creating index ${indexName}:`, { error: err });
            return reject(err);
          }
          logger.info(`Created index ${indexName}`);
          resolve();
        },
      );
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Execute raw SQL (use with caution)
 * @param {string} sql - SQL statement
 * @param {Array} [params=[]] - Parameters for the SQL statement
 * @returns {Promise<void>}
 */
async function executeSql(sql, params = []) {
  return queueDatabaseOperation(() => new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(sql, params, err => {
        if (err) {
          logger.error("Error executing SQL:", { sql, params, error: err });
          return reject(err);
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  }));
}

module.exports = {
  columnExists,
  addColumnIfNotExists,
  tableExists,
  indexExists,
  createIndexIfNotExists,
  executeSql,
};
