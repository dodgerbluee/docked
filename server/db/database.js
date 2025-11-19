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
const os = require("os");
const bcrypt = require("bcrypt");
const logger = require("../utils/logger");

// Use DATA_DIR environment variable or default to /data
// This allows the database to be stored outside the codebase
// In test environment, default to temp directory
function getDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "docked-test-data");
  }
  return "/data";
}

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, "users.db");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info(`Created data directory: ${DATA_DIR}`);
  } catch (err) {
    // In test environment, don't throw - just log the error
    if (process.env.NODE_ENV === "test") {
      logger.error(`Failed to create test data directory: ${DATA_DIR}`, err);
    } else {
      logger.error(`Failed to create data directory: ${DATA_DIR}`, err);
      // Don't throw - allow server to start even if data directory creation fails
      // The database will handle errors when trying to connect
    }
  }
}

// Create database connection
let dbConnectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 1; // Only allow one connection attempt
let dbConnectionEstablished = false;

// Create database connection synchronously but handle errors gracefully
let db;
try {
  db = new sqlite3.Database(DB_PATH, (err) => {
  dbConnectionAttempts++;
  
  // Prevent multiple connection attempts
  if (dbConnectionAttempts > MAX_CONNECTION_ATTEMPTS) {
    logger.warn(`Database connection callback called ${dbConnectionAttempts} times. Ignoring subsequent calls.`);
    return;
  }
  
  if (err) {
    logger.error("Error opening database:", { error: err });
    logger.error("Stack:", { error: err });
    // Don't throw - let the server continue even if database connection fails initially
    // The database will be retried on next access
  } else {
    dbConnectionEstablished = true;
    logger.info(`Connected to SQLite database at ${DB_PATH}`);
    // Use setImmediate to defer initialization and prevent blocking
    setImmediate(() => {
      try {
        initializeDatabase();
      } catch (initError) {
        logger.error("Error initializing database:", initError);
        logger.error("Stack:", { error: initError });
        // Don't throw - log the error but don't crash the server
        // Database operations will fail gracefully if needed
      }
    });
  }
});

  // Handle database errors to prevent crashes
  if (db) {
    db.on("error", (err) => {
      logger.error("Database error:", { error: err });
      logger.error("Stack:", { error: err });
      // Don't throw - just log the error
    });
  }
} catch (dbInitError) {
  logger.error("Failed to create database connection:", dbInitError);
  logger.error("Stack:", { error: dbInitError });
  // Create a dummy db object to prevent crashes when functions try to use it
  // Functions will check for db existence and handle errors gracefully
  db = {
    run: () => {},
    get: () => {},
    all: () => {},
    serialize: (cb) => { if (cb) cb(); },
    close: () => {},
  };
}

/**
 * Initialize database schema
 */
