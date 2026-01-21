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
  findByUser(userId) {
    return trackedAppsDb.getAllTrackedApps(userId);
  }

  /**
   * Find tracked app by ID
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Tracked app or null
   */
  findById(id, userId) {
    return trackedAppsDb.getTrackedAppById(id, userId);
  }

  /**
   * Find tracked app by image name or GitHub repo
   * @param {number} userId - User ID
   * @param {string} imageName - Image name (or null for GitHub)
   * @param {string} githubRepo - GitHub repo (or null for Docker)
   * @returns {Promise<Object|null>} - Tracked app or null
   */
  findByImageName(userId, imageName = null, githubRepo = null) {
    return trackedAppsDb.getTrackedAppByImageName(userId, imageName, githubRepo);
  }

  /**
   * Create a new tracked app
   * @param {number} userId - User ID
   * @param {Object} appData - Tracked app data
   * @returns {Promise<number>} - ID of created tracked app
   */
  create(userId, appData) {
    return trackedAppsDb.createTrackedApp({ userId, ...appData });
  }

  /**
   * Update tracked app
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  update(id, userId, updateData) {
    return trackedAppsDb.updateTrackedApp(id, userId, updateData);
  }

  /**
   * Delete tracked app
   * @param {number} id - Tracked app ID
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  delete(id, userId) {
    return trackedAppsDb.deleteTrackedApp(id, userId);
  }

  /**
   * Clear latest versions for all tracked apps for a user
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  clearLatestVersions(userId) {
    return trackedAppsDb.clearLatestVersionsForAllTrackedApps(userId);
  }
}

module.exports = TrackedAppRepository;
