/**
 * Registry Database Module
 * 
 * Handles all registry-related database operations including:
 * - Docker Hub credentials
 * - Repository access tokens (GitHub, GitLab)
 * - Image-token associations
 */

const { getDatabase } = require("./connection");

/**
 * Get Docker Hub credentials for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Docker Hub credentials or null
 */
function getDockerHubCredentials(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT username, token, updated_at FROM docker_hub_credentials WHERE user_id = ?",
        [userId],
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
 * Update Docker Hub credentials for a user
 * @param {number} userId - User ID
 * @param {string} username - Docker Hub username
 * @param {string} token - Docker Hub personal access token
 * @returns {Promise<void>}
 */
function updateDockerHubCredentials(userId, username, token) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        `INSERT OR REPLACE INTO docker_hub_credentials (user_id, username, token, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, username, token],
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

/**
 * Delete Docker Hub credentials for a user
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteDockerHubCredentials(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run("DELETE FROM docker_hub_credentials WHERE user_id = ?", [userId], function (err) {
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
 * Get all repository access tokens for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of repository access tokens
 */
function getAllRepositoryAccessTokens(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE user_id = ? ORDER BY provider ASC, name ASC",
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            // Don't return the actual token in the response for security
            const safeTokens = (rows || []).map(({ access_token, ...rest }) => ({
              ...rest,
              has_token: !!access_token,
            }));
            resolve(safeTokens);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get repository access token by provider for a user
 * @param {number} userId - User ID
 * @param {string} provider - Provider ('github' or 'gitlab')
 * @returns {Promise<Object|null>} - Repository access token or null
 */
function getRepositoryAccessTokenByProvider(userId, provider) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE user_id = ? AND provider = ?",
        [userId, provider],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            if (!row) {
              resolve(null);
            } else {
              // Don't return the actual token in the response for security
              const { access_token, ...rest } = row;
              resolve({ ...rest, has_token: !!access_token });
            }
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get repository access token by ID (includes token value for internal use)
 * @param {number} tokenId - Token ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Repository access token with access_token or null
 */
function getRepositoryAccessTokenById(tokenId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE id = ? AND user_id = ?",
        [tokenId, userId],
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
 * Create or update a repository access token
 * @param {number} userId - User ID
 * @param {string} provider - Provider ('github' or 'gitlab')
 * @param {string} name - Token name/description
 * @param {string} accessToken - Access token
 * @param {number} tokenId - Optional token ID for updates
 * @returns {Promise<number>} - ID of the token record
 */
function upsertRepositoryAccessToken(userId, provider, name, accessToken, tokenId = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      if (tokenId) {
        // Update existing token
        db.run(
          `UPDATE repository_access_tokens 
           SET name = ?, access_token = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?`,
          [name, accessToken, tokenId, userId],
          function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(tokenId);
            }
          }
        );
      } else {
        // Insert new token
        db.run(
          `INSERT INTO repository_access_tokens (user_id, provider, name, access_token, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [userId, provider, name, accessToken],
          function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete a repository access token
 * @param {number} id - Token ID
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteRepositoryAccessToken(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "DELETE FROM repository_access_tokens WHERE id = ? AND user_id = ?",
        [id, userId],
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

/**
 * Associate images with a repository access token
 * @param {number} userId - User ID
 * @param {number} tokenId - Token ID
 * @param {Array<string>} imageRepos - Array of image repository names
 * @returns {Promise<void>}
 */
function associateImagesWithToken(userId, tokenId, imageRepos) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      if (!imageRepos || imageRepos.length === 0) {
        // If no images provided, clear all associations for this token
        db.run(
          `UPDATE deployed_images 
           SET repository_token_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND repository_token_id = ?`,
          [userId, tokenId],
          function (err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
        return;
      }

      // First, clear existing associations for this token
      db.run(
        `UPDATE deployed_images 
         SET repository_token_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND repository_token_id = ?`,
        [userId, tokenId],
        (clearErr) => {
          if (clearErr) {
            reject(clearErr);
            return;
          }

          // Then, set the token for the specified images
          const placeholders = imageRepos.map(() => "?").join(",");
          db.run(
            `UPDATE deployed_images 
             SET repository_token_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND image_repo IN (${placeholders})`,
            [tokenId, userId, ...imageRepos],
            function (updateErr) {
              if (updateErr) {
                reject(updateErr);
              } else {
                resolve();
              }
            }
          );
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get images associated with a repository access token
 * @param {number} userId - User ID
 * @param {number} tokenId - Token ID
 * @returns {Promise<Array<string>>} - Array of image repository names
 */
function getAssociatedImagesForToken(userId, tokenId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT DISTINCT image_repo FROM deployed_images WHERE user_id = ? AND repository_token_id = ?",
        [userId, tokenId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map((row) => row.image_repo));
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getDockerHubCredentials,
  updateDockerHubCredentials,
  deleteDockerHubCredentials,
  getAllRepositoryAccessTokens,
  getRepositoryAccessTokenByProvider,
  getRepositoryAccessTokenById,
  upsertRepositoryAccessToken,
  deleteRepositoryAccessToken,
  associateImagesWithToken,
  getAssociatedImagesForToken,
};

