/**
 * Database Configuration
 * SQLite database for user storage
 *
 * Note: For production, consider using PostgreSQL or MySQL
 * SQLite is fine for single-instance deployments
 */

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");

// Use DATA_DIR environment variable or default to /data
// This allows the database to be stored outside the codebase
const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_PATH = path.join(DATA_DIR, "users.db");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Created data directory: ${DATA_DIR}`);
}

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log(`Connected to SQLite database at ${DB_PATH}`);
    initializeDatabase();
  }
});

/**
 * Initialize database schema
 */
function initializeDatabase() {
  db.serialize(() => {
    // Create users table
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'Administrator',
        password_changed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error("Error creating users table:", err.message);
        } else {
          console.log("Users table ready");
          // Create indexes for users table
          db.run("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating username index:", idxErr.message);
            }
          });
          // Migrate existing 'admin' roles to 'Administrator'
          db.run(
            "UPDATE users SET role = 'Administrator' WHERE role = 'admin'",
            (migrateErr) => {
              if (migrateErr) {
                console.error("Error migrating roles:", migrateErr.message);
              } else {
                console.log("Role migration completed (admin -> Administrator)");
              }
            }
          );
          // Create default admin user if no users exist
          createDefaultAdmin();
        }
      }
    );

    // Create portainer_instances table
    db.run(
      `CREATE TABLE IF NOT EXISTS portainer_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error(
            "Error creating portainer_instances table:",
            err.message
          );
        } else {
          console.log("Portainer instances table ready");
          // Create indexes for portainer_instances table
          db.run("CREATE INDEX IF NOT EXISTS idx_portainer_url ON portainer_instances(url)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating portainer URL index:", idxErr.message);
            }
          });
          db.run("CREATE INDEX IF NOT EXISTS idx_portainer_display_order ON portainer_instances(display_order)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating display_order index:", idxErr.message);
            }
          });
          // Add display_order column if it doesn't exist (migration)
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN display_order INTEGER DEFAULT 0`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                console.error(
                  "Error adding display_order column:",
                  alterErr.message
                );
              }
            }
          );
          // Add api_key and auth_type columns if they don't exist (migration)
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN api_key TEXT`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                console.error(
                  "Error adding api_key column:",
                  alterErr.message
                );
              }
            }
          );
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN auth_type TEXT DEFAULT 'password'`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                console.error(
                  "Error adding auth_type column:",
                  alterErr.message
                );
              } else {
                // Update existing rows to have auth_type = 'password'
                db.run(
                  `UPDATE portainer_instances SET auth_type = 'password' WHERE auth_type IS NULL`,
                  (updateErr) => {
                    if (updateErr) {
                      console.error("Error updating auth_type:", updateErr.message);
                    }
                  }
                );
              }
            }
          );
          // Make username and password nullable for API key auth
          // Note: SQLite doesn't support ALTER COLUMN, so we'll handle this in application logic
        }
      }
    );

    // Create docker_hub_credentials table (singleton - only one row)
    db.run(
      `CREATE TABLE IF NOT EXISTS docker_hub_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT,
        token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error(
            "Error creating docker_hub_credentials table:",
            err.message
          );
        } else {
          console.log("Docker Hub credentials table ready");
        }
      }
    );

    // Create container_cache table to store cached container update information
    db.run(
      `CREATE TABLE IF NOT EXISTS container_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT UNIQUE NOT NULL,
        cache_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error("Error creating container_cache table:", err.message);
        } else {
          console.log("Container cache table ready");
          // Create indexes for container_cache table
          db.run("CREATE INDEX IF NOT EXISTS idx_cache_key ON container_cache(cache_key)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating cache_key index:", idxErr.message);
            }
          });
          db.run("CREATE INDEX IF NOT EXISTS idx_cache_updated_at ON container_cache(updated_at)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating cache updated_at index:", idxErr.message);
            }
          });
        }
      }
    );

    // Create batch_config table (singleton - only one row)
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error(
            "Error creating batch_config table:",
            err.message
          );
        } else {
          console.log("Batch config table ready");
          // Initialize with default values if no row exists
          db.get("SELECT id FROM batch_config WHERE id = 1", (initErr, row) => {
            if (!initErr && !row) {
              db.run(
                "INSERT INTO batch_config (id, enabled, interval_minutes) VALUES (1, 0, 60)",
                (insertErr) => {
                  if (insertErr) {
                    console.error("Error initializing batch_config:", insertErr.message);
                  }
                }
              );
            }
          });
        }
      }
    );

    // Create batch_runs table to track batch execution history
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        job_type TEXT DEFAULT 'docker-hub-pull',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        duration_ms INTEGER,
        containers_checked INTEGER DEFAULT 0,
        containers_updated INTEGER DEFAULT 0,
        error_message TEXT,
        logs TEXT
      )`,
      (err) => {
        if (err) {
          console.error("Error creating batch_runs table:", err.message);
        } else {
          console.log("Batch runs table ready");
          // Create indexes for batch_runs table
          db.run("CREATE INDEX IF NOT EXISTS idx_batch_runs_started_at ON batch_runs(started_at DESC)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating batch_runs started_at index:", idxErr.message);
            }
          });
          db.run("CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              console.error("Error creating batch_runs status index:", idxErr.message);
            }
          });
          // Add job_type column if it doesn't exist (migration)
          db.run(
            `ALTER TABLE batch_runs ADD COLUMN job_type TEXT DEFAULT 'docker-hub-pull'`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                console.error("Error adding job_type column:", alterErr.message);
              }
            }
          );
        }
      }
    );
  });
}

