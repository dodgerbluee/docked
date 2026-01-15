/**
 * Upgrade History Database Module
 *
 * Handles all upgrade history-related database operations
 */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");

/**
 * Create a new upgrade history record
 * @param {Object} upgradeData - Upgrade data
 * @param {number} upgradeData.userId - User ID
 * @param {number} [upgradeData.portainerInstanceId] - Portainer instance ID
 * @param {string} [upgradeData.portainerInstanceName] - Portainer instance name
 * @param {string} upgradeData.containerId - Container ID
 * @param {string} upgradeData.containerName - Container name
 * @param {string} upgradeData.endpointId - Endpoint ID
 * @param {string} [upgradeData.portainerUrl] - Portainer URL
 * @param {string} upgradeData.oldImage - Old image name
 * @param {string} upgradeData.newImage - New image name
 * @param {string} [upgradeData.oldDigest] - Old digest
 * @param {string} [upgradeData.newDigest] - New digest
 * @param {string} [upgradeData.oldVersion] - Old version
 * @param {string} [upgradeData.newVersion] - New version
 * @param {string} [upgradeData.imageRepo] - Image repository
 * @param {string} [upgradeData.registry] - Registry
 * @param {string} [upgradeData.namespace] - Namespace
 * @param {string} [upgradeData.repository] - Repository
 * @param {string} [upgradeData.status] - Status (success, failed)
 * @param {string} [upgradeData.errorMessage] - Error message if failed
 * @param {number} [upgradeData.upgradeDurationMs] - Upgrade duration in milliseconds
 * @returns {Promise<number>} - ID of the created record
 */
function createUpgradeHistory(upgradeData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const {
        userId,
        portainerInstanceId,
        portainerInstanceName,
        containerId,
        containerName,
        endpointId,
        portainerUrl,
        oldImage,
        newImage,
        oldDigest,
        newDigest,
        oldVersion,
        newVersion,
        imageRepo,
        registry,
        namespace,
        repository,
        status = "success",
        errorMessage,
        upgradeDurationMs,
      } = upgradeData;

      if (!userId || !containerId || !containerName || !oldImage || !newImage) {
        reject(new Error("Missing required fields for upgrade history"));
        return;
      }

      queueDatabaseOperation(() => {
        db.run(
          `INSERT INTO upgrade_history (
          user_id, portainer_instance_id, portainer_instance_name, container_id, container_name,
          endpoint_id, portainer_url, old_image, new_image, old_digest, new_digest,
          old_version, new_version, image_repo, registry, namespace, repository,
          status, error_message, upgrade_duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            portainerInstanceId || null,
            portainerInstanceName || null,
            containerId,
            containerName,
            endpointId,
            portainerUrl || null,
            oldImage,
            newImage,
            oldDigest || null,
            newDigest || null,
            oldVersion || null,
            newVersion || null,
            imageRepo || null,
            registry || null,
            namespace || null,
            repository || null,
            status,
            errorMessage || null,
            upgradeDurationMs || null,
          ],
          function (err) {
            if (err) {
              logger.error("Error creating upgrade history record:", { error: err, upgradeData });
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
 * Get upgrade history for a user
 * @param {number} userId - User ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Maximum number of records to return
 * @param {number} [options.offset] - Offset for pagination
 * @param {string} [options.containerName] - Filter by container name
 * @param {string} [options.status] - Filter by status (success, failed)
 * @returns {Promise<Array>} - Array of upgrade history records
 */
function getUpgradeHistory(userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const { limit = 100, offset = 0, containerName, status } = options;

      let query = `
        SELECT 
          id, user_id, portainer_instance_id, portainer_instance_name, container_id, container_name,
          endpoint_id, portainer_url, old_image, new_image, old_digest, new_digest,
          old_version, new_version, image_repo, registry, namespace, repository,
          status, error_message, upgrade_duration_ms, created_at
        FROM upgrade_history
        WHERE user_id = ?
      `;
      const params = [userId];

      if (containerName) {
        query += " AND container_name LIKE ?";
        params.push(`%${containerName}%`);
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
            logger.error("Error fetching upgrade history:", { error: err, userId, options });
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
 * Get a single upgrade history record by ID
 * @param {number} userId - User ID
 * @param {number} upgradeId - Upgrade history ID
 * @returns {Promise<Object|null>} - Upgrade history record or null
 */
function getUpgradeHistoryById(userId, upgradeId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.get(
          `SELECT 
          id, user_id, portainer_instance_id, portainer_instance_name, container_id, container_name,
          endpoint_id, portainer_url, old_image, new_image, old_digest, new_digest,
          old_version, new_version, image_repo, registry, namespace, repository,
          status, error_message, upgrade_duration_ms, created_at
        FROM upgrade_history
        WHERE id = ? AND user_id = ?`,
          [upgradeId, userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching upgrade history by ID:", {
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
 * Get upgrade history statistics for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Statistics object
 */
function getUpgradeHistoryStats(userId) {
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
          MAX(created_at) as last_upgrade
        FROM upgrade_history
        WHERE user_id = ?`,
          [userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching upgrade history stats:", { error: err, userId });
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
 * Delete old upgrade history records (cleanup)
 * @param {number} userId - User ID
 * @param {number} daysToKeep - Number of days of history to keep
 * @returns {Promise<number>} - Number of records deleted
 */
function cleanupOldUpgradeHistory(userId, daysToKeep = 90) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          `DELETE FROM upgrade_history
        WHERE user_id = ? AND created_at < datetime('now', '-' || ? || ' days')`,
          [userId, daysToKeep],
          function (err) {
            if (err) {
              logger.error("Error cleaning up old upgrade history:", {
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
  createUpgradeHistory,
  getUpgradeHistory,
  getUpgradeHistoryById,
  getUpgradeHistoryStats,
  cleanupOldUpgradeHistory,
};
