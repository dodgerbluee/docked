/**
 * Registry Database Module
 *
 * Handles all registry-related database operations including:
 * - Repository access tokens (GitHub, GitLab)
 * - Image-token associations
 *
 * Note: Docker Hub credentials removed - crane/skopeo use system Docker credentials (~/.docker/config.json)
 */

const { getDatabase } = require("./connection");

// Docker Hub credentials functions removed - crane/skopeo use system Docker credentials
// Users should run 'docker login' on the server for registry authentication

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
              has_token: Boolean(access_token),
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
              resolve({ ...rest, has_token: Boolean(access_token) });
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
          (err) => {
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
  getAllRepositoryAccessTokens,
  getRepositoryAccessTokenByProvider,
  getRepositoryAccessTokenById,
  upsertRepositoryAccessToken,
  deleteRepositoryAccessToken,
};
