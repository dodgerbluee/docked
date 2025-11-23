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
  async get(key, userId) {
    return await settingsDb.getSetting(key, userId);
  }

  /**
   * Set a user setting
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async set(key, value, userId) {
    return await settingsDb.setSetting(key, value, userId);
  }

  /**
   * Get a system setting (user_id = 0)
   * @param {string} key - Setting key
   * @returns {Promise<string|null>} - Setting value or null
   */
  async getSystem(key) {
    return await settingsDb.getSystemSetting(key);
  }

  /**
   * Set a system setting (user_id = 0)
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<void>}
   */
  async setSystem(key, value) {
    return await settingsDb.setSystemSetting(key, value);
  }
}

module.exports = SettingsRepository;

