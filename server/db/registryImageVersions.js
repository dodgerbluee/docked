/**
 * Registry Image Versions Database Module
 * 
 * Handles all registry image version-related database operations including:
 * - Registry image version tracking (latest available in registries)
 * - Version cleanup operations
 */

const { getDatabase } = require("./connection");

/**
 * Upsert registry image version (latest available in registry)
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Tag being checked
 * @param {Object} versionData - Version data from registry
 * @returns {Promise<number>} - ID of the record
 */
function upsertRegistryImageVersion(userId, imageRepo, tag, versionData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      const {
        registry = "docker.io",
        provider = null,
        namespace = null,
        repository = null,
        latestDigest = null,
        latestVersion = null,
        latestPublishDate = null,
        existsInRegistry = true,
      } = versionData;

      db.run(
        `INSERT OR REPLACE INTO registry_image_versions (
          user_id, image_repo, registry, provider, namespace, repository, tag,
          latest_digest, latest_version, latest_publish_date,
          exists_in_registry, last_checked, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          userId,
          imageRepo,
          registry,
          provider,
          namespace,
          repository || imageRepo,
          tag,
          latestDigest,
          latestVersion,
          latestPublishDate,
          existsInRegistry ? 1 : 0,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get registry image version for a specific repo and tag
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Tag
 * @returns {Promise<Object|null>} - Registry version info or null
 */
function getRegistryImageVersion(userId, imageRepo, tag) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      db.get(
        `SELECT * FROM registry_image_versions 
         WHERE user_id = ? AND image_repo = ? AND tag = ?`,
        [userId, imageRepo, tag],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clean up orphaned registry image versions (not referenced by any deployed image)
 * @param {number} userId - User ID
 * @returns {Promise<number>} - Number of deleted records
 */
function cleanupOrphanedRegistryVersions(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      // Keep registry versions that match deployed images or were checked recently (within 7 days)
      db.run(
        `DELETE FROM registry_image_versions 
         WHERE user_id = ? 
         AND image_repo || ':' || tag NOT IN (
           SELECT DISTINCT image_repo || ':' || image_tag 
           FROM deployed_images 
           WHERE user_id = ?
         )
         AND last_checked < datetime('now', '-7 days')`,
        [userId, userId],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  upsertRegistryImageVersion,
  getRegistryImageVersion,
  cleanupOrphanedRegistryVersions,
};

