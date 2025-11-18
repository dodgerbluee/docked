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
    logger.error("Error opening database:", err.message);
    logger.error("Stack:", err.stack);
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
        logger.error("Stack:", initError.stack);
        // Don't throw - log the error but don't crash the server
        // Database operations will fail gracefully if needed
      }
    });
  }
});

  // Handle database errors to prevent crashes
  if (db) {
    db.on("error", (err) => {
      logger.error("Database error:", err.message);
      logger.error("Stack:", err.stack);
      // Don't throw - just log the error
    });
  }
} catch (dbInitError) {
  logger.error("Failed to create database connection:", dbInitError);
  logger.error("Stack:", dbInitError.stack);
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
              logger.error("Error creating users table:", err.message);
            } else {
          logger.info("Users table ready");
          // Create indexes for users table
          db.run("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              logger.error("Error creating username index:", idxErr.message);
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
          logger.error("Error creating portainer_instances table:", err.message);
        } else {
          logger.info("Portainer instances table ready");
          // Create indexes for portainer_instances table
          // Note: user_id index may fail if table exists without user_id column (migration will fix this)
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_portainer_user_id ON portainer_instances(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists") && !idxErr.message.includes("no such column")) {
                    logger.error("Error creating user_id index:", idxErr.message);
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug("user_id column doesn't exist yet - index will be created after migration");
                  }
                }
              );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_url ON portainer_instances(url)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating portainer URL index:", idxErr.message);
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_portainer_display_order ON portainer_instances(display_order)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating display_order index:", idxErr.message);
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
          logger.error("Error creating docker_hub_credentials table:", err.message);
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
          logger.error("Error creating tracked_images table:", err.message);
        } else {
          logger.info("Tracked images table ready");
              // Create indexes
          // Note: user_id index may fail if table exists without user_id column (migration will fix this)
          db.run(
                "CREATE INDEX IF NOT EXISTS idx_tracked_images_user_id ON tracked_images(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists") && !idxErr.message.includes("no such column")) {
                    logger.error("Error creating user_id index:", idxErr.message);
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug("user_id column doesn't exist yet - index will be created after migration");
                  }
                }
              );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_name ON tracked_images(name)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images name index:", idxErr.message);
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_image_name ON tracked_images(image_name)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images image_name index:", idxErr.message);
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_tracked_images_github_repo ON tracked_images(github_repo)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating tracked_images github_repo index:", idxErr.message);
              }
            }
          );
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
          logger.error("Error creating container_cache table:", err.message);
        } else {
          logger.info("Container cache table ready");
          // Create indexes for container_cache table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_cache_key ON container_cache(cache_key)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating cache_key index:", idxErr.message);
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_cache_updated_at ON container_cache(updated_at)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating cache updated_at index:", idxErr.message);
              }
            }
          );
        }
      }
    );

    // Create batch_config table (one row per job type)
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL UNIQUE,
        enabled INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating batch_config table:", err.message);
        } else {
          logger.info("Batch config table ready");
              // Initialize default job types if they don't exist
                        db.run(
                "INSERT OR IGNORE INTO batch_config (job_type, enabled, interval_minutes) VALUES ('docker-hub-pull', 0, 60)",
                () => {}
              );
                                  db.run(
                                    "INSERT OR IGNORE INTO batch_config (job_type, enabled, interval_minutes) VALUES ('tracked-apps-check', 0, 60)",
                () => {}
              );
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
          logger.error("Error creating settings table:", err.message);
        } else {
          logger.info("Settings table ready");
              // Create indexes for settings table
              // Note: user_id index may fail if table exists without user_id column (migration will fix this)
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists") && !idxErr.message.includes("no such column")) {
                    logger.error("Error creating user_id index:", idxErr.message);
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug("user_id column doesn't exist yet - index will be created after migration");
                  }
                }
              );
          db.run("CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              logger.error("Error creating settings key index:", idxErr.message);
            }
          });
        }
      }
    );

    // Create discord_webhooks table for multiple webhook configurations
    db.run(
      `CREATE TABLE IF NOT EXISTS discord_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          logger.error("Error creating discord_webhooks table:", err.message);
        } else {
          logger.info("Discord webhooks table ready");
          // Create index for discord_webhooks table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_enabled ON discord_webhooks(enabled)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating discord_webhooks enabled index:", idxErr.message);
              }
            }
          );
        }
      }
    );

    // Create batch_runs table to track batch execution history
    db.run(
      `CREATE TABLE IF NOT EXISTS batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          logger.error("Error creating batch_runs table:", err.message);
        } else {
          logger.info("Batch runs table ready");
          // Create indexes for batch_runs table
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_batch_runs_started_at ON batch_runs(started_at DESC)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating batch_runs started_at index:", idxErr.message);
              }
            }
          );
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status)",
            (idxErr) => {
              if (idxErr && !idxErr.message.includes("already exists")) {
                logger.error("Error creating batch_runs status index:", idxErr.message);
              } else {
                // All tables created - now run migrations
                // Use setImmediate to ensure all callbacks complete first
                setImmediate(() => {
                  migrationPromise = runMigrations().catch((migrationErr) => {
                    logger.error("Migration error:", migrationErr);
                    throw migrationErr;
                  });
                });
              }
            }
          );
            }
          }
        );

      } catch (serializeError) {
        logger.error("Error in db.serialize callback:", serializeError);
        logger.error("Stack:", serializeError.stack);
      }
    });
    
    logger.info("Database initialization completed");
  } catch (initError) {
    logger.error("Error in initializeDatabase:", initError);
    logger.error("Stack:", initError.stack);
    initializationStarted = false; // Allow retry on next call
  }
}

