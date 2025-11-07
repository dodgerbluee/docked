/**
 * Database Configuration
 * SQLite database for user storage
 * 
 * Note: For production, consider using PostgreSQL or MySQL
 * SQLite is fine for single-instance deployments
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'users.db');

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
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
        role TEXT DEFAULT 'admin',
        password_changed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error('Error creating users table:', err.message);
        } else {
          console.log('Users table ready');
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
          console.error('Error creating portainer_instances table:', err.message);
        } else {
          console.log('Portainer instances table ready');
          // Add display_order column if it doesn't exist (migration)
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN display_order INTEGER DEFAULT 0`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes('duplicate column')) {
                console.error('Error adding display_order column:', alterErr.message);
              }
            }
          );
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
          console.error('Error creating docker_hub_credentials table:', err.message);
        } else {
          console.log('Docker Hub credentials table ready');
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
          console.error('Error creating container_cache table:', err.message);
        } else {
          console.log('Container cache table ready');
        }
      }
    );
  });
}

/**
 * Create default admin user if no users exist
 */
async function createDefaultAdmin() {
  db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
    if (err) {
      console.error('Error checking users:', err.message);
      return;
    }

    if (row.count === 0) {
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      
      db.run(
        'INSERT INTO users (username, password_hash, role, password_changed) VALUES (?, ?, ?, ?)',
        ['admin', passwordHash, 'admin', 0],
        (err) => {
          if (err) {
            console.error('Error creating default admin:', err.message);
          } else {
            console.log('Default admin user created (username: admin, password: admin)');
            console.log('⚠️  Password change will be required on first login!');
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
    db.get(
      'SELECT * FROM users WHERE username = ?',
      [username],
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
 * Get user by ID
 * @param {number} id - User ID
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
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
async function updatePassword(username, newPassword, markPasswordChanged = true) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET password_hash = ?, password_changed = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
      [passwordHash, markPasswordChanged ? 1 : 0, username],
      function(err) {
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
      'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
      [newUsername, oldUsername],
      function(err) {
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
async function createUser(username, password, role = 'admin') {
  const passwordHash = await bcrypt.hash(password, 10);
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, role],
      function(err) {
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
      'SELECT id, name, url, username, password, display_order, created_at, updated_at FROM portainer_instances ORDER BY display_order ASC, created_at ASC',
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
      'SELECT id, name, url, username, password, display_order, created_at, updated_at FROM portainer_instances WHERE id = ?',
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
function createPortainerInstance(name, url, username, password) {
  return new Promise((resolve, reject) => {
    // Get max display_order to set new instance at the end
    db.get('SELECT MAX(display_order) as max_order FROM portainer_instances', [], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      const nextOrder = (row?.max_order ?? -1) + 1;
      
      db.run(
        'INSERT INTO portainer_instances (name, url, username, password, display_order) VALUES (?, ?, ?, ?, ?)',
        [name, url, username, password, nextOrder],
        function(insertErr) {
          if (insertErr) {
            reject(insertErr);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
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
function updatePortainerInstance(id, name, url, username, password) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE portainer_instances SET name = ?, url = ?, username = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, url, username, password, id],
      function(err) {
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
      'DELETE FROM portainer_instances WHERE id = ?',
      [id],
      function(err) {
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
      db.run('BEGIN TRANSACTION');
      
      const stmt = db.prepare('UPDATE portainer_instances SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      
      let completed = 0;
      let hasError = false;
      
      orders.forEach(({ id, display_order }) => {
        stmt.run([display_order, id], (err) => {
          if (err && !hasError) {
            hasError = true;
            db.run('ROLLBACK');
            reject(err);
          } else {
            completed++;
            if (completed === orders.length && !hasError) {
              stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                  db.run('ROLLBACK');
                  reject(finalizeErr);
                } else {
                  db.run('COMMIT', (commitErr) => {
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
      'SELECT username, token, updated_at FROM docker_hub_credentials WHERE id = 1',
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
      function(err) {
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
      'DELETE FROM docker_hub_credentials WHERE id = 1',
      [],
      function(err) {
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
      'SELECT cache_data, updated_at FROM container_cache WHERE cache_key = ?',
      [cacheKey],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            try {
              resolve(JSON.parse(row.cache_data));
            } catch (parseErr) {
              console.error('Error parsing cached data:', parseErr);
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
      function(err) {
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
    db.run('DELETE FROM container_cache', [], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
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
        console.log('Database connection closed');
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
  closeDatabase,
};

