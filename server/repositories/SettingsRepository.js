/**
 * Settings Repository
 * Handles all settings-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const settingsDb = require("../db/settings");

class SettingsRepository extends BaseRepository {
  /**
   * Get a user setting
   * @param {string} key - Setting key
   * @param {number} userId - User ID
   * @returns {Promise<string|null>} - Setting value or null
   */
  get(key, userId) {
    return settingsDb.getSetting(key, userId);
  }

  /**
   * Set a user setting
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  set(key, value, userId) {
    return settingsDb.setSetting(key, value, userId);
  }

  /**
   * Get a system setting (user_id = 0)
   * @param {string} key - Setting key
   * @returns {Promise<string|null>} - Setting value or null
   */
  getSystem(key) {
    return settingsDb.getSystemSetting(key);
  }

  /**
   * Set a system setting (user_id = 0)
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<void>}
   */
  setSystem(key, value) {
    return settingsDb.setSystemSetting(key, value);
  }
}

module.exports = SettingsRepository;
