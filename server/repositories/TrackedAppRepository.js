/**
 * Tracked App Repository
 * Handles all tracked app-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const trackedAppsDb = require("../db/trackedApps");

class TrackedAppRepository extends BaseRepository {
  /**
   * Find all tracked apps for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of tracked apps
   */
  async findByUser(userId) {
    return await trackedAppsDb.getAllTrackedApps(userId);
  }

  /**
   * Find tracked app by ID
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Tracked app or null
   */
  async findById(id, userId) {
    return await trackedAppsDb.getTrackedAppById(id, userId);
  }

  /**
   * Find tracked app by image name or GitHub repo
   * @param {number} userId - User ID
   * @param {string} imageName - Image name (or null for GitHub)
   * @param {string} githubRepo - GitHub repo (or null for Docker)
   * @returns {Promise<Object|null>} - Tracked app or null
   */
  async findByImageName(userId, imageName = null, githubRepo = null) {
    return await trackedAppsDb.getTrackedAppByImageName(userId, imageName, githubRepo);
  }

  /**
   * Create a new tracked app
   * @param {number} userId - User ID
   * @param {Object} appData - Tracked app data
   * @returns {Promise<number>} - ID of created tracked app
   */
  async create(userId, appData) {
    return await trackedAppsDb.createTrackedApp(userId, appData);
  }

  /**
   * Update tracked app
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  async update(id, userId, updateData) {
    return await trackedAppsDb.updateTrackedApp(id, userId, updateData);
  }

  /**
   * Delete tracked app
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async delete(id, userId) {
    return await trackedAppsDb.deleteTrackedApp(id, userId);
  }

  /**
   * Clear latest versions for all tracked apps for a user
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async clearLatestVersions(userId) {
    return await trackedAppsDb.clearLatestVersionsForAllTrackedApps(userId);
  }
}

module.exports = TrackedAppRepository;
