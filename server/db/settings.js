/**
 * Settings Database Module
 *
 * Handles all settings-related database operations including:
 * - User-specific settings
 * - System-wide settings
 */

const { getDatabase } = require("./connection");

/**
 * Get a user setting
 * @param {string} key - Setting key
 * @param {number} userId - User ID
 * @returns {Promise<string|null>} - Setting value or null
 */
function getSetting(key, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT value FROM settings WHERE key = ? AND user_id = ?",
        [key, userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? row.value : null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Set a user setting
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function setSetting(key, value, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        [userId, key, value],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a system setting (user_id = 0)
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} - Setting value or null
 */
function getSystemSetting(key) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT value FROM settings WHERE key = ? AND user_id = 0", [key], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.value : null);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Set a system setting (user_id = 0)
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<void>}
 */
function setSystemSetting(key, value) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (0, ?, ?, CURRENT_TIMESTAMP)",
        [key, value],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getSetting,
  setSetting,
  getSystemSetting,
  setSystemSetting,
};