let initializationStarted = false;
function initializeDatabase() {
  // Prevent multiple initializations
  if (initializationStarted) {
    logger.warn("Database initialization already started, skipping duplicate call");
    return;
  }
  
  // Check if database connection exists
  if (!db) {
    logger.error("Cannot initialize database - database connection not available");
    return;
  }
  
  initializationStarted = true;
  
  try {
    db.serialize(() => {
      try {
        // Create users table
        db.run(
          `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'Administrator',
            password_changed INTEGER DEFAULT 0,
            instance_admin INTEGER DEFAULT 0,
            verification_token TEXT,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          (err) => {
            if (err) {
              logger.error("Error creating users table:", { error: err });
            } else {
          logger.info("Users table ready");
          // Create indexes for users table
          db.run("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              logger.error("Error creating username index:", { error: idxErr });
            }
          });
        }
      }
    );

    // Create portainer_instances table
    db.run(
      `CREATE TABLE IF NOT EXISTS portainer_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
            url TEXT NOT NULL,
            username TEXT,
            password TEXT,
            api_key TEXT,
            auth_type TEXT DEFAULT 'password',
            ip_address TEXT,
        display_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, url)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating portainer_instances table:", { error: err });
        } else {
          logger.info("Portainer instances table ready");
          // Create indexes for portainer_instances table
          // Note: user_id index may fail if table exists without user_id column (migration will fix this)
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_portainer_user_id ON portainer_instances(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists") && !idxErr.message.includes("no such column")) {
                    logger.error("Error creating user_id index:", { error: idxErr });
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug("user_id column doesn't exist yet - index will be created after migration");
                  }
                }
              );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_url ON portainer_instances(url)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer URL index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_display_order ON portainer_instances(display_order)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating display_order index:", { error: idxErr });
              }
            }
          );
        }
      }
    );

    // Create docker_hub_credentials table (per user)
    db.run(
      `CREATE TABLE IF NOT EXISTS docker_hub_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT,
        token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating docker_hub_credentials table:", { error: err });
        } else {
          logger.info("Docker Hub credentials table ready");
        }
      }
    );

    // Create tracked_images table
    db.run(
      `CREATE TABLE IF NOT EXISTS tracked_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        image_name TEXT,
        github_repo TEXT,
            source_type TEXT DEFAULT 'docker',
            gitlab_token TEXT,
        current_version TEXT,
        current_digest TEXT,
        latest_version TEXT,
        latest_digest TEXT,
        has_update INTEGER DEFAULT 0,
        current_version_publish_date TEXT,
            latest_version_publish_date TEXT,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, image_name, github_repo)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating tracked_images table:", { error: err });
        } else {
          logger.info("Tracked images table ready");
              // Create indexes
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_user_id ON tracked_images(user_id)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images user_id index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_name ON tracked_images(name)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images name index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_image_name ON tracked_images(image_name)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images image_name index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_github_repo ON tracked_images(github_repo)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images github_repo index:", { error: idxErr });
              }
            }
          );
        }
      }
    );

    // Create docker_hub_image_versions table to track Docker Hub image version information per user
    db.run(
      `CREATE TABLE IF NOT EXISTS docker_hub_image_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image_name TEXT NOT NULL,
        image_repo TEXT NOT NULL,
        registry TEXT DEFAULT 'docker.io',
        namespace TEXT,
        repository TEXT NOT NULL,
        current_tag TEXT,
        current_version TEXT,
        current_digest TEXT,
        latest_tag TEXT,
        latest_version TEXT,
        latest_digest TEXT,
        has_update INTEGER DEFAULT 0,
        latest_publish_date TEXT,
        current_version_publish_date TEXT,
        exists_in_docker_hub INTEGER DEFAULT 0,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, image_repo),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating docker_hub_image_versions table:", { error: err });
        } else {
          logger.info("Docker Hub image versions table ready");
          // Create indexes for docker_hub_image_versions table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_docker_hub_image_versions_user_id ON docker_hub_image_versions(user_id)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating docker_hub_image_versions user_id index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_docker_hub_image_versions_user_has_update ON docker_hub_image_versions(user_id, has_update)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating docker_hub_image_versions user_has_update index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_docker_hub_image_versions_image_repo ON docker_hub_image_versions(image_repo)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating docker_hub_image_versions image_repo index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_docker_hub_image_versions_last_checked ON docker_hub_image_versions(last_checked)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating docker_hub_image_versions last_checked index:", { error: idxErr });
              }
            }
          );
        }
      }
    );

    // Create portainer_containers table to store Portainer container state per user
    db.run(
      `CREATE TABLE IF NOT EXISTS portainer_containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER NOT NULL,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
        image_name TEXT NOT NULL,
        image_repo TEXT NOT NULL,
        status TEXT,
        state TEXT,
        stack_name TEXT,
        current_digest TEXT,
        image_created_date TEXT,
        uses_network_mode INTEGER DEFAULT 0,
        provides_network INTEGER DEFAULT 0,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, container_id, portainer_instance_id, endpoint_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating portainer_containers table:", { error: err });
        } else {
          logger.info("Portainer containers table ready");
          // Create indexes for portainer_containers table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_containers_user_id ON portainer_containers(user_id)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer_containers user_id index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_containers_instance ON portainer_containers(portainer_instance_id)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer_containers instance index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_containers_image_repo ON portainer_containers(image_repo)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer_containers image_repo index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_containers_last_seen ON portainer_containers(last_seen)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer_containers last_seen index:", { error: idxErr });
              }
            }
          );
        }
      }
    );

    // Create batch_config table (per user, per job type)
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        job_type TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, job_type)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating batch_config table:", { error: err });
        } else {
          logger.info("Batch config table ready");
            }
      }
    );

    // Create settings table for application settings
    db.run(
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key TEXT NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, key)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating settings table:", { error: err });
        } else {
          logger.info("Settings table ready");
          // Create indexes for settings table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating settings user_id index:", { error: idxErr });
              }
            }
          );
          db.run("CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              logger.error("Error creating settings key index:", { error: idxErr });
            }
          });
        }
      }
    );

    // Create discord_webhooks table for multiple webhook configurations
    db.run(
      `CREATE TABLE IF NOT EXISTS discord_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        webhook_url TEXT NOT NULL,
        server_name TEXT,
        channel_name TEXT,
        name TEXT,
        avatar_url TEXT,
        guild_id TEXT,
        channel_id TEXT,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating discord_webhooks table:", { error: err });
        } else {
          logger.info("Discord webhooks table ready");
          // Create indexes for discord_webhooks table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_user_id ON discord_webhooks(user_id)",
            (idxErr) => {
              // Ignore "no such column" errors - these are expected if table exists from old schema
              // Migration will handle adding the column and recreating the index
              if (idxErr && !idxErr.message.includes("already exists") && !idxErr.message.includes("no such column")) {
                logger.error("Error creating discord_webhooks user_id index:", { error: idxErr });
              } else if (idxErr && idxErr.message.includes("no such column")) {
                logger.debug("Discord webhooks table exists without user_id column - migration will handle this");
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_enabled ON discord_webhooks(enabled)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating discord_webhooks enabled index:", { error: idxErr });
              }
            }
          );
        }
      }
    );

    // Create batch_runs table to track batch execution history (per user)
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        job_type TEXT DEFAULT 'docker-hub-pull',
            status TEXT NOT NULL,
            is_manual INTEGER DEFAULT 0,
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
          logger.error("Error creating batch_runs table:", { error: err });
        } else {
          logger.info("Batch runs table ready");
          // Create indexes for batch_runs table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_batch_runs_started_at ON batch_runs(started_at DESC)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating batch_runs started_at index:", { error: idxErr });
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating batch_runs status index:", { error: idxErr });
              }
            }
          );
            }
          }
        );

      } catch (serializeError) {
        logger.error("Error in db.serialize callback:", serializeError);
        logger.error("Stack:", { error: serializeError });
      }
    });
    
    logger.info("Database initialization completed");
  } catch (initError) {
    logger.error("Error in initializeDatabase:", initError);
    logger.error("Stack:", { error: initError });
    initializationStarted = false; // Allow retry on next call
  }
}

/**
 * Get user by username
 * @param {string} username - Username to lookup
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
 * Update last login timestamp
 * @param {string} username - Username
 * @returns {Promise<void>}
 */
function updateLastLogin(username) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
  });
}

/**
 * Get all users (for admin purposes)
 * @returns {Promise<Array>} - Array of user objects
 */
function getAllUsers() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    // Use SELECT * to handle missing columns gracefully (for migration compatibility)
    db.all(
      "SELECT * FROM users ORDER BY created_at ASC",
      [],
      (err, rows) => {
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
      }
    );
  });
}

/**
 * Wait for database to be ready (users table exists)
 * @param {number} maxRetries - Maximum number of retries (default: 10)
 * @param {number} retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<void>}
 */
function waitForDatabase(maxRetries = 10, retryDelay = 100) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    let retries = 0;
    const checkTable = () => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) {
          if (retries < maxRetries) {
            retries++;
            setTimeout(checkTable, retryDelay);
          } else {
            reject(new Error(`Database not ready after ${maxRetries} retries: ${err.message}`));
          }
        } else if (row) {
          resolve();
        } else {
          if (retries < maxRetries) {
            retries++;
            setTimeout(checkTable, retryDelay);
          } else {
            reject(new Error(`Database not ready after ${maxRetries} retries: users table not found`));
          }
        }
      });
    };
    checkTable();
  });
}

/**
 * Check if any users exist
 * @returns {Promise<boolean>} True if any users exist
 */
function hasAnyUsers() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }
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
  });
}

/**
 * Create a new user
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @param {string} email - User email (optional)
 * @param {string} role - User role (default: 'Administrator')
 * @param {boolean} passwordChanged - Whether password has been changed (default: true for registered users)
 * @param {boolean} instanceAdmin - Whether user is instance admin (default: false)
 * @returns {Promise<void>}
 */
async function createUser(
  username,
  password,
  email = null,
  role = "Administrator",
  passwordChanged = true,
  instanceAdmin = false
) {
  const passwordHash = await bcrypt.hash(password, 10);
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      "INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin) VALUES (?, ?, ?, ?, ?, ?)",
      [username, passwordHash, email, role, passwordChanged ? 1 : 0, instanceAdmin ? 1 : 0],
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
 * Update verification token for a user
 * @param {string} username - Username
 * @param {string} token - Verification token
 * @returns {Promise<void>}
 */
function updateVerificationToken(username, token) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
  });
}

/**
 * Get all Portainer instances for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of Portainer instances
 */
function getAllPortainerInstances(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT MAX(display_order) as max_order FROM portainer_instances WHERE user_id = ?", [userId], (err, row) => {
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
        [userId, name, url, finalUsername, finalPassword, finalApiKey, authType, nextOrder, ipAddress],
        function (insertErr) {
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run("DELETE FROM portainer_instances WHERE id = ? AND user_id = ?", [id, userId], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
  });
}

/**
 * Get Docker Hub credentials for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Docker Hub credentials or null
 */
function getDockerHubCredentials(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
  });
}

/**
 * Delete Docker Hub credentials for a user
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteDockerHubCredentials(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run("DELETE FROM docker_hub_credentials WHERE user_id = ?", [userId], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Upsert Docker Hub image version information
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository (without tag, e.g., "nginx")
 * @param {Object} versionData - Version data to store
 * @returns {Promise<number>} - ID of the record
 */
function upsertDockerHubImageVersion(userId, imageRepo, versionData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    const {
      imageName = null,
      registry = "docker.io",
      namespace = null,
      repository = null,
      currentTag = null,
      currentVersion = null,
      currentDigest = null,
      latestTag = null,
      latestVersion = null,
      latestDigest = null,
      hasUpdate = false,
      latestPublishDate = null,
      currentVersionPublishDate = null,
      existsInDockerHub = true,
    } = versionData;

    db.run(
      `INSERT OR REPLACE INTO docker_hub_image_versions (
        user_id, image_name, image_repo, registry, namespace, repository,
        current_tag, current_version, current_digest,
        latest_tag, latest_version, latest_digest,
        has_update, latest_publish_date, current_version_publish_date,
        exists_in_docker_hub, last_checked, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        userId,
        imageName || imageRepo,
        imageRepo,
        registry,
        namespace,
        repository || imageRepo,
        currentTag,
        currentVersion,
        currentDigest,
        latestTag,
        latestVersion,
        latestDigest,
        hasUpdate ? 1 : 0,
        latestPublishDate,
        currentVersionPublishDate,
        existsInDockerHub ? 1 : 0,
      ],
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
 * Get Docker Hub version info for a specific image repo
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @returns {Promise<Object|null>} - Version info or null
 */
function getDockerHubImageVersion(userId, imageRepo) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get(
      `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND image_repo = ?`,
      [userId, imageRepo],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            resolve({
              id: row.id,
              userId: row.user_id,
              imageName: row.image_name,
              imageRepo: row.image_repo,
              registry: row.registry,
              namespace: row.namespace,
              repository: row.repository,
              currentTag: row.current_tag,
              currentVersion: row.current_version,
              currentDigest: row.current_digest,
              latestTag: row.latest_tag,
              latestVersion: row.latest_version,
              latestDigest: row.latest_digest,
              hasUpdate: row.has_update === 1,
              latestPublishDate: row.latest_publish_date,
              currentVersionPublishDate: row.current_version_publish_date,
              existsInDockerHub: row.exists_in_docker_hub === 1,
              lastChecked: row.last_checked,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            });
          } else {
            resolve(null);
          }
        }
      }
    );
  });
}

