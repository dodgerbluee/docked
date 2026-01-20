/**
 * Tracked App Upgrade History Database Module
 *
 * Handles all tracked app upgrade history-related database operations
 */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");

/**
 * Create a new tracked app upgrade history record
 * @param {Object} upgradeData - Upgrade data
 * @param {number} upgradeData.userId - User ID
 * @param {number} [upgradeData.trackedAppId] - Tracked app ID
 * @param {string} upgradeData.appName - Application name
 * @param {string} upgradeData.provider - Provider (github, gitlab)
 * @param {string} upgradeData.repository - Repository name
 * @param {string} upgradeData.oldVersion - Old version
 * @param {string} upgradeData.newVersion - New version
 * @param {string} [upgradeData.oldTag] - Old tag
 * @param {string} [upgradeData.newTag] - New tag
 * @param {string} [upgradeData.oldCommitSha] - Old commit SHA
 * @param {string} [upgradeData.newCommitSha] - New commit SHA
 * @param {string} [upgradeData.releaseNotes] - Release notes
 * @param {string} [upgradeData.status] - Status (success, failed)
 * @param {string} [upgradeData.errorMessage] - Error message if failed
 * @param {number} [upgradeData.upgradeDurationMs] - Upgrade duration in milliseconds
 * @returns {Promise<number>} - ID of the created record
 */
function createTrackedAppUpgradeHistory(upgradeData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const {
        userId,
        trackedAppId,
        appName,
        provider,
        repository,
        oldVersion,
        newVersion,
        oldTag,
        newTag,
        oldCommitSha,
        newCommitSha,
        releaseNotes,
        status = "success",
        errorMessage,
        upgradeDurationMs,
      } = upgradeData;

      if (!userId || !appName || !provider || !repository || !oldVersion || !newVersion) {
        reject(new Error("Missing required fields for tracked app upgrade history"));
        return;
      }

      queueDatabaseOperation(() => {
        db.run(
          `INSERT INTO tracked_app_upgrade_history (
          user_id, tracked_app_id, app_name, provider, repository,
          old_version, new_version, old_tag, new_tag,
          old_commit_sha, new_commit_sha, release_notes,
          status, error_message, upgrade_duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            trackedAppId || null,
            appName,
            provider,
            repository,
            oldVersion,
            newVersion,
            oldTag || null,
            newTag || null,
            oldCommitSha || null,
            newCommitSha || null,
            releaseNotes || null,
            status,
            errorMessage || null,
            upgradeDurationMs || null,
          ],
          function (err) {
            if (err) {
              logger.error("Error creating tracked app upgrade history record:", {
                error: err,
                upgradeData,
              });
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get tracked app upgrade history for a user
 * @param {number} userId - User ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Maximum number of records to return
 * @param {number} [options.offset] - Offset for pagination
 * @param {string} [options.appName] - Filter by app name
 * @param {string} [options.provider] - Filter by provider (github, gitlab)
 * @param {string} [options.status] - Filter by status (success, failed)
 * @returns {Promise<Array>} - Array of upgrade history records
 */
function getTrackedAppUpgradeHistory(userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const { limit = 100, offset = 0, appName, provider, status } = options;

      let query = `
        SELECT 
          id, user_id, tracked_app_id, app_name, provider, repository,
          old_version, new_version, old_tag, new_tag,
          old_commit_sha, new_commit_sha, release_notes,
          status, error_message, upgrade_duration_ms, created_at
        FROM tracked_app_upgrade_history
        WHERE user_id = ?
      `;
      const params = [userId];

      if (appName) {
        query += " AND app_name LIKE ?";
        params.push(`%${appName}%`);
      }

      if (provider) {
        query += " AND provider = ?";
        params.push(provider);
      }

      if (status) {
        query += " AND status = ?";
        params.push(status);
      }

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      queueDatabaseOperation(() => {
        db.all(query, params, (err, rows) => {
          if (err) {
            logger.error("Error fetching tracked app upgrade history:", {
              error: err,
              userId,
              options,
            });
            reject(err);
          } else {
            resolve(rows || []);
          }
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a single tracked app upgrade history record by ID
 * @param {number} userId - User ID
 * @param {number} upgradeId - Upgrade history ID
 * @returns {Promise<Object|null>} - Upgrade history record or null
 */
function getTrackedAppUpgradeHistoryById(userId, upgradeId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.get(
          `SELECT 
          id, user_id, tracked_app_id, app_name, provider, repository,
          old_version, new_version, old_tag, new_tag,
          old_commit_sha, new_commit_sha, release_notes,
          status, error_message, upgrade_duration_ms, created_at
        FROM tracked_app_upgrade_history
        WHERE id = ? AND user_id = ?`,
          [upgradeId, userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching tracked app upgrade history by ID:", {
                error: err,
                userId,
                upgradeId,
              });
              reject(err);
            } else {
              resolve(row || null);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get tracked app upgrade history statistics for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Statistics object
 */
function getTrackedAppUpgradeHistoryStats(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.get(
          `SELECT 
          COUNT(*) as total_upgrades,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_upgrades,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_upgrades,
          AVG(upgrade_duration_ms) as avg_duration_ms,
          MIN(created_at) as first_upgrade,
          MAX(created_at) as last_upgrade,
          COUNT(DISTINCT app_name) as total_apps_upgraded
        FROM tracked_app_upgrade_history
        WHERE user_id = ?`,
          [userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching tracked app upgrade history stats:", { error: err, userId });
              reject(err);
            } else {
              resolve(row || {});
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete old tracked app upgrade history records (cleanup)
 * @param {number} userId - User ID
 * @param {number} daysToKeep - Number of days of history to keep
 * @returns {Promise<number>} - Number of records deleted
 */
function cleanupOldTrackedAppUpgradeHistory(userId, daysToKeep = 90) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          `DELETE FROM tracked_app_upgrade_history
        WHERE user_id = ? AND created_at < datetime('now', '-' || ? || ' days')`,
          [userId, daysToKeep],
          function (err) {
            if (err) {
              logger.error("Error cleaning up old tracked app upgrade history:", {
                error: err,
                userId,
                daysToKeep,
              });
              reject(err);
            } else {
              resolve(this.changes);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  createTrackedAppUpgradeHistory,
  getTrackedAppUpgradeHistory,
  getTrackedAppUpgradeHistoryById,
  getTrackedAppUpgradeHistoryStats,
  cleanupOldTrackedAppUpgradeHistory,
};