/**
 * Create default admin user if no users exist
 */
async function createDefaultAdmin() {
  db.get("SELECT COUNT(*) as count FROM users", async (err, row) => {
    if (err) {
      console.error("Error checking users:", err.message);
      return;
    }

    if (row.count === 0) {
      // Use ADMIN_PASSWORD if set and not empty, otherwise default to 'admin'
      const defaultPassword =
        (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim()) ||
        "admin";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      db.run(
        "INSERT INTO users (username, password_hash, role, password_changed) VALUES (?, ?, ?, ?)",
        ["admin", passwordHash, "Administrator", 0],
        (err) => {
          if (err) {
            console.error("Error creating default admin:", err.message);
          } else {
            console.log(
              "Default admin user created (username: admin, password: admin)"
            );
            console.log("⚠️  Password change will be required on first login!");
          }
        }
      );
    }
  });
}

/**
 * Get user by username
 * @param {string} username - Username to lookup
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get user by ID
 * @param {number} id - User ID
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?",
      [id],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
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
 * @param {boolean} markPasswordChanged - Mark password as changed (for first login)
 * @returns {Promise<void>}
 */
async function updatePassword(
  username,
  newPassword,
  markPasswordChanged = true
) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET password_hash = ?, password_changed = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
      [passwordHash, markPasswordChanged ? 1 : 0, username],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
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
  });
}

/**
 * Create a new user
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @param {string} role - User role (default: 'admin')
 * @returns {Promise<void>}
 */