/**
 * Get Docker Hub versions for multiple image repos (batch)
 * @param {number} userId - User ID
 * @param {Array<string>} imageRepos - Array of image repositories
 * @returns {Promise<Map>} - Map of imageRepo -> version info
 */
function getDockerHubImageVersionsBatch(userId, imageRepos) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (!imageRepos || imageRepos.length === 0) {
      resolve(new Map());
      return;
    }

    const placeholders = imageRepos.map(() => "?").join(",");
    db.all(
      `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND image_repo IN (${placeholders})`,
      [userId, ...imageRepos],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const versionMap = new Map();
          rows.forEach((row) => {
            versionMap.set(row.image_repo, {
              id: row.id,
              userId: row.user_id,
              imageName: row.image_name,
              imageRepo: row.image_repo,
              registry: row.registry,
              namespace: row.namespace,
              repository: row.repository,
              currentTag: row.current_tag,
              currentVersion: row.current_version,
              currentDigest: row.current_digest,
              latestTag: row.latest_tag,
              latestVersion: row.latest_version,
              latestDigest: row.latest_digest,
              hasUpdate: row.has_update === 1,
              latestPublishDate: row.latest_publish_date,
              currentVersionPublishDate: row.current_version_publish_date,
              existsInDockerHub: row.exists_in_docker_hub === 1,
              lastChecked: row.last_checked,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            });
          });
          resolve(versionMap);
        }
      }
    );
  });
}