/**
 * Check if a column exists in a table
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @returns {Promise<boolean>} - True if column exists
 */
function columnExists(tableName, columnName) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        // Table doesn't exist or error
        resolve(false);
        return;
      }
      const exists = rows.some((row) => row.name === columnName);
      resolve(exists);
    });
  });
}

// Track migration promise for external waiting
let migrationPromise = null;

/**
 * Wait for migrations to complete
 * @returns {Promise<void>}
 */
function waitForMigrations() {
  if (!migrationPromise) {
    // If migration hasn't started yet, wait a bit and check again
    return new Promise((resolve) => {
      setTimeout(() => {
        if (migrationPromise) {
          migrationPromise.then(resolve).catch(resolve);
        } else {
          resolve(); // No migration needed
        }
      }, 200);
    });
  }
  return migrationPromise;
}

/**
 * Run database migrations for backward compatibility
 * Migrates existing data to be user-specific
 */
async function runMigrations() {
  try {
    // Wait a bit to ensure all table creation callbacks have completed
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    logger.info("Checking for database migrations...");
    
    // First check if tables exist
    const portainerTableExists = await new Promise((resolve) => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='portainer_instances'", (err, row) => {
        resolve(!err && row);
      });
    });
    
    const trackedImagesTableExists = await new Promise((resolve) => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tracked_images'", (err, row) => {
        resolve(!err && row);
      });
    });
    
    const settingsTableExists = await new Promise((resolve) => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'", (err, row) => {
        resolve(!err && row);
      });
    });
    
    // If tables don't exist yet, skip migration (they'll be created with user_id)
    if (!portainerTableExists && !trackedImagesTableExists && !settingsTableExists) {
      logger.debug("No existing tables found - new database, no migration needed");
      return;
    }
    
    // Check if portainer_instances table exists without user_id
    const portainerHasUserId = portainerTableExists ? await columnExists("portainer_instances", "user_id") : true;
    const trackedImagesHasUserId = trackedImagesTableExists ? await columnExists("tracked_images", "user_id") : true;
    const settingsHasUserId = settingsTableExists ? await columnExists("settings", "user_id") : true;
    
    // If all tables already have user_id, no migration needed
    if (portainerHasUserId && trackedImagesHasUserId && settingsHasUserId) {
      logger.debug("No migrations needed - all tables have user_id columns");
      return;
    }
    
    logger.info("Migration needed: Adding user_id columns and migrating data");
    
    // Get or create first user for migration
    let firstUser;
    try {
      // Check if users table exists first
      const usersTableExists = await new Promise((resolve) => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
          resolve(!err && row);
        });
      });
      
      if (!usersTableExists) {
        logger.warn("Users table doesn't exist yet - skipping migration");
        return;
      }
      
      const users = await getAllUsers();
      if (users.length > 0) {
        firstUser = users[0];
        logger.info(`Using existing user '${firstUser.username}' (ID: ${firstUser.id}) for migration`);
      } else {
        // Create a default admin user for migration
        // This should rarely happen, but handle it gracefully
        logger.warn("No users found - migration will create a default admin user");
        // We can't create a user here without a password, so we'll skip migration
        // The user will need to create a user first, then the migration will run on next startup
        logger.warn("Skipping migration - please create a user first, then restart the server");
        return;
      }
    } catch (userError) {
      logger.error("Error getting users for migration:", userError);
      // If it's a column error, the table might be old schema - skip migration for now
      if (userError.message && userError.message.includes("no such column")) {
        logger.warn("Users table has old schema - skipping migration until user is created");
        return;
      }
      return;
    }
    
    const userId = firstUser.id;
    
    // Migrate portainer_instances table
    if (!portainerHasUserId) {
      logger.info("Migrating portainer_instances table...");
      try {
        // Check if table exists
        const tableExists = await new Promise((resolve) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='portainer_instances'",
            (err, row) => {
              resolve(!err && row);
            }
          );
        });
        
        if (tableExists) {
          // Drop old unique constraint if it exists (SQLite doesn't support DROP CONSTRAINT directly)
          // We'll recreate the table with the new constraint
          // First, get all data
          const instances = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM portainer_instances", (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          });
          
          // Create new table with user_id
          await new Promise((resolve, reject) => {
            db.run(
              `CREATE TABLE portainer_instances_new (
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
                if (err) reject(err);
                else resolve();
              }
            );
          });
          
          // Copy data with user_id
          for (const instance of instances) {
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO portainer_instances_new (id, user_id, name, url, username, password, api_key, auth_type, ip_address, display_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  instance.id,
                  userId,
                  instance.name,
                  instance.url,
                  instance.username,
                  instance.password,
                  instance.api_key || null,
                  instance.auth_type || "password",
                  instance.ip_address || null,
                  instance.display_order || 0,
                  instance.created_at || new Date().toISOString(),
                  instance.updated_at || new Date().toISOString(),
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          
          // Drop old table and rename new one
          await new Promise((resolve, reject) => {
            db.run("DROP TABLE portainer_instances", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          await new Promise((resolve, reject) => {
            db.run("ALTER TABLE portainer_instances_new RENAME TO portainer_instances", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          // Recreate indexes
          db.run("CREATE INDEX IF NOT EXISTS idx_portainer_user_id ON portainer_instances(user_id)");
          db.run("CREATE INDEX IF NOT EXISTS idx_portainer_url ON portainer_instances(url)");
          db.run("CREATE INDEX IF NOT EXISTS idx_portainer_display_order ON portainer_instances(display_order)");
          
          logger.info(`Migrated ${instances.length} portainer instances to user ${userId}`);
        } else {
          // Table doesn't exist yet, it will be created with user_id by CREATE TABLE IF NOT EXISTS
          logger.debug("portainer_instances table doesn't exist yet, will be created with user_id");
        }
      } catch (err) {
        logger.error("Error migrating portainer_instances:", err);
        // Continue with other migrations
      }
    }
    
    // Migrate tracked_images table
    if (!trackedImagesHasUserId) {
      logger.info("Migrating tracked_images table...");
      try {
        const tableExists = await new Promise((resolve) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tracked_images'",
            (err, row) => {
              resolve(!err && row);
            }
          );
        });
        
        if (tableExists) {
          const images = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM tracked_images", (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          });
          
          await new Promise((resolve, reject) => {
            db.run(
              `CREATE TABLE tracked_images_new (
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
                if (err) reject(err);
                else resolve();
              }
            );
          });
          
          for (const image of images) {
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO tracked_images_new (id, user_id, name, image_name, github_repo, source_type, gitlab_token, current_version, current_digest, latest_version, latest_digest, has_update, current_version_publish_date, latest_version_publish_date, last_checked, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  image.id,
                  userId,
                  image.name,
                  image.image_name || null,
                  image.github_repo || null,
                  image.source_type || "docker",
                  image.gitlab_token || null,
                  image.current_version || null,
                  image.current_digest || null,
                  image.latest_version || null,
                  image.latest_digest || null,
                  image.has_update || 0,
                  image.current_version_publish_date || null,
                  image.latest_version_publish_date || null,
                  image.last_checked || null,
                  image.created_at || new Date().toISOString(),
                  image.updated_at || new Date().toISOString(),
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          
          await new Promise((resolve, reject) => {
            db.run("DROP TABLE tracked_images", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          await new Promise((resolve, reject) => {
            db.run("ALTER TABLE tracked_images_new RENAME TO tracked_images", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          // Recreate indexes
          db.run("CREATE INDEX IF NOT EXISTS idx_tracked_images_user_id ON tracked_images(user_id)");
          db.run("CREATE INDEX IF NOT EXISTS idx_tracked_images_name ON tracked_images(name)");
          db.run("CREATE INDEX IF NOT EXISTS idx_tracked_images_image_name ON tracked_images(image_name)");
          db.run("CREATE INDEX IF NOT EXISTS idx_tracked_images_github_repo ON tracked_images(github_repo)");
          
          logger.info(`Migrated ${images.length} tracked images to user ${userId}`);
        } else {
          logger.debug("tracked_images table doesn't exist yet, will be created with user_id");
        }
      } catch (err) {
        logger.error("Error migrating tracked_images:", err);
      }
    }
    
    // Migrate settings table
    if (!settingsHasUserId) {
      logger.info("Migrating settings table...");
      try {
        const tableExists = await new Promise((resolve) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
            (err, row) => {
              resolve(!err && row);
            }
          );
        });
        
        if (tableExists) {
          const settings = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM settings", (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          });
          
          await new Promise((resolve, reject) => {
            db.run(
              `CREATE TABLE settings_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, key)
              )`,
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          
          for (const setting of settings) {
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO settings_new (id, user_id, key, value, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  setting.id,
                  userId,
                  setting.key,
                  setting.value || null,
                  setting.created_at || new Date().toISOString(),
                  setting.updated_at || new Date().toISOString(),
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          
          await new Promise((resolve, reject) => {
            db.run("DROP TABLE settings", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          await new Promise((resolve, reject) => {
            db.run("ALTER TABLE settings_new RENAME TO settings", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          // Recreate indexes
          db.run("CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)");
          db.run("CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)");
          
          logger.info(`Migrated ${settings.length} settings to user ${userId}`);
        } else {
          logger.debug("settings table doesn't exist yet, will be created with user_id");
        }
      } catch (err) {
        logger.error("Error migrating settings:", err);
      }
    }
    
    logger.info("Database migration completed successfully");
  } catch (migrationError) {
    logger.error("Error running migrations:", migrationError);
    logger.error("Stack:", migrationError.stack);
    // Don't throw - allow server to continue even if migration fails
    // The migration will be retried on next startup
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
 * Get Docker Hub credentials
 * @returns {Promise<Object|null>} - Docker Hub credentials or null
 */
function getDockerHubCredentials() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
 * @param {string} username - Docker Hub username
 * @param {string} token - Docker Hub personal access token
 * @returns {Promise<void>}
 */
function updateDockerHubCredentials(username, token) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run("DELETE FROM docker_hub_credentials WHERE id = 1", [], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get cached container data
 * @param {string} cacheKey - Cache key (e.g., 'containers')
 * @returns {Promise<Object|null>} - Cached data or null
 */
function getContainerCache(cacheKey) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
              logger.error("Error parsing cached data:", parseErr);
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
 * Get all container cache entries
 * @returns {Promise<Array>} - Array of cache entries
 */
function getAllContainerCacheEntries() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all("SELECT cache_key, cache_data, updated_at FROM container_cache", [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const entries = rows.map((row) => {
          try {
            return {
              cache_key: row.cache_key,
              cache_data: JSON.parse(row.cache_data),
              updated_at: row.updated_at,
            };
          } catch (parseErr) {
            logger.error(`Error parsing cache data for key ${row.cache_key}:`, parseErr);
            return {
              cache_key: row.cache_key,
              cache_data: null,
              updated_at: row.updated_at,
            };
          }
        });
        resolve(entries);
      }
    });
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
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
 * Get batch configuration for a specific job type or all job types
 * @param {string} jobType - Optional job type. If null, returns all configs.
 * @returns {Promise<Object|null>} - Batch configuration(s) or null
 */
function getBatchConfig(jobType = null) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    if (jobType) {
      db.get(
        "SELECT enabled, interval_minutes, updated_at FROM batch_config WHERE job_type = ?",
        [jobType],
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
        "SELECT job_type, enabled, interval_minutes, updated_at FROM batch_config",
        [],
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
 * Update batch configuration for a specific job type
 * @param {string} jobType - Job type
 * @param {boolean} enabled - Whether batch processing is enabled
 * @param {number} intervalMinutes - Interval in minutes between batch runs
 * @returns {Promise<void>}
 */
function updateBatchConfig(jobType, enabled, intervalMinutes) {
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
      `INSERT OR REPLACE INTO batch_config (job_type, enabled, interval_minutes, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [jobType, enabled ? 1 : 0, intervalMinutes],
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
 * @param {string} status - Run status
 * @param {string} jobType - Job type
 * @param {boolean} isManual - Whether this run was manually triggered
 * @returns {Promise<number>} - ID of created batch run
 */
function createBatchRun(status = "running", jobType = "docker-hub-pull", isManual = false) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.run(
      "INSERT INTO batch_runs (status, job_type, is_manual, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
      [status, jobType, isManual ? 1 : 0],
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
 * @param {string} status - Final status
 * @param {number} containersChecked - Number of containers checked
 * @param {number} containersUpdated - Number of containers with updates found
 * @param {string} errorMessage - Error message if failed
 * @param {string} logs - Log output from the run
 * @returns {Promise<void>}
 */
function updateBatchRun(
  runId,
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
    db.get("SELECT started_at FROM batch_runs WHERE id = ?", [runId], (err, row) => {
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
    });
  });
}

/**
 * Get batch run by ID
 * @param {number} runId - Batch run ID
 * @returns {Promise<Object|null>} - Batch run or null
 */
function getBatchRunById(runId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT * FROM batch_runs WHERE id = ?", [runId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get recent batch runs
 * @param {number} limit - Maximum number of runs to return (default: 50)
 * @returns {Promise<Array>} - Array of batch runs
 */
function getRecentBatchRuns(limit = 50) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all("SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT ?", [limit], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get the most recent batch run
 * @returns {Promise<Object|null>} - Most recent batch run or null
 */
function getLatestBatchRun() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get("SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 1", [], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get the most recent batch run for a specific job type
 * @param {string} jobType - Job type to filter by
 * @returns {Promise<Object|null>} - Most recent batch run for the job type or null
 */
function getLatestBatchRunByJobType(jobType) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.get(
      "SELECT * FROM batch_runs WHERE job_type = ? ORDER BY started_at DESC LIMIT 1",
      [jobType],
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
 * Get the most recent batch run for each job type
 * @returns {Promise<Object>} - Object with job types as keys and latest runs as values
 */
function getLatestBatchRunsByJobType() {
  return new Promise((resolve, reject) => {
    const jobTypes = ["docker-hub-pull", "tracked-apps-check"];
    const promises = jobTypes.map((jobType) =>
      getLatestBatchRunByJobType(jobType).then((run) => ({ jobType, run }))
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
 * Get all Discord webhooks
 * @returns {Promise<Array>} - Array of webhook objects
 */
function getAllDiscordWebhooks() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all(
      "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks ORDER BY created_at ASC",
      [],
      (err, rows) => {
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
      }
    );
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
    db.run(
      "INSERT INTO discord_webhooks (webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [webhookUrl, serverName, channelName, name, avatarUrl, guildId, channelId, enabled ? 1 : 0],
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
 * Get all enabled Discord webhooks
 * @returns {Promise<Array>} - Array of enabled webhook objects with full URLs
 */
function getEnabledDiscordWebhooks() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    db.all(
      "SELECT id, webhook_url, server_name, channel_name, name FROM discord_webhooks WHERE enabled = 1",
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
  waitForMigrations,
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
  getContainerCache,
  getAllContainerCacheEntries,
  setContainerCache,
  clearContainerCache,
  getBatchConfig,
  updateBatchConfig,
  createBatchRun,
  updateBatchRun,
  getBatchRunById,
  getRecentBatchRuns,
  getLatestBatchRun,
  getLatestBatchRunByJobType,
  getLatestBatchRunsByJobType,
  getSetting,
  setSetting,
  getAllDiscordWebhooks,
  getDiscordWebhookById,
  createDiscordWebhook,
  updateDiscordWebhook,
  deleteDiscordWebhook,
  getEnabledDiscordWebhooks,
  closeDatabase,
};