async function createUser(username, password, role = "admin") {
  const passwordHash = await bcrypt.hash(password, 10);
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [username, passwordHash, role],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get all Portainer instances
 * @returns {Promise<Array>} - Array of Portainer instances
 */
function getAllPortainerInstances() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, created_at, updated_at FROM portainer_instances ORDER BY display_order ASC, created_at ASC",
      [],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Get Portainer instance by ID
 * @param {number} id - Instance ID
 * @returns {Promise<Object|null>} - Portainer instance or null
 */
function getPortainerInstanceById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, created_at, updated_at FROM portainer_instances WHERE id = ?",
      [id],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Create a new Portainer instance
 * @param {string} name - Instance name
 * @param {string} url - Portainer URL
 * @param {string} username - Username
 * @param {string} password - Password (will be stored as-is, consider encryption)
 * @returns {Promise<number>} - ID of created instance
 */
function createPortainerInstance(name, url, username, password, apiKey = null, authType = 'apikey') {
  return new Promise((resolve, reject) => {
    // Get max display_order to set new instance at the end
    db.get(
      "SELECT MAX(display_order) as max_order FROM portainer_instances",
      [],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        const nextOrder = (row?.max_order ?? -1) + 1;

        // Use appropriate fields based on auth type
        // IMPORTANT: When creating with a specific auth type, only store data for that method
        // Use empty strings instead of null to satisfy NOT NULL constraints
        const finalUsername = authType === 'apikey' ? '' : (username || '');
        const finalPassword = authType === 'apikey' ? '' : (password || '');
        // Only store API key when using API key auth, otherwise set to null
        const finalApiKey = authType === 'apikey' ? (apiKey || null) : null;

        db.run(
          "INSERT INTO portainer_instances (name, url, username, password, api_key, auth_type, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [name, url, finalUsername, finalPassword, finalApiKey, authType, nextOrder],
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
  });
}

/**
 * Update a Portainer instance
 * @param {number} id - Instance ID
 * @param {string} name - Instance name
 * @param {string} url - Portainer URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<void>}
 */
function updatePortainerInstance(id, name, url, username, password, apiKey = null, authType = 'apikey') {
  return new Promise((resolve, reject) => {
    // Use appropriate fields based on auth type
    // IMPORTANT: When switching auth methods, explicitly clear the old method's data
    // Use empty strings instead of null to satisfy NOT NULL constraints
    const finalUsername = authType === 'apikey' ? '' : (username || '');
    const finalPassword = authType === 'apikey' ? '' : (password || '');
    // Clear API key when using password auth, set it when using API key auth
    const finalApiKey = authType === 'apikey' ? (apiKey || null) : null;

    db.run(
      "UPDATE portainer_instances SET name = ?, url = ?, username = ?, password = ?, api_key = ?, auth_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [name, url, finalUsername, finalPassword, finalApiKey, authType, id],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Delete a Portainer instance
 * @param {number} id - Instance ID
 * @returns {Promise<void>}
 */
function deletePortainerInstance(id) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM portainer_instances WHERE id = ?",
      [id],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Update display order of Portainer instances
 * @param {Array<{id: number, display_order: number}>} orders - Array of id and display_order pairs
 * @returns {Promise<void>}
 */
function updatePortainerInstanceOrder(orders) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      const stmt = db.prepare(
        "UPDATE portainer_instances SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );

      let completed = 0;
      let hasError = false;

      orders.forEach(({ id, display_order }) => {
        stmt.run([display_order, id], (err) => {
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
  });
}

/**
 * Get Docker Hub credentials
 * @returns {Promise<Object|null>} - Docker Hub credentials or null
 */
function getDockerHubCredentials() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT username, token, updated_at FROM docker_hub_credentials WHERE id = 1",
      [],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Update Docker Hub credentials
 * Uses INSERT OR REPLACE to ensure only one row exists (id = 1)
 * @param {string} username - Docker Hub username
 * @param {string} token - Docker Hub personal access token
 * @returns {Promise<void>}
 */
function updateDockerHubCredentials(username, token) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO docker_hub_credentials (id, username, token, updated_at) 
       VALUES (1, ?, ?, CURRENT_TIMESTAMP)`,
      [username, token],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Delete Docker Hub credentials
 * @returns {Promise<void>}
 */
function deleteDockerHubCredentials() {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM docker_hub_credentials WHERE id = 1",
      [],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get cached container data
 * @param {string} cacheKey - Cache key (e.g., 'containers')
 * @returns {Promise<Object|null>} - Cached data or null
 */
function getContainerCache(cacheKey) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT cache_data, updated_at FROM container_cache WHERE cache_key = ?",
      [cacheKey],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            try {
              resolve(JSON.parse(row.cache_data));
            } catch (parseErr) {
              console.error("Error parsing cached data:", parseErr);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      }
    );
  });
}

/**
 * Store container data in cache
 * @param {string} cacheKey - Cache key (e.g., 'containers')
 * @param {Object} data - Data to cache
 * @returns {Promise<void>}
 */
function setContainerCache(cacheKey, data) {
  return new Promise((resolve, reject) => {
    const cacheData = JSON.stringify(data);
    db.run(
      `INSERT OR REPLACE INTO container_cache (cache_key, cache_data, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [cacheKey, cacheData],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Clear all container cache
 * @returns {Promise<void>}
 */
function clearContainerCache() {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM container_cache", [], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get batch configuration
 * @returns {Promise<Object|null>} - Batch configuration or null
 */
function getBatchConfig() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT enabled, interval_minutes, updated_at FROM batch_config WHERE id = 1",
      [],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            resolve({
              enabled: row.enabled === 1,
              intervalMinutes: row.interval_minutes,
              updatedAt: row.updated_at,
            });
          } else {
            // Return default if no row exists
            resolve({
              enabled: false,
              intervalMinutes: 60,
              updatedAt: null,
            });
          }
        }
      }
    );
  });
}

/**
 * Update batch configuration
 * Uses INSERT OR REPLACE to ensure only one row exists (id = 1)
 * @param {boolean} enabled - Whether batch processing is enabled
 * @param {number} intervalMinutes - Interval in minutes between batch runs
 * @returns {Promise<void>}
 */
function updateBatchConfig(enabled, intervalMinutes) {
  return new Promise((resolve, reject) => {
    // Validate interval
    if (intervalMinutes < 1) {
      reject(new Error("Interval must be at least 1 minute"));
      return;
    }
    if (intervalMinutes > 1440) {
      reject(new Error("Interval cannot exceed 1440 minutes (24 hours)"));
      return;
    }

    db.run(
      `INSERT OR REPLACE INTO batch_config (id, enabled, interval_minutes, updated_at) 
       VALUES (1, ?, ?, CURRENT_TIMESTAMP)`,
      [enabled ? 1 : 0, intervalMinutes],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Create a new batch run record
 * @param {string} status - Run status ('running', 'completed', 'failed')
 * @returns {Promise<number>} - ID of created batch run
 */
function createBatchRun(status = 'running', jobType = 'docker-hub-pull') {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO batch_runs (status, job_type, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      [status, jobType],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      }
    );
  });
}

/**
 * Update batch run with completion information
 * @param {number} runId - Batch run ID
 * @param {string} status - Final status ('completed', 'failed')
 * @param {number} containersChecked - Number of containers checked
 * @param {number} containersUpdated - Number of containers with updates found
 * @param {string} errorMessage - Error message if failed
 * @param {string} logs - Log output from the run
 * @returns {Promise<void>}
 */
function updateBatchRun(runId, status, containersChecked = 0, containersUpdated = 0, errorMessage = null, logs = null) {
  return new Promise((resolve, reject) => {
    // Calculate duration
    db.get(
      "SELECT started_at FROM batch_runs WHERE id = ?",
      [runId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (!row) {
          reject(new Error('Batch run not found'));
          return;
        }

        // Parse started_at as UTC (SQLite DATETIME is stored as UTC without timezone info)
        const startedAtStr = row.started_at;
        let startedAt;
        if (typeof startedAtStr === 'string' && /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)) {
          // SQLite datetime format - convert to ISO and add Z for UTC
          startedAt = new Date(startedAtStr.replace(' ', 'T') + 'Z');
        } else {
          startedAt = new Date(startedAtStr);
        }
        
        // Use current time in UTC for consistency
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();

        db.run(
          `UPDATE batch_runs 
           SET status = ?, completed_at = CURRENT_TIMESTAMP, duration_ms = ?, 
               containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?
           WHERE id = ?`,
          [status, durationMs, containersChecked, containersUpdated, errorMessage, logs, runId],
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
  });
}

/**
 * Get batch run by ID
 * @param {number} runId - Batch run ID
 * @returns {Promise<Object|null>} - Batch run or null
 */
function getBatchRunById(runId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM batch_runs WHERE id = ?",
      [runId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Get recent batch runs
 * @param {number} limit - Maximum number of runs to return (default: 50)
 * @returns {Promise<Array>} - Array of batch runs
 */
function getRecentBatchRuns(limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT ?",
      [limit],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Get the most recent batch run
 * @returns {Promise<Object|null>} - Most recent batch run or null
 */
function getLatestBatchRun() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 1",
      [],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Close database connection
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        console.log("Database connection closed");
        resolve();
      }
    });
  });
}

module.exports = {
  db,
  getUserByUsername,
  getUserById,
  verifyPassword,
  updatePassword,
  updateUsername,
  createUser,
  getAllPortainerInstances,
  getPortainerInstanceById,
  createPortainerInstance,
  updatePortainerInstance,
  deletePortainerInstance,
  updatePortainerInstanceOrder,
  getDockerHubCredentials,
  updateDockerHubCredentials,
  deleteDockerHubCredentials,
  getContainerCache,
  setContainerCache,
  clearContainerCache,
  getBatchConfig,
  updateBatchConfig,
  createBatchRun,
  updateBatchRun,
  getBatchRunById,
  getRecentBatchRuns,
  getLatestBatchRun,
  closeDatabase,
};