/**
 * Get all images with updates for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of images with updates
 */
function getDockerHubImagesWithUpdates(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all(
      `SELECT * FROM docker_hub_image_versions WHERE user_id = ? AND has_update = 1 ORDER BY updated_at DESC`,
      [userId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const versions = rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            imageName: row.image_name,
            imageRepo: row.image_repo,
            registry: row.registry,
            namespace: row.namespace,
            repository: row.repository,
            currentTag: row.current_tag,
            currentVersion: row.current_version,
            currentDigest: row.current_digest,
            latestTag: row.latest_tag,
            latestVersion: row.latest_version,
            latestDigest: row.latest_digest,
            hasUpdate: true,
            latestPublishDate: row.latest_publish_date,
            currentVersionPublishDate: row.current_version_publish_date,
            existsInDockerHub: row.exists_in_docker_hub === 1,
            lastChecked: row.last_checked,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
          resolve(versions);
        }
      }
    );
  });
}

/**
 * Update Docker Hub version after container upgrade
 * @param {number} userId - User ID
 * @param {string} imageRepo - Image repository
 * @param {string} newDigest - New digest after upgrade
 * @param {string} newVersion - New version after upgrade
 * @returns {Promise<void>}
 */
function markDockerHubImageUpToDate(userId, imageRepo, newDigest, newVersion) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `UPDATE docker_hub_image_versions 
       SET current_digest = ?, current_version = ?, latest_digest = ?, 
           latest_version = ?, has_update = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND image_repo = ?`,
      [newDigest, newVersion, newDigest, newVersion, userId, imageRepo],
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
 * Upsert Portainer container data
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {Object} containerData - Container data
 * @returns {Promise<number>} - ID of the record
 */
function upsertPortainerContainer(userId, portainerInstanceId, containerData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    const {
      containerId,
      containerName,
      endpointId,
      imageName,
      imageRepo,
      status = null,
      state = null,
      stackName = null,
      currentDigest = null,
      imageCreatedDate = null,
      usesNetworkMode = false,
      providesNetwork = false,
    } = containerData;

    db.run(
      `INSERT OR REPLACE INTO portainer_containers (
        user_id, portainer_instance_id, container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        current_digest, image_created_date, uses_network_mode, provides_network,
        last_seen, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        userId,
        portainerInstanceId,
        containerId,
        containerName,
        endpointId,
        imageName,
        imageRepo,
        status,
        state,
        stackName,
        currentDigest,
        imageCreatedDate,
        usesNetworkMode ? 1 : 0,
        providesNetwork ? 1 : 0,
      ],
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
 * Upsert Portainer container and Docker Hub version data in a single transaction
 * Ensures atomicity - both succeed or both fail
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {Object} containerData - Container data
 * @param {Object} versionData - Docker Hub version data (optional)
 * @returns {Promise<{containerId: number, versionId: number|null}>} - IDs of created/updated records
 */
function upsertContainerWithVersion(userId, portainerInstanceId, containerData, versionData = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    db.serialize(() => {
      db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
        if (beginErr) {
          db.run("ROLLBACK");
          reject(beginErr);
          return;
        }

        // Upsert container
        const {
          containerId,
          containerName,
          endpointId,
          imageName,
          imageRepo,
          status = null,
          state = null,
          stackName = null,
          currentDigest = null,
          imageCreatedDate = null,
          usesNetworkMode = false,
          providesNetwork = false,
        } = containerData;

        db.run(
          `INSERT OR REPLACE INTO portainer_containers (
            user_id, portainer_instance_id, container_id, container_name, endpoint_id,
            image_name, image_repo, status, state, stack_name,
            current_digest, image_created_date, uses_network_mode, provides_network,
            last_seen, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            userId,
            portainerInstanceId,
            containerId,
            containerName,
            endpointId,
            imageName,
            imageRepo,
            status,
            state,
            stackName,
            currentDigest,
            imageCreatedDate,
            usesNetworkMode ? 1 : 0,
            providesNetwork ? 1 : 0,
          ],
          function (containerErr) {
            if (containerErr) {
              db.run("ROLLBACK");
              reject(containerErr);
              return;
            }

            const containerRecordId = this.lastID;

            // If version data is provided, upsert it
            if (versionData && imageRepo) {
              const {
                imageName: vImageName = imageName,
                registry = "docker.io",
                namespace = null,
                repository = null,
                currentTag = null,
                currentVersion = null,
                currentDigest: vCurrentDigest = currentDigest,
                latestTag = null,
                latestVersion = null,
                latestDigest = null,
                hasUpdate = false,
                latestPublishDate = null,
                currentVersionPublishDate = null,
                existsInDockerHub = true,
              } = versionData;

              db.run(
                `INSERT OR REPLACE INTO docker_hub_image_versions (
                  user_id, image_name, image_repo, registry, namespace, repository,
                  current_tag, current_version, current_digest,
                  latest_tag, latest_version, latest_digest,
                  has_update, latest_publish_date, current_version_publish_date,
                  exists_in_docker_hub, last_checked, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [
                  userId,
                  vImageName || imageRepo,
                  imageRepo,
                  registry,
                  namespace,
                  repository || imageRepo,
                  currentTag,
                  currentVersion,
                  vCurrentDigest,
                  latestTag,
                  latestVersion,
                  latestDigest,
                  hasUpdate ? 1 : 0,
                  latestPublishDate,
                  currentVersionPublishDate,
                  existsInDockerHub ? 1 : 0,
                ],
                function (versionErr) {
                  if (versionErr) {
                    db.run("ROLLBACK");
                    reject(versionErr);
                    return;
                  }

                  // Both succeeded - commit transaction
                  db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                      reject(commitErr);
                    } else {
                      resolve({
                        containerId: containerRecordId,
                        versionId: this.lastID,
                      });
                    }
                  });
                }
              );
            } else {
              // No version data - just commit container update
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  reject(commitErr);
                } else {
                  resolve({
                    containerId: containerRecordId,
                    versionId: null,
                  });
                }
              });
            }
          }
        );
      });
    });
  });
}

/**
 * Get all Portainer containers for a user
 * @param {number} userId - User ID
 * @param {string|null} portainerUrl - Optional filter by Portainer URL
 * @returns {Promise<Array>} - Array of containers
 */
function getPortainerContainers(userId, portainerUrl = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    let query = `SELECT pc.* FROM portainer_containers pc`;
    const params = [userId];

    if (portainerUrl) {
      query += ` JOIN portainer_instances pi ON pc.portainer_instance_id = pi.id 
                 WHERE pc.user_id = ? AND pi.url = ?`;
      params.push(portainerUrl);
    } else {
      query += ` WHERE pc.user_id = ?`;
    }

    query += ` ORDER BY pc.last_seen DESC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const containers = rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          portainerInstanceId: row.portainer_instance_id,
          containerId: row.container_id,
          containerName: row.container_name,
          endpointId: row.endpoint_id,
          imageName: row.image_name,
          imageRepo: row.image_repo,
          status: row.status,
          state: row.state,
          stackName: row.stack_name,
          currentDigest: row.current_digest,
          imageCreatedDate: row.image_created_date,
          usesNetworkMode: row.uses_network_mode === 1,
          providesNetwork: row.provides_network === 1,
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        resolve(containers);
      }
    });
  });
}

