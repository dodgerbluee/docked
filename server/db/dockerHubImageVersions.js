/**
 * Docker Hub Image Versions Database Module
 *
 * Handles all Docker Hub image version-related database operations including:
 * - Docker Hub image version tracking (deprecated, use registryImageVersions)
 * - Version updates and queries
 *
 * @deprecated This module is for backward compatibility. New code should use registryImageVersions.
 */

const { getDatabase } = require("./connection");

/**
 * Upsert Docker Hub image version information
 * @deprecated Use upsertRegistryImageVersion instead
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository (without tag, e.g., "nginx")
 * @param {Object} versionData - Version data to store
 * @returns {Promise<number>} - ID of the record
 */
function upsertDockerHubImageVersion(userId, imageRepo, versionData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      const {
        imageName = null,
        registry = "docker.io",
        namespace = null,
        repository = null,
        currentTag = null,
        currentVersion = null,
        currentDigest = null,
        latestTag = null,
        latestVersion = null,
        latestDigest = null,
        hasUpdate = false,
        latestPublishDate = null,
        currentVersionPublishDate = null,
        existsInDockerHub = true,
      } = versionData;

      db.run(
        `INSERT OR REPLACE INTO docker_hub_image_versions (
          user_id, image_name, image_repo, registry, namespace, repository,
          current_tag, current_version, current_digest,
          latest_tag, latest_version, latest_digest,
          has_update, latest_publish_date, current_version_publish_date,
          exists_in_docker_hub, last_checked, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          userId,
          imageName || imageRepo,
          imageRepo,
          registry,
          namespace,
          repository || imageRepo,
          currentTag,
          currentVersion,
          currentDigest,
          latestTag,
          latestVersion,
          latestDigest,
          hasUpdate ? 1 : 0,
          latestPublishDate,
          currentVersionPublishDate,
          existsInDockerHub ? 1 : 0,
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
 * Get Docker Hub version info for a specific image repo and tag
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} currentTag - Current tag (optional, for backward compatibility)
 * @returns {Promise<Object|null>} - Version info or null
 */
function getDockerHubImageVersion(userId, imageRepo, currentTag = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      // If tag is provided, use it in the query (new constraint)
      // If not provided, try to find any record for the repo (backward compatibility)
      let query, params;
      if (currentTag !== null && currentTag !== undefined) {
        query = `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND image_repo = ? AND current_tag = ?`;
        params = [userId, imageRepo, currentTag];
      } else {
        // Fallback: get first matching record (for backward compatibility)
        query = `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND image_repo = ? LIMIT 1`;
        params = [userId, imageRepo];
      }

      db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            resolve({
              id: row.id,
              userId: row.user_id,
              imageName: row.image_name,
              imageRepo: row.image_repo,
              registry: row.registry,
              namespace: row.namespace,
              repository: row.repository,
              currentTag: row.current_tag,
              currentVersion: row.current_version,
              currentDigest: row.current_digest,
              latestTag: row.latest_tag,
              latestVersion: row.latest_version,
              latestDigest: row.latest_digest,
              hasUpdate: row.has_update === 1,
              latestPublishDate: row.latest_publish_date,
              currentVersionPublishDate: row.current_version_publish_date,
              existsInDockerHub: row.exists_in_docker_hub === 1,
              lastChecked: row.last_checked,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            });
          } else {
            resolve(null);
          }
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get Docker Hub versions for multiple image repos (batch)
 * @param {number} userId - User ID
 * @param {Array<string>} imageRepos - Array of image repositories
 * @returns {Promise<Map>} - Map of imageRepo -> version info
 */
function getDockerHubImageVersionsBatch(userId, imageRepos) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (!imageRepos || imageRepos.length === 0) {
        resolve(new Map());
        return;
      }

      const placeholders = imageRepos.map(() => "?").join(",");
      db.all(
        `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND image_repo IN (${placeholders})`,
        [userId, ...imageRepos],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const versionMap = new Map();
            rows.forEach((row) => {
              versionMap.set(row.image_repo, {
                id: row.id,
                userId: row.user_id,
                imageName: row.image_name,
                imageRepo: row.image_repo,
                registry: row.registry,
                namespace: row.namespace,
                repository: row.repository,
                currentTag: row.current_tag,
                currentVersion: row.current_version,
                currentDigest: row.current_digest,
                latestTag: row.latest_tag,
                latestVersion: row.latest_version,
                latestDigest: row.latest_digest,
                hasUpdate: row.has_update === 1,
                latestPublishDate: row.latest_publish_date,
                currentVersionPublishDate: row.current_version_publish_date,
                existsInDockerHub: row.exists_in_docker_hub === 1,
                lastChecked: row.last_checked,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              });
            });
            resolve(versionMap);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all images with updates for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of images with updates
 */
function getDockerHubImagesWithUpdates(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND has_update = 1 ORDER BY updated_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const versions = rows.map((row) => ({
              id: row.id,
              userId: row.user_id,
              imageName: row.image_name,
              imageRepo: row.image_repo,
              registry: row.registry,
              namespace: row.namespace,
              repository: row.repository,
              currentTag: row.current_tag,
              currentVersion: row.current_version,
              currentDigest: row.current_digest,
              latestTag: row.latest_tag,
              latestVersion: row.latest_version,
              latestDigest: row.latest_digest,
              hasUpdate: true,
              latestPublishDate: row.latest_publish_date,
              currentVersionPublishDate: row.current_version_publish_date,
              existsInDockerHub: row.exists_in_docker_hub === 1,
              lastChecked: row.last_checked,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }));
            resolve(versions);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update Docker Hub version after container upgrade
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} newDigest - New digest after upgrade
 * @param {string} newVersion - New version after upgrade
 * @param {string} currentTag - Current tag (optional)
 * @returns {Promise<void>}
 */
function markDockerHubImageUpToDate(userId, imageRepo, newDigest, newVersion, currentTag = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      // If currentTag is provided, use it in WHERE clause (new constraint)
      // Otherwise, try to match by version (backward compatibility)
      let query, params;
      if (currentTag !== null && currentTag !== undefined) {
        query = `UPDATE docker_hub_image_versions 
                 SET current_digest = ?, current_version = ?, latest_digest = ?, 
                     latest_version = ?, has_update = 0, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ? AND image_repo = ? AND current_tag = ?`;
        params = [newDigest, newVersion, newDigest, newVersion, userId, imageRepo, currentTag];
      } else {
        // Fallback: match by version if tag not provided
        query = `UPDATE docker_hub_image_versions 
                 SET current_digest = ?, current_version = ?, latest_digest = ?, 
                     latest_version = ?, has_update = 0, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ? AND image_repo = ? AND current_version = ?`;
        params = [newDigest, newVersion, newDigest, newVersion, userId, imageRepo, newVersion];
      }

      db.run(query, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  upsertDockerHubImageVersion,
  getDockerHubImageVersion,
  getDockerHubImageVersionsBatch,
  getDockerHubImagesWithUpdates,
  markDockerHubImageUpToDate,
};
