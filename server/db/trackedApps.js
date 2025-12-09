/**
 * Tracked Apps Database Module
 *
 * Handles all tracked app-related database operations including:
 * - Tracked app CRUD operations
 * - Version tracking
 * - Update status management
 */

const { getDatabase } = require("./connection");

/**
 * Get all tracked images for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of tracked images
 */
function getAllTrackedApps(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT * FROM tracked_apps WHERE user_id = ? ORDER BY name ASC",
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a tracked app by ID for a user
 * @param {number} id - Tracked app ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Tracked app or null
 */
function getTrackedAppById(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT * FROM tracked_apps WHERE id = ? AND user_id = ?",
        [id, userId],
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
 * Get a tracked app by image name or GitHub repo for a user
 * @param {number} userId - User ID
 * @param {string} imageName - Image name (or null for GitHub)
 * @param {string} githubRepo - GitHub repo (or null for Docker)
 * @returns {Promise<Object|null>} - Tracked app or null
 */
function getTrackedAppByImageName(userId, imageName = null, githubRepo = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (githubRepo) {
        db.get(
          "SELECT * FROM tracked_apps WHERE user_id = ? AND github_repo = ?",
          [userId, githubRepo],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row || null);
            }
          }
        );
      } else if (imageName) {
        db.get(
          "SELECT * FROM tracked_apps WHERE user_id = ? AND image_name = ?",
          [userId, imageName],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row || null);
            }
          }
        );
      } else {
        resolve(null);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create a new tracked app
 * @param {Object} params - Parameters object
 * @param {number} params.userId - User ID
 * @param {string} params.name - Display name
 * @param {string} [params.imageName] - Image name or null for GitHub
 * @param {string} [params.githubRepo] - GitHub repo or null for Docker
 * @param {string} [params.sourceType='docker'] - 'docker', 'github', or 'gitlab'
 * @param {string} [params.gitlabToken] - GitLab token (optional, for backward compatibility)
 * @param {number} [params.repositoryTokenId] - Repository token ID (optional, preferred over gitlabToken)
 * @returns {Promise<number>} - ID of created tracked app
 */
function createTrackedApp({
  userId,
  name,
  imageName = null,
  githubRepo = null,
  sourceType = "docker",
  gitlabToken = null,
  repositoryTokenId = null,
}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT INTO tracked_apps (user_id, name, image_name, github_repo, source_type, gitlab_token, repository_token_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, name, imageName, githubRepo, sourceType, gitlabToken, repositoryTokenId],
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
 * Update a tracked app
 * @param {number} id - Tracked app ID
 * @param {number} userId - User ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-lines-per-function -- Complex update logic needed for tracked apps
function updateTrackedApp(id, userId, updateData) {
  // eslint-disable-next-line complexity, max-lines-per-function -- Arrow function requires multiple conditional checks and comprehensive update logic
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.name !== undefined) {
        fields.push("name = ?");
        values.push(updateData.name);
      }
      // Support both camelCase and snake_case for backward compatibility
      const imageName = updateData.imageName ?? updateData.image_name;
      if (imageName !== undefined) {
        fields.push("image_name = ?");
        values.push(imageName);
      }
      // Support both camelCase and snake_case for backward compatibility
      const currentVersion = updateData.currentVersion ?? updateData.current_version;
      if (currentVersion !== undefined) {
        fields.push("current_version = ?");
        values.push(currentVersion);
      }
      const currentDigest = updateData.currentDigest ?? updateData.current_digest;
      if (currentDigest !== undefined) {
        fields.push("current_digest = ?");
        values.push(currentDigest);
      }
      const latestVersion = updateData.latestVersion ?? updateData.latest_version;
      if (latestVersion !== undefined) {
        fields.push("latest_version = ?");
        values.push(latestVersion);
      }
      const latestDigest = updateData.latestDigest ?? updateData.latest_digest;
      if (latestDigest !== undefined) {
        fields.push("latest_digest = ?");
        values.push(latestDigest);
      }
      const hasUpdate = updateData.hasUpdate ?? updateData.has_update;
      if (hasUpdate !== undefined) {
        fields.push("has_update = ?");
        values.push(hasUpdate ? 1 : 0);
      }
      const lastChecked = updateData.lastChecked ?? updateData.last_checked;
      if (lastChecked !== undefined) {
        fields.push("last_checked = ?");
        values.push(lastChecked);
      }
      const currentVersionPublishDate =
        updateData.currentVersionPublishDate ?? updateData.current_version_publish_date;
      if (currentVersionPublishDate !== undefined) {
        fields.push("current_version_publish_date = ?");
        values.push(currentVersionPublishDate);
      }
      const latestVersionPublishDate =
        updateData.latestVersionPublishDate ?? updateData.latest_version_publish_date;
      if (latestVersionPublishDate !== undefined) {
        fields.push("latest_version_publish_date = ?");
        values.push(latestVersionPublishDate);
      }
      if (updateData.gitlab_token !== undefined) {
        fields.push("gitlab_token = ?");
        values.push(updateData.gitlab_token);
      }
      if (updateData.repository_token_id !== undefined) {
        fields.push("repository_token_id = ?");
        values.push(updateData.repository_token_id);
      }

      if (fields.length === 0) {
        resolve();
        return;
      }

      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id, userId);

      const sql = `UPDATE tracked_apps SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`;

      db.run(sql, values, (err) => {
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

/**
 * Delete a tracked app
 * @param {number} id - Tracked app ID
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteTrackedApp(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run("DELETE FROM tracked_apps WHERE id = ? AND user_id = ?", [id, userId], (err) => {
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

/**
 * Clear latest version data for all tracked apps for a user
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function clearLatestVersionsForAllTrackedApps(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE tracked_apps SET latest_version = NULL, latest_digest = NULL, has_update = 0, latest_version_publish_date = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [userId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getAllTrackedApps,
  getTrackedAppById,
  getTrackedAppByImageName,
  createTrackedApp,
  updateTrackedApp,
  deleteTrackedApp,
  clearLatestVersionsForAllTrackedApps,
};