/**
 * Get Portainer containers with Docker Hub update info (JOIN query)
 * @param {number} userId - User ID
 * @param {string|null} portainerUrl - Optional filter
 * @returns {Promise<Array>} - Containers with update info
 */
function getPortainerContainersWithUpdates(userId, portainerUrl = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    let query = `SELECT 
      pc.*,
      dh.latest_digest as dh_latest_digest,
      dh.latest_version as dh_latest_version,
      dh.latest_tag as dh_latest_tag,
      dh.has_update as dh_has_update,
      dh.latest_publish_date as dh_latest_publish_date
    FROM portainer_containers pc
    LEFT JOIN docker_hub_image_versions dh 
      ON pc.user_id = dh.user_id AND pc.image_repo = dh.image_repo`;

    const params = [userId];

    if (portainerUrl) {
      query += ` JOIN portainer_instances pi ON pc.portainer_instance_id = pi.id 
                 WHERE pc.user_id = ? AND pi.url = ?`;
      params.push(portainerUrl);
    } else {
      query += ` WHERE pc.user_id = ?`;
    }

    query += ` ORDER BY pc.last_seen DESC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
        const normalizeDigest = (digest) => {
          if (!digest) {
            return null;
          }
          // Ensure digest starts with sha256: for consistent comparison
          return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
        };

        const containers = rows.map((row) => {
          // Compute hasUpdate per-container by comparing this container's currentDigest
          // to the Docker Hub latestDigest (not using the shared hasUpdate flag)
          let hasUpdate = false;
          if (row.current_digest && row.dh_latest_digest) {
            const normalizedCurrent = normalizeDigest(row.current_digest);
            const normalizedLatest = normalizeDigest(row.dh_latest_digest);
            hasUpdate = normalizedCurrent !== normalizedLatest;
          }

          return {
            id: row.id,
            userId: row.user_id,
            portainerInstanceId: row.portainer_instance_id,
            containerId: row.container_id,
            containerName: row.container_name,
            endpointId: row.endpoint_id,
            imageName: row.image_name,
            imageRepo: row.image_repo,
            status: row.status,
            state: row.state,
            stackName: row.stack_name,
            currentDigest: row.current_digest,
            imageCreatedDate: row.image_created_date,
            usesNetworkMode: row.uses_network_mode === 1,
            providesNetwork: row.provides_network === 1,
            latestDigest: row.dh_latest_digest,
            latestVersion: row.dh_latest_version,
            latestTag: row.dh_latest_tag,
            hasUpdate: hasUpdate, // Computed per-container, not from shared table
            latestPublishDate: row.dh_latest_publish_date,
            lastSeen: row.last_seen,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
        resolve(containers);
      }
    });
  });
}

/**
 * Delete Portainer containers for a specific instance
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @returns {Promise<void>}
 */
function deletePortainerContainersForInstance(userId, portainerInstanceId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `DELETE FROM portainer_containers WHERE user_id = ? AND portainer_instance_id = ?`,
      [userId, portainerInstanceId],
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
 * Delete containers that are not in the provided list (for a specific instance and endpoint)
 * Used to clean up containers that were deleted from Portainer
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {string} endpointId - Endpoint ID
 * @param {Array<string>} currentContainerIds - Array of container IDs that currently exist
 * @returns {Promise<number>} - Number of deleted records
 */
function deletePortainerContainersNotInList(userId, portainerInstanceId, endpointId, currentContainerIds) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (!currentContainerIds || currentContainerIds.length === 0) {
      // If no current containers, delete all for this instance/endpoint
      db.run(
        `DELETE FROM portainer_containers WHERE user_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
        [userId, portainerInstanceId, endpointId],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
      return;
    }
    
    // Create placeholders for the IN clause
    const placeholders = currentContainerIds.map(() => "?").join(",");
    const params = [userId, portainerInstanceId, endpointId, ...currentContainerIds];
    
    db.run(
      `DELETE FROM portainer_containers 
       WHERE user_id = ? AND portainer_instance_id = ? AND endpoint_id = ? 
       AND container_id NOT IN (${placeholders})`,
      params,
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

/**
 * Clean up stale containers (not seen in last N days)
 * @param {number} daysOld - Number of days old to consider stale
 * @returns {Promise<number>} - Number of deleted records
 */
function cleanupStalePortainerContainers(daysOld = 7) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `DELETE FROM portainer_containers WHERE last_seen < datetime('now', '-' || ? || ' days')`,
      [daysOld],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

/**
 * Clear all Portainer containers and Docker Hub versions for a user
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function clearUserContainerData(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`DELETE FROM portainer_containers WHERE user_id = ?`, [userId], (err1) => {
        if (err1) {
          db.run("ROLLBACK");
          reject(err1);
        } else {
          db.run(`DELETE FROM docker_hub_image_versions WHERE user_id = ?`, [userId], (err2) => {
            if (err2) {
              db.run("ROLLBACK");
              reject(err2);
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
      });
    });
  });
}

/**
 * Get batch configuration for a specific job type or all job types for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Optional job type. If null, returns all configs.
 * @returns {Promise<Object|null>} - Batch configuration(s) or null
 */
function getBatchConfig(userId, jobType = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (jobType) {
      db.get(
        "SELECT enabled, interval_minutes, updated_at FROM batch_config WHERE user_id = ? AND job_type = ?",
        [userId, jobType],
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
              resolve({
                enabled: false,
                intervalMinutes: 60,
                updatedAt: null,
              });
            }
          }
        }
      );
    } else {
      db.all(
        "SELECT job_type, enabled, interval_minutes, updated_at FROM batch_config WHERE user_id = ?",
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const configs = {};
            rows.forEach((row) => {
              configs[row.job_type] = {
                enabled: row.enabled === 1,
                intervalMinutes: row.interval_minutes,
                updatedAt: row.updated_at,
              };
            });
            // Default values if not configured
            if (!configs["docker-hub-pull"]) {
              configs["docker-hub-pull"] = { enabled: false, intervalMinutes: 60, updatedAt: null };
            }
            if (!configs["tracked-apps-check"]) {
              configs["tracked-apps-check"] = { enabled: false, intervalMinutes: 60, updatedAt: null };
            }
            resolve(configs);
          }
        }
      );
    }
  });
}

