/**
 * Database Migration Utility
 * Checks and adds missing columns to existing databases
 */

const logger = require("./logger");

/**
 * Check if a column exists in a table
 * @param {Object} db - Database connection
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @returns {Promise<boolean>}
 */
function columnExists(db, tableName, columnName) {
  return new Promise((resolve, reject) => {
    db.get(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      // PRAGMA table_info returns multiple rows, need to get all
      db.all(`PRAGMA table_info(${tableName})`, (err, allRows) => {
        if (err) {
          reject(err);
          return;
        }

        const exists = allRows.some((row) => row.name === columnName);
        resolve(exists);
      });
    });
  });
}

/**
 * Add column to table if it doesn't exist
 * @param {Object} db - Database connection
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @param {string} columnDefinition - Column definition (e.g., "TEXT", "INTEGER DEFAULT 0")
 * @returns {Promise<void>}
 */
async function addColumnIfNotExists(db, tableName, columnName, columnDefinition) {
  try {
    const exists = await columnExists(db, tableName, columnName);
    if (!exists) {
      return new Promise((resolve, reject) => {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`, (err) => {
          if (err) {
            logger.error(`Error adding column ${columnName} to ${tableName}:`, err);
            reject(err);
          } else {
            logger.info(`Added column ${columnName} to ${tableName}`);
            resolve();
          }
        });
      });
    } else {
      logger.debug(`Column ${columnName} already exists in ${tableName}`);
    }
  } catch (error) {
    logger.error(`Error checking/adding column ${columnName}:`, error);
    throw error;
  }
}

/**
 * Migrate portainer_instances table to add missing columns
 * @param {Object} db - Database connection
 * @returns {Promise<void>}
 */
async function migratePortainerInstances(db) {
  try {
    logger.info("Checking portainer_instances table for missing columns...");

    await addColumnIfNotExists(db, "portainer_instances", "api_key", "TEXT");
    await addColumnIfNotExists(db, "portainer_instances", "auth_type", "TEXT DEFAULT 'password'");
    await addColumnIfNotExists(db, "portainer_instances", "ip_address", "TEXT");

    // Update existing rows to have default auth_type if it was just added
    const authTypeExists = await columnExists(db, "portainer_instances", "auth_type");
    if (authTypeExists) {
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE portainer_instances SET auth_type = 'password' WHERE auth_type IS NULL`,
          (err) => {
            if (err && !err.message.includes("no such column")) {
              logger.warn("Error updating auth_type defaults:", err);
            }
            resolve();
          }
        );
      });
    }

    logger.info("Portainer instances table migration complete");
  } catch (error) {
    logger.error("Error migrating portainer_instances table:", error);
    throw error;
  }
}

module.exports = {
  columnExists,
  addColumnIfNotExists,
  migratePortainerInstances,
};
