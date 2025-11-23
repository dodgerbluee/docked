/**
 * Portainer Instances Database Module
 *
 * Handles all Portainer instance-related database operations including:
 * - Portainer instance CRUD operations
 * - Instance ordering
 * - Batch queries for multiple users
 */

const { getDatabase } = require("./connection");

/**
 * Get all Portainer instances for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of Portainer instances
 */
function getAllPortainerInstances(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances WHERE user_id = ? ORDER BY display_order ASC, created_at ASC",
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
 * Get all Portainer instances for multiple users (batch query to avoid N+1)
 * @param {Array<number>} userIds - Array of user IDs
 * @returns {Promise<Array>} - Array of Portainer instances
 */
function getAllPortainerInstancesForUsers(userIds) {
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
         FROM portainer_instances 
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
 * Get Portainer instance by ID for a user
 * @param {number} id - Instance ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Portainer instance or null
 */
function getPortainerInstanceById(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances WHERE id = ? AND user_id = ?",
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
 * Create a new Portainer instance
 * @param {number} userId - User ID
 * @param {string} name - Instance name
 * @param {string} url - Portainer URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @param {string} apiKey - API key (for API key auth)
 * @param {string} authType - Authentication type
 * @param {string} ipAddress - IP address (optional)
 * @returns {Promise<number>} - ID of created instance
 */
function createPortainerInstance(
  userId,
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "password",
  ipAddress = null
) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT MAX(display_order) as max_order FROM portainer_instances WHERE user_id = ?",
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
            "INSERT INTO portainer_instances (user_id, name, url, username, password, api_key, auth_type, display_order, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
 * Update a Portainer instance
 * @param {number} id - Instance ID
 * @param {number} userId - User ID
 * @param {string} name - Instance name
 * @param {string} url - Portainer URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @param {string} apiKey - API key (for API key auth)
 * @param {string} authType - Authentication type
 * @param {string} ipAddress - IP address (optional)
 * @returns {Promise<void>}
 */
function updatePortainerInstance(
  id,
  userId,
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "password",
  ipAddress = null
) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const finalUsername = authType === "apikey" ? "" : username || "";
      const finalPassword = authType === "apikey" ? "" : password || "";
      const finalApiKey = authType === "apikey" ? apiKey || null : null;

      db.run(
        "UPDATE portainer_instances SET name = ?, url = ?, username = ?, password = ?, api_key = ?, auth_type = ?, ip_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [name, url, finalUsername, finalPassword, finalApiKey, authType, ipAddress, id, userId],
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
 * Delete a Portainer instance
 * @param {number} id - Instance ID
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deletePortainerInstance(id, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "DELETE FROM portainer_instances WHERE id = ? AND user_id = ?",
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
 * Update display order of Portainer instances
 * @param {number} userId - User ID
 * @param {Array<{id: number, display_order: number}>} orders - Array of id and display_order pairs
 * @returns {Promise<void>}
 */
function updatePortainerInstanceOrder(userId, orders) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare(
          "UPDATE portainer_instances SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
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
  getAllPortainerInstances,
  getAllPortainerInstancesForUsers,
  getPortainerInstanceById,
  createPortainerInstance,
  updatePortainerInstance,
  deletePortainerInstance,
  updatePortainerInstanceOrder,
};
