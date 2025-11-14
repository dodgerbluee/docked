/**
 * Settings Repository
 * Handles application settings database operations
 */

const BaseRepository = require('./BaseRepository');

class SettingsRepository extends BaseRepository {
  /**
   * Get a setting value by key
   * @param {string} key - Setting key
   * @returns {Promise<string|null>} - Setting value or null
   */
  async get(key) {
    const row = await this.findOne(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    return row ? row.value : null;
  }

  /**
   * Set a setting value by key
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await this.execute(
      `INSERT INTO settings (key, value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
      [key, value, value]
    );
  }

  /**
   * Delete a setting
   * @param {string} key - Setting key
   * @returns {Promise<void>}
   */
  async delete(key) {
    await this.execute('DELETE FROM settings WHERE key = ?', [key]);
  }
}

module.exports = SettingsRepository;

