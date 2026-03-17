/**
 * Runners Database Module
 *
 * Handles all runner-related database operations including:
 * - Runner CRUD operations (runners are dockhand instances)
 */

const { getDatabase } = require("./connection");

/**
 * Get all runners for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>}
 */
function getAllRunners(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since, created_at, updated_at FROM runners WHERE user_id = ? ORDER BY created_at ASC",
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
 * Get a runner by ID for a user (includes api_key for internal use)
 * @param {number} id - Runner ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>}
 */
function getRunnerById(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since, created_at, updated_at FROM runners WHERE id = ? AND user_id = ?",
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
 * Create a new runner
 * @param {Object} params
 * @param {number} params.userId
 * @param {string} params.name
 * @param {string} params.url
 * @param {string} params.apiKey
 * @returns {Promise<number>} ID of created runner
 */
function createRunner({ userId, name, url, apiKey }) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, ?, ?, ?, 1)",
        [userId, name, url, apiKey],
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
 * Update a runner
 * @param {Object} params
 * @param {number} params.id
 * @param {number} params.userId
 * @param {string} params.name
 * @param {string} params.url
 * @param {string|null} params.apiKey - null to keep existing
 * @param {boolean} params.enabled
 * @returns {Promise<void>}
 */
function updateRunner({ id, userId, name, url, apiKey, enabled }) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (apiKey !== null && apiKey !== undefined) {
        db.run(
          "UPDATE runners SET name = ?, url = ?, api_key = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
          [name, url, apiKey, enabled ? 1 : 0, id, userId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      } else {
        db.run(
          "UPDATE runners SET name = ?, url = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
          [name, url, enabled ? 1 : 0, id, userId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete a runner
 * @param {number} id
 * @param {number} userId
 * @returns {Promise<void>}
 */
function deleteRunner(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run("DELETE FROM runners WHERE id = ? AND user_id = ?", [id, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update runner version info after a health check.
 * @param {number} id - Runner ID
 * @param {number} userId - User ID
 * @param {string|null} version - Running binary version (e.g. "1.0.0")
 * @param {string|null} latestVersion - Latest GitHub release tag (e.g. "v1.1.0")
 * @param {boolean|null} [dockerEnabled] - Whether Docker management is enabled on this runner
 * @returns {Promise<void>}
 */
function updateRunnerVersion(id, userId, version, latestVersion, dockerEnabled = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const dockerEnabledValue = dockerEnabled === null ? null : dockerEnabled ? 1 : 0;
      db.run(
        "UPDATE runners SET version = ?, latest_version = ?, docker_enabled = COALESCE(?, docker_enabled), version_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [version, latestVersion, dockerEnabledValue, id, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a runner by name for a specific user (case-insensitive).
 * @param {string} name - Runner name
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>}
 */
function getRunnerByNameAndUser(name, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id FROM runners WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
        [userId, name],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a runner by name (case-insensitive, across all users).
 * Used by the re-enrollment endpoint where we don't know the userId.
 * @param {string} name - Runner name
 * @returns {Promise<Object|null>}
 */
function getRunnerByName(name) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since, created_at, updated_at FROM runners WHERE LOWER(name) = LOWER(?) LIMIT 1",
        [name],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update the API key (and optionally URL) of a runner.
 * Used by the re-enrollment flow when a runner needs to re-register
 * after its API key became stale (e.g. server DB was reset).
 * @param {number} id - Runner ID
 * @param {string} apiKey - New API key
 * @param {string} url - New URL
 * @returns {Promise<void>}
 */
function updateRunnerApiKey(id, apiKey, url) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE runners SET api_key = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [apiKey, url, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all enabled runners across all users (includes api_key for background jobs).
 * @returns {Promise<Array>}
 */
function getAllRunnersWithKeys() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since FROM runners WHERE enabled = 1 ORDER BY created_at ASC",
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all enabled runners for a specific user (includes api_key for background jobs).
 * @param {number} userId - User ID
 * @returns {Promise<Array>}
 */
function getEnabledRunnersWithKeysByUser(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since FROM runners WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC",
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Find a runner by its API key (used for heartbeat authentication).
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
function getRunnerByApiKey(apiKey) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, name, url, api_key, enabled, docker_enabled, version, latest_version, version_checked_at, last_seen, docker_status, docker_status_since, created_at, updated_at FROM runners WHERE api_key = ? LIMIT 1",
        [apiKey],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update only the URL of a runner (used by heartbeat when IP changes).
 * @param {number} id - Runner ID
 * @param {string} url - New URL
 * @returns {Promise<void>}
 */
function updateRunnerUrl(id, url) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE runners SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [url, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getAllRunners,
  getRunnerById,
  getRunnerByName,
  getRunnerByNameAndUser,
  getRunnerByApiKey,
  createRunner,
  updateRunner,
  updateRunnerUrl,
  updateRunnerApiKey,
  deleteRunner,
  updateRunnerVersion,
  getAllRunnersWithKeys,
  getEnabledRunnersWithKeysByUser,
};
