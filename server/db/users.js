/**
 * Users Database Module
 *
 * Handles all user-related database operations including:
 * - User CRUD operations
 * - Password management
 * - User authentication
 * - User statistics
 */

const bcrypt = require("bcrypt");
const { getDatabase, queueDatabaseOperation } = require("./connection");

/**
 * Get user by username
 * @param {string} username - Username to lookup
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get user by ID
 * @param {number} id - User ID
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserById(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, username, email, role, instance_admin, created_at, updated_at, last_login FROM users WHERE id = ?",
        [id],
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
 * Verify password
 * @param {string} plainPassword - Plain text password
 * @param {string} hashedPassword - Hashed password from database
 * @returns {Promise<boolean>} - True if password matches
 */
async function verifyPassword(plainPassword, hashedPassword) {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Update user password
 * @param {string} username - Username
 * @param {string} newPassword - New plain text password
 * @returns {Promise<void>}
 */
async function updatePassword(username, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
        [passwordHash, username],
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
 * Update user password by user ID (admin function)
 * @param {number} userId - User ID
 * @param {string} newPassword - New plain text password
 * @returns {Promise<void>}
 */
async function updateUserPasswordById(userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [passwordHash, userId],
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
 * Update user role and instance admin status (admin function)
 * @param {number} userId - User ID
 * @param {string} role - User role (e.g., "Administrator", "Member")
 * @param {boolean} instanceAdmin - Whether user is instance admin
 * @returns {Promise<void>}
 */
function updateUserRole(userId, role, instanceAdmin) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET role = ?, instance_admin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [role, instanceAdmin ? 1 : 0, userId],
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
 * Get user statistics (counts of portainer instances and tracked apps)
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Object with portainerInstancesCount and trackedAppsCount
 */
function getUserStats(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      Promise.all([
        new Promise((resolveCount, rejectCount) => {
          db.get(
            "SELECT COUNT(*) as count FROM portainer_instances WHERE user_id = ?",
            [userId],
            (err, row) => {
              if (err) rejectCount(err);
              else resolveCount(row?.count || 0);
            }
          );
        }),
        new Promise((resolveCount, rejectCount) => {
          db.get(
            "SELECT COUNT(*) as count FROM tracked_apps WHERE user_id = ?",
            [userId],
            (err, row) => {
              if (err) rejectCount(err);
              else resolveCount(row?.count || 0);
            }
          );
        }),
      ])
        .then(([portainerInstancesCount, trackedAppsCount]) => {
          resolve({
            portainerInstancesCount,
            trackedAppsCount,
          });
        })
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update username
 * @param {string} oldUsername - Current username
 * @param {string} newUsername - New username
 * @returns {Promise<void>}
 */
async function updateUsername(oldUsername, newUsername) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
        [newUsername, oldUsername],
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
 * Update last login timestamp
 * @param {string} username - Username
 * @returns {Promise<void>}
 */
function updateLastLogin(username) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?",
        [username],
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
 * Get all users (for admin purposes)
 * @returns {Promise<Array>} - Array of user objects
 */
function getAllUsers() {
  return queueDatabaseOperation(() => {
    return new Promise((resolve, reject) => {
      try {
        const db = getDatabase();
        // Use SELECT * to handle missing columns gracefully (for migration compatibility)
        db.all("SELECT * FROM users ORDER BY created_at ASC", [], (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const users = rows.map((row) => ({
              id: row.id,
              username: row.username,
              email: row.email || null,
              role: row.role || "Administrator",
              instanceAdmin: row.instance_admin === 1,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              lastLogin: row.last_login || null,
            }));
            resolve(users);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Check if any users exist
 * @returns {Promise<boolean>} True if any users exist
 */
function hasAnyUsers() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (err) {
          if (err.message.includes("no such table")) {
            resolve(false);
          } else {
            reject(err);
          }
        } else {
          resolve(row.count > 0);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create a new user
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @param {string} email - User email (optional)
 * @param {string} role - User role (default: 'Administrator')
 * @param {boolean} instanceAdmin - Whether user is instance admin (default: false)
 * @returns {Promise<void>}
 */
async function createUser(
  username,
  password,
  email = null,
  role = "Administrator",
  instanceAdmin = false
) {
  const passwordHash = await bcrypt.hash(password, 10);
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin) VALUES (?, ?, ?, ?, ?, ?)",
        [username, passwordHash, email, role, 1, instanceAdmin ? 1 : 0],
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
 * Update verification token for a user
 * @param {string} username - Username
 * @param {string} token - Verification token
 * @returns {Promise<void>}
 */
function updateVerificationToken(username, token) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE users SET verification_token = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
        [token, username],
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
 * Verify and clear verification token
 * @param {string} username - Username
 * @param {string} token - Verification token to verify
 * @returns {Promise<boolean>} - True if token matches
 */
function verifyAndClearToken(username, token) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT verification_token FROM users WHERE username = ?", [username], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row || row.verification_token !== token) {
          resolve(false);
        } else {
          // Clear token after verification
          db.run(
            "UPDATE users SET verification_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
            [username],
            (updateErr) => {
              if (updateErr) {
                reject(updateErr);
              } else {
                resolve(true);
              }
            }
          );
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getUserByUsername,
  getUserById,
  verifyPassword,
  updatePassword,
  updateUserPasswordById,
  updateUserRole,
  getUserStats,
  updateUsername,
  updateLastLogin,
  hasAnyUsers,
  createUser,
  updateVerificationToken,
  verifyAndClearToken,
  getAllUsers,
};
