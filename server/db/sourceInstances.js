/**
 * Sources (Source Instances) Database Module
 *
 * Handles all Source instance-related database operations including:
 * - Source instance CRUD operations
 * - Instance ordering
 * - Batch queries for multiple users
 */

const { getDatabase } = require("./connection");

/**
 * Get all Source instances for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of Source instances
 */
function getAllSourceInstances(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM source_instances WHERE user_id = ? ORDER BY display_order ASC, created_at ASC",
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
 * Get all Source instances for multiple users (batch query to avoid N+1)
 * @param {Array<number>} userIds - Array of user IDs
 * @returns {Promise<Array>} - Array of Source instances
 */
function getAllSourceInstancesForUsers(userIds) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (!userIds || userIds.length === 0) {
        resolve([]);
        return;
      }
      // Create placeholders for IN clause
      const placeholders = userIds.map(() => "?").join(",");
      db.all(
        `SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at 
         FROM source_instances 
         WHERE user_id IN (${placeholders}) 
         ORDER BY user_id, display_order ASC, created_at ASC`,
        userIds,
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
 * Get Source instance by ID for a user
 * @param {number} id - Instance ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Source instance or null
 */
function getSourceInstanceById(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM source_instances WHERE id = ? AND user_id = ?",
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
 * Create a new Source instance
 * @param {Object} params - Parameters object
 * @param {number} params.userId - User ID
 * @param {string} params.name - Instance name
 * @param {string} params.url - Source URL
 * @param {string} params.username - Username
 * @param {string} params.password - Password
 * @param {string} [params.apiKey] - API key (for API key auth)
 * @param {string} [params.authType='password'] - Authentication type
 * @param {string} [params.ipAddress] - IP address (optional)
 * @returns {Promise<number>} - ID of created instance
 */
// eslint-disable-next-line max-lines-per-function -- Database function with comprehensive instance creation logic
function createSourceInstance({
  userId,
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "password",
  ipAddress = null,
}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT MAX(display_order) as max_order FROM source_instances WHERE user_id = ?",
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          const nextOrder = (row?.max_order ?? -1) + 1;

          const finalUsername = authType === "apikey" ? "" : username || "";
          const finalPassword = authType === "apikey" ? "" : password || "";
          const finalApiKey = authType === "apikey" ? apiKey || null : null;

          db.run(
            "INSERT INTO source_instances (user_id, name, url, username, password, api_key, auth_type, display_order, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              userId,
              name,
              url,
              finalUsername,
              finalPassword,
              finalApiKey,
              authType,
              nextOrder,
              ipAddress,
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
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update a Source instance
 * @param {Object} params - Parameters object
 * @param {number} params.id - Instance ID
 * @param {number} params.userId - User ID
 * @param {string} params.name - Instance name
 * @param {string} params.url - Source URL
 * @param {string} params.username - Username
 * @param {string} params.password - Password
 * @param {string} [params.apiKey] - API key (for API key auth)
 * @param {string} [params.authType='password'] - Authentication type
 * @param {string} [params.ipAddress] - IP address (optional)
 * @returns {Promise<void>}
 */
function updateSourceInstance({
  id,
  userId,
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "password",
  ipAddress = null,
}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const finalUsername = authType === "apikey" ? "" : username || "";
      const finalPassword = authType === "apikey" ? "" : password || "";
      const finalApiKey = authType === "apikey" ? apiKey || null : null;

      db.run(
        "UPDATE source_instances SET name = ?, url = ?, username = ?, password = ?, api_key = ?, auth_type = ?, ip_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [name, url, finalUsername, finalPassword, finalApiKey, authType, ipAddress, id, userId],
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

/**
 * Delete a Source instance
 * @param {number} id - Instance ID
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteSourceInstance(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "DELETE FROM source_instances WHERE id = ? AND user_id = ?",
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

/**
 * Update display order of Source instances
 * @param {number} userId - User ID
 * @param {Array<{id: number, display_order: number}>} orders - Array of id and display_order pairs
 * @returns {Promise<void>}
 */
function updateSourceInstanceOrder(userId, orders) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare(
          "UPDATE source_instances SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
        );

        let completed = 0;
        let hasError = false;

        orders.forEach(({ id, display_order }) => {
          stmt.run([display_order, id, userId], (err) => {
            if (err && !hasError) {
              hasError = true;
              db.run("ROLLBACK");
              reject(err);
            } else {
              completed++;
              if (completed === orders.length && !hasError) {
                stmt.finalize((finalizeErr) => {
                  if (finalizeErr) {
                    db.run("ROLLBACK");
                    reject(finalizeErr);
                  } else {
                    // eslint-disable-next-line max-nested-callbacks -- Transaction commit requires nested callbacks
                    db.run("COMMIT", (commitErr) => {
                      if (commitErr) {
                        reject(commitErr);
                      } else {
                        resolve();
                      }
                    });
                  }
                });
              }
            }
          });
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getAllSourceInstances,
  getAllSourceInstancesForUsers,
  getSourceInstanceById,
  createSourceInstance,
  updateSourceInstance,
  deleteSourceInstance,
  updateSourceInstanceOrder,
};