/**
 * Update batch configuration for a specific job type for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Job type
 * @param {boolean} enabled - Whether batch processing is enabled
 * @param {number} intervalMinutes - Interval in minutes between batch runs
 * @returns {Promise<void>}
 */
function updateBatchConfig(userId, jobType, enabled, intervalMinutes) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (intervalMinutes < 1) {
      reject(new Error("Interval must be at least 1 minute"));
      return;
    }
    if (intervalMinutes > 1440) {
      reject(new Error("Interval cannot exceed 1440 minutes (24 hours)"));
      return;
    }

    db.run(
      `INSERT OR REPLACE INTO batch_config (user_id, job_type, enabled, interval_minutes, updated_at) 
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, jobType, enabled ? 1 : 0, intervalMinutes],
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
 * Check if a batch job is currently running and acquire lock atomically
 * Uses database transaction to ensure atomicity
 * @param {number} userId - User ID
 * @param {string} jobType - Job type
 * @returns {Promise<{isRunning: boolean, runId: number|null}>} - Object with isRunning flag and runId if running
 */
function checkAndAcquireBatchJobLock(userId, jobType) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    // Use IMMEDIATE transaction to acquire write lock immediately
    // This ensures atomicity - only one process can check and set at a time
    db.serialize(() => {
      db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
        if (beginErr) {
          db.run("ROLLBACK");
          reject(beginErr);
          return;
        }

        // Check for running job (status = 'running' and no completed_at)
        db.get(
          "SELECT id FROM batch_runs WHERE user_id = ? AND job_type = ? AND status = 'running' AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1",
          [userId, jobType],
          (err, row) => {
            if (err) {
              db.run("ROLLBACK");
              reject(err);
              return;
            }

            if (row) {
              // Job is already running
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  reject(commitErr);
                } else {
                  resolve({ isRunning: true, runId: row.id });
                }
              });
            } else {
              // No running job - lock acquired, commit will release it
              // The actual job record will be created by createBatchRun
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  reject(commitErr);
                } else {
                  resolve({ isRunning: false, runId: null });
                }
              });
            }
          }
        );
      });
    });
  });
}

/**
 * Create a new batch run record for a user
 * @param {number} userId - User ID
 * @param {string} status - Run status
 * @param {string} jobType - Job type
 * @param {boolean} isManual - Whether this run was manually triggered
 * @returns {Promise<number>} - ID of created batch run
 */
function createBatchRun(userId, status = "running", jobType = "docker-hub-pull", isManual = false) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      "INSERT INTO batch_runs (user_id, status, job_type, is_manual, started_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [userId, status, jobType, isManual ? 1 : 0],
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
 * @param {number} userId - User ID
 * @param {string} status - Final status
 * @param {number} containersChecked - Number of containers checked
 * @param {number} containersUpdated - Number of containers with updates found
 * @param {string} errorMessage - Error message if failed
 * @param {string} logs - Log output from the run
 * @returns {Promise<void>}
 */
function updateBatchRun(
  runId,
  userId,
  status,
  containersChecked = 0,
  containersUpdated = 0,
  errorMessage = null,
  logs = null
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT started_at FROM batch_runs WHERE id = ? AND user_id = ?", [runId, userId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (!row) {
        reject(new Error("Batch run not found"));
        return;
      }

      const startedAtStr = row.started_at;
      let startedAt;
      if (
        typeof startedAtStr === "string" &&
        /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
      ) {
        startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
      } else {
        startedAt = new Date(startedAtStr);
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      db.run(
        `UPDATE batch_runs 
           SET status = ?, completed_at = CURRENT_TIMESTAMP, duration_ms = ?, 
               containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?
         WHERE id = ? AND user_id = ?`,
        [status, durationMs, containersChecked, containersUpdated, errorMessage, logs, runId, userId],
        function (updateErr) {
          if (updateErr) {
            reject(updateErr);
          } else {
            resolve();
          }
        }
      );
    });
  });
}

/**
 * Get batch run by ID
 * @param {number} runId - Batch run ID
 * @returns {Promise<Object|null>} - Batch run or null
 */
function getBatchRunById(runId, userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT * FROM batch_runs WHERE id = ? AND user_id = ?", [runId, userId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get recent batch runs for a user
 * @param {number} userId - User ID
 * @param {number} limit - Maximum number of runs to return (default: 50)
 * @returns {Promise<Array>} - Array of batch runs
 */
function getRecentBatchRuns(userId, limit = 50) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all("SELECT * FROM batch_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?", [userId, limit], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get the most recent batch run for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Most recent batch run or null
 */
function getLatestBatchRun(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT * FROM batch_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1", [userId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get the most recent batch run for a specific job type for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Job type to filter by
 * @returns {Promise<Object|null>} - Most recent batch run for the job type or null
 */
function getLatestBatchRunByJobType(userId, jobType) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get(
      "SELECT * FROM batch_runs WHERE user_id = ? AND job_type = ? ORDER BY started_at DESC LIMIT 1",
      [userId, jobType],
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
 * Get the most recent batch run for each job type for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Object with job types as keys and latest runs as values
 */
function getLatestBatchRunsByJobType(userId) {
  return new Promise((resolve, reject) => {
    const jobTypes = ["docker-hub-pull", "tracked-apps-check"];
    const promises = jobTypes.map((jobType) =>
      getLatestBatchRunByJobType(userId, jobType).then((run) => ({ jobType, run }))
    );

    Promise.all(promises)
      .then((results) => {
        const latestRuns = {};
        results.forEach(({ jobType, run }) => {
          latestRuns[jobType] = run;
        });
        resolve(latestRuns);
      })
      .catch(reject);
  });
}

/**
 * Get all tracked images for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of tracked images
 */
function getAllTrackedImages(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all("SELECT * FROM tracked_images WHERE user_id = ? ORDER BY name ASC", [userId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get a tracked image by ID for a user
 * @param {number} id - Tracked image ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Tracked image or null
 */
function getTrackedImageById(id, userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT * FROM tracked_images WHERE id = ? AND user_id = ?", [id, userId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get a tracked image by image name or GitHub repo for a user
 * @param {number} userId - User ID
 * @param {string} imageName - Image name (or null for GitHub)
 * @param {string} githubRepo - GitHub repo (or null for Docker)
 * @returns {Promise<Object|null>} - Tracked image or null
 */
function getTrackedImageByImageName(userId, imageName = null, githubRepo = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (githubRepo) {
      db.get("SELECT * FROM tracked_images WHERE user_id = ? AND github_repo = ?", [userId, githubRepo], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    } else if (imageName) {
      db.get("SELECT * FROM tracked_images WHERE user_id = ? AND image_name = ?", [userId, imageName], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    } else {
      resolve(null);
    }
  });
}

/**
 * Create a new tracked image
 * @param {number} userId - User ID
 * @param {string} name - Display name
 * @param {string} imageName - Image name or null for GitHub
 * @param {string} githubRepo - GitHub repo or null for Docker
 * @param {string} sourceType - 'docker', 'github', or 'gitlab'
 * @param {string} gitlabToken - GitLab token (optional)
 * @returns {Promise<number>} - ID of created tracked image
 */
function createTrackedImage(
  userId,
  name,
  imageName = null,
  githubRepo = null,
  sourceType = "docker",
  gitlabToken = null
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      "INSERT INTO tracked_images (user_id, name, image_name, github_repo, source_type, gitlab_token) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, name, imageName, githubRepo, sourceType, gitlabToken],
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
 * Update a tracked image
 * @param {number} id - Tracked image ID
 * @param {number} userId - User ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
function updateTrackedImage(id, userId, updateData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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

    if (fields.length === 0) {
      resolve();
      return;
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, userId);

    const sql = `UPDATE tracked_images SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`;

    db.run(sql, values, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Delete a tracked image
 * @param {number} id - Tracked image ID
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function deleteTrackedImage(id, userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run("DELETE FROM tracked_images WHERE id = ? AND user_id = ?", [id, userId], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Clear latest version data for all tracked images for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} - Number of rows updated
 */
function clearLatestVersionsForAllTrackedImages(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `UPDATE tracked_images 
       SET latest_version = NULL, 
           latest_digest = NULL, 
           has_update = 0,
           current_version_publish_date = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [userId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

/**
 * Get a setting value by key for a user
 * @param {string} key - Setting key
 * @param {number} userId - User ID
 * @returns {Promise<string|null>} - Setting value or null if not found
 */
function getSetting(key, userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT value FROM settings WHERE key = ? AND user_id = ?", [key, userId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.value : null);
      }
    });
  });
}

