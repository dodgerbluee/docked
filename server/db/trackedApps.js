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
 * @param {number} userId - User ID
 * @param {string} name - Display name
 * @param {string} imageName - Image name or null for GitHub
 * @param {string} githubRepo - GitHub repo or null for Docker
 * @param {string} sourceType - 'docker', 'github', or 'gitlab'
 * @param {string} gitlabToken - GitLab token (optional, for backward compatibility)
 * @param {number} repositoryTokenId - Repository token ID (optional, preferred over gitlabToken)
 * @returns {Promise<number>} - ID of created tracked app
 */
function createTrackedApp(
  userId,
  name,
  imageName = null,
  githubRepo = null,
  sourceType = "docker",
  gitlabToken = null,
  repositoryTokenId = null
) {
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
function updateTrackedApp(id, userId, updateData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.name !== undefined) {
        fields.push("name = ?");
        values.push(updateData.name);
      }
      if (updateData.image_name !== undefined) {
        fields.push("image_name = ?");
        values.push(updateData.image_name);
      }
      if (updateData.current_version !== undefined) {
        fields.push("current_version = ?");
        values.push(updateData.current_version);
      }
      if (updateData.current_digest !== undefined) {
        fields.push("current_digest = ?");
        values.push(updateData.current_digest);
      }
      if (updateData.latest_version !== undefined) {
        fields.push("latest_version = ?");
        values.push(updateData.latest_version);
      }
      if (updateData.latest_digest !== undefined) {
        fields.push("latest_digest = ?");
        values.push(updateData.latest_digest);
      }
      if (updateData.has_update !== undefined) {
        fields.push("has_update = ?");
        values.push(updateData.has_update ? 1 : 0);
      }
      if (updateData.last_checked !== undefined) {
        fields.push("last_checked = ?");
        values.push(updateData.last_checked);
      }
      if (updateData.current_version_publish_date !== undefined) {
        fields.push("current_version_publish_date = ?");
        values.push(updateData.current_version_publish_date);
      }
      if (updateData.latest_version_publish_date !== undefined) {
        fields.push("latest_version_publish_date = ?");
        values.push(updateData.latest_version_publish_date);
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

      db.run(sql, values, function (err) {
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
      db.run("DELETE FROM tracked_apps WHERE id = ? AND user_id = ?", [id, userId], function (err) {
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
        function (err) {
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
