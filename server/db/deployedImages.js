/**
 * Deployed Images Database Module
 *
 * Handles all deployed image-related database operations including:
 * - Deployed image tracking (what containers are actually using)
 * - Image cleanup operations
 */

const { getDatabase } = require("./connection");

/**
 * Upsert deployed image (what containers are actually using)
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} imageTag - Image tag
 * @param {string} imageDigest - Image digest (SHA256)
 * @param {Object} options - Additional options (imageCreatedDate, registry, namespace, repository, repoDigests)
 * @returns {Promise<number>} - ID of the deployed image record
 */
// eslint-disable-next-line max-lines-per-function -- Deployed image upsert requires comprehensive database operations
function upsertDeployedImage(userId, imageRepo, imageTag, imageDigest, options = {}) {
  // eslint-disable-next-line max-lines-per-function -- Promise callback requires comprehensive database logic
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      const {
        imageCreatedDate = null,
        registry = null,
        namespace = null,
        repository = null,
        repoDigests = null,
      } = options;
      
      // Serialize repoDigests array to JSON string for storage
      const repoDigestsJson = repoDigests && Array.isArray(repoDigests) && repoDigests.length > 0
        ? JSON.stringify(repoDigests) 
        : null;

      // First try to find existing record
      db.get(
        `SELECT id FROM deployed_images 
         WHERE user_id = ? AND image_repo = ? AND image_tag = ? AND image_digest = ?`,
        [userId, imageRepo, imageTag, imageDigest],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

        if (row) {
          // Update last_seen and repo_digests for existing record
          // CRITICAL: Only update repo_digests if we have new data (don't overwrite with null)
          if (repoDigestsJson !== null) {
            db.run(
              `UPDATE deployed_images 
               SET last_seen = CURRENT_TIMESTAMP, 
                   updated_at = CURRENT_TIMESTAMP,
                   repo_digests = ?
               WHERE id = ?`,
              [repoDigestsJson, row.id],
              (updateErr) => {
                if (updateErr) {
                  reject(updateErr);
                } else {
                  resolve(row.id);
                }
              }
            );
          } else {
            // Preserve existing repo_digests when updating (don't overwrite with null)
            db.run(
              `UPDATE deployed_images 
               SET last_seen = CURRENT_TIMESTAMP, 
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [row.id],
              (updateErr) => {
                if (updateErr) {
                  reject(updateErr);
                } else {
                  resolve(row.id);
                }
              }
            );
          }
          } else {
            // Insert new record
            db.run(
              `INSERT INTO deployed_images (
                user_id, image_repo, image_tag, image_digest, image_created_date,
                registry, namespace, repository, repo_digests,
                first_seen, last_seen, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [
                userId,
                imageRepo,
                imageTag,
                imageDigest,
                imageCreatedDate,
                registry,
                namespace,
                repository || imageRepo,
                repoDigestsJson,
              ],
              function (insertErr) {
                if (insertErr) {
                  reject(insertErr);
                } else {
                  resolve(this.lastID);
                }
              }
            );
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get deployed image by repo, tag, and digest
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} imageTag - Image tag
 * @param {string} imageDigest - Image digest
 * @returns {Promise<Object|null>} - Deployed image record or null
 */
function getDeployedImage(userId, imageRepo, imageTag, imageDigest) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      db.get(
        `SELECT * FROM deployed_images 
         WHERE user_id = ? AND image_repo = ? AND image_tag = ? AND image_digest = ?`,
        [userId, imageRepo, imageTag, imageDigest],
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
 * Clean up orphaned deployed images (not referenced by any container)
 * @param {number} userId - User ID
 * @returns {Promise<number>} - Number of deleted records
 */
function cleanupOrphanedDeployedImages(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      db.run(
        `DELETE FROM deployed_images 
         WHERE user_id = ? 
         AND id NOT IN (SELECT DISTINCT deployed_image_id FROM containers WHERE user_id = ? AND deployed_image_id IS NOT NULL)`,
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
  upsertDeployedImage,
  getDeployedImage,
  cleanupOrphanedDeployedImages,
};