/**
 * Set a setting value by key for a user
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
function setSetting(key, value, userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `INSERT INTO settings (user_id, key, value, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
      [userId, key, value, value],
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
 * Get a system-wide setting value by key (user_id = 0)
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} - Setting value or null if not found
 */
function getSystemSetting(key) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT value FROM settings WHERE key = ? AND user_id = 0", [key], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.value : null);
      }
    });
  });
}

/**
 * Set a system-wide setting value by key (user_id = 0)
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<void>}
 */
function setSystemSetting(key, value) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      `INSERT INTO settings (user_id, key, value, updated_at) 
       VALUES (0, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
      [key, value, value],
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
 * Get all Discord webhooks for a user
 * @param {number} userId - User ID (optional for backward compatibility)
 * @returns {Promise<Array>} - Array of webhook objects
 */
function getAllDiscordWebhooks(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    // Check if user_id column exists, if not, query without it
    db.get("SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'", [], (colErr, colRow) => {
      if (colErr) {
        reject(colErr);
        return;
      }
      const hasUserId = !!colRow;
      const query = hasUserId && userId
        ? "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE user_id = ? ORDER BY created_at ASC"
        : "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks ORDER BY created_at ASC";
      const params = hasUserId && userId ? [userId] : [];
      
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const sanitized = rows.map((row) => ({
            id: row.id,
            webhookUrl: row.webhook_url ? "***configured***" : null,
            serverName: row.server_name || null,
            channelName: row.channel_name || null,
            name: row.name || null,
            avatarUrl: row.avatar_url || null,
            guildId: row.guild_id || null,
            channelId: row.channel_id || null,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            hasWebhook: !!row.webhook_url,
          }));
          resolve(sanitized);
        }
      });
    });
  });
}

/**
 * Get a Discord webhook by ID
 * @param {number} id - Webhook ID
 * @returns {Promise<Object|null>} - Webhook object or null
 */
function getDiscordWebhookById(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get(
      "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE id = ?",
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
 * Create a new Discord webhook
 * @param {number} userId - User ID
 * @param {string} webhookUrl - Webhook URL
 * @param {string} serverName - Server name (optional)
 * @param {string} channelName - Channel name (optional)
 * @param {boolean} enabled - Whether webhook is enabled
 * @param {string} name - Webhook name (optional)
 * @param {string} avatarUrl - Avatar URL (optional)
 * @param {string} guildId - Guild ID (optional)
 * @param {string} channelId - Channel ID (optional)
 * @returns {Promise<number>} - ID of created webhook
 */
function createDiscordWebhook(
  userId,
  webhookUrl,
  serverName = null,
  channelName = null,
  enabled = true,
  name = null,
  avatarUrl = null,
  guildId = null,
  channelId = null
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    // Check if user_id column exists
    db.get("SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'", [], (colErr, colRow) => {
      if (colErr) {
        reject(colErr);
        return;
      }
      const hasUserId = !!colRow;
      const insertQuery = hasUserId && userId
        ? "INSERT INTO discord_webhooks (user_id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        : "INSERT INTO discord_webhooks (webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)";
      const insertParams = hasUserId && userId
        ? [userId, webhookUrl, serverName, channelName, name, avatarUrl, guildId, channelId, enabled ? 1 : 0]
        : [webhookUrl, serverName, channelName, name, avatarUrl, guildId, channelId, enabled ? 1 : 0];
      
      db.run(insertQuery, insertParams, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  });
}

/**
 * Update a Discord webhook
 * @param {number} id - Webhook ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
function updateDiscordWebhook(id, updateData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    const fields = [];
    const values = [];

    if (updateData.webhookUrl !== undefined) {
      fields.push("webhook_url = ?");
      values.push(updateData.webhookUrl);
    }
    if (updateData.serverName !== undefined) {
      fields.push("server_name = ?");
      values.push(updateData.serverName);
    }
    if (updateData.channelName !== undefined) {
      fields.push("channel_name = ?");
      values.push(updateData.channelName);
    }
    if (updateData.name !== undefined) {
      fields.push("name = ?");
      values.push(updateData.name);
    }
    if (updateData.avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(updateData.avatarUrl);
    }
    if (updateData.guildId !== undefined) {
      fields.push("guild_id = ?");
      values.push(updateData.guildId);
    }
    if (updateData.channelId !== undefined) {
      fields.push("channel_id = ?");
      values.push(updateData.channelId);
    }
    if (updateData.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updateData.enabled ? 1 : 0);
    }

    if (fields.length === 0) {
      resolve();
      return;
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const sql = `UPDATE discord_webhooks SET ${fields.join(", ")} WHERE id = ?`;

    db.run(sql, values, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Delete a Discord webhook
 * @param {number} id - Webhook ID
 * @returns {Promise<void>}
 */
function deleteDiscordWebhook(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run("DELETE FROM discord_webhooks WHERE id = ?", [id], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get all enabled Discord webhooks for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of enabled webhook objects with full URLs
 */
function getEnabledDiscordWebhooks(userId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    // Check if user_id column exists, if not, query without it
    db.get("SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'", [], (colErr, colRow) => {
      if (colErr) {
        reject(colErr);
        return;
      }
      const hasUserId = !!colRow;
      const query = hasUserId && userId
        ? "SELECT id, webhook_url, server_name, channel_name, name FROM discord_webhooks WHERE enabled = 1 AND user_id = ?"
        : "SELECT id, webhook_url, server_name, channel_name, name FROM discord_webhooks WHERE enabled = 1";
      const params = hasUserId && userId ? [userId] : [];
      
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  });
}

/**
 * Close database connection
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        logger.info("Database connection closed");
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
  updateLastLogin,
  waitForDatabase,
  hasAnyUsers,
  createUser,
  updateVerificationToken,
  verifyAndClearToken,
  getAllUsers,
  getAllPortainerInstances,
  getPortainerInstanceById,
  createPortainerInstance,
  updatePortainerInstance,
  deletePortainerInstance,
  updatePortainerInstanceOrder,
  getDockerHubCredentials,
  updateDockerHubCredentials,
  deleteDockerHubCredentials,
  getAllTrackedImages,
  getTrackedImageById,
  getTrackedImageByImageName,
  createTrackedImage,
  updateTrackedImage,
  deleteTrackedImage,
  clearLatestVersionsForAllTrackedImages,
  // Docker Hub image versions
  upsertDockerHubImageVersion,
  getDockerHubImageVersion,
  getDockerHubImageVersionsBatch,
  getDockerHubImagesWithUpdates,
  markDockerHubImageUpToDate,
  // Portainer containers
  upsertPortainerContainer,
  upsertContainerWithVersion,
  getPortainerContainers,
  getPortainerContainersWithUpdates,
  deletePortainerContainersForInstance,
  deletePortainerContainersNotInList,
  cleanupStalePortainerContainers,
  clearUserContainerData,
  getBatchConfig,
  updateBatchConfig,
  checkAndAcquireBatchJobLock,
  createBatchRun,
  updateBatchRun,
  getBatchRunById,
  getRecentBatchRuns,
  getLatestBatchRun,
  getLatestBatchRunByJobType,
  getLatestBatchRunsByJobType,
  getSetting,
  setSetting,
  getSystemSetting,
  setSystemSetting,
  getAllDiscordWebhooks,
  getDiscordWebhookById,
  createDiscordWebhook,
  updateDiscordWebhook,
  deleteDiscordWebhook,
  getEnabledDiscordWebhooks,
  closeDatabase,
};
