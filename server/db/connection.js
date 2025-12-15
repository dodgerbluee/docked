/**
 * Database Connection Module
 *
 * Handles SQLite database connection, initialization, and operation queuing.
 * Provides a unified API for database access across the application.
 */
/* eslint-disable max-lines -- Large database module with comprehensive connection management */

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const os = require("os");
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

// Database connection state
let dbConnectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 1; // Only allow one connection attempt
let dbConnectionEstablished = false;

// Database operation queue to prevent concurrent transactions
const dbOperationQueue = [];
let isProcessingQueue = false;

/**
 * Queue a database operation to prevent concurrent transactions
 * @param {Function} operation - Async function that performs the database operation
 * @returns {Promise} - Promise that resolves with the operation result
 */
async function queueDatabaseOperation(operation) {
  return new Promise((resolve, reject) => {
    dbOperationQueue.push({ operation, resolve, reject });
    processDatabaseQueue();
  });
}

/**
 * Process the database operation queue sequentially
 */
async function processDatabaseQueue() {
  if (isProcessingQueue || dbOperationQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  try {
    while (dbOperationQueue.length > 0) {
      const { operation, resolve, reject } = dbOperationQueue.shift();
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }
  } finally {
    // Always reset the flag, even if an error occurs
    isProcessingQueue = false;
  }
}

// Create database connection synchronously but handle errors gracefully
let db;
try {
  db = new sqlite3.Database(DB_PATH, (err) => {
    dbConnectionAttempts++;

    // Prevent multiple connection attempts
    if (dbConnectionAttempts > MAX_CONNECTION_ATTEMPTS) {
      logger.warn(
        `Database connection callback called ${dbConnectionAttempts} times. Ignoring subsequent calls.`
      );
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
      setImmediate(async () => {
        try {
          await initializeDatabase();
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
    // eslint-disable-next-line no-empty-function -- Dummy implementation for error handling
    run: () => {},
    // eslint-disable-next-line no-empty-function -- Dummy implementation for error handling
    get: () => {},
    // eslint-disable-next-line no-empty-function -- Dummy implementation for error handling
    all: () => {},
    serialize: (cb) => {
      if (cb) cb();
    },
    // eslint-disable-next-line no-empty-function -- Dummy implementation for error handling
    close: () => {},
  };
}

/**
 * Initialize database schema
 */
let initializationStarted = false;
// eslint-disable-next-line max-lines-per-function -- Complex database initialization with many tables
async function initializeDatabase() {
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
    // eslint-disable-next-line max-lines-per-function -- Database initialization requires comprehensive schema creation
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
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating username index:", { error: idxErr });
                  }
                }
              );
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
                  if (
                    idxErr &&
                    !idxErr.message.includes("already exists") &&
                    !idxErr.message.includes("no such column")
                  ) {
                    logger.error("Error creating user_id index:", { error: idxErr });
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug(
                      "user_id column doesn't exist yet - index will be created after migration"
                    );
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

        // Create repository_access_tokens table
        db.run(
          `CREATE TABLE IF NOT EXISTS repository_access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
        name TEXT NOT NULL,
        access_token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider, name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
          (err) => {
            if (err) {
              logger.error("Error creating repository_access_tokens table:", { error: err });
            } else {
              logger.info("Repository access tokens table ready");
              // Add name column if it doesn't exist (migration for existing databases)
              db.run("ALTER TABLE repository_access_tokens ADD COLUMN name TEXT", (alterErr) => {
                // Ignore error if column already exists
                if (alterErr && !alterErr.message.includes("duplicate column")) {
                  logger.debug(
                    "Name column may already exist or migration not needed:",
                    alterErr.message
                  );
                } else {
                  // If column was just added, set default names for existing tokens
                  db.run(
                    "UPDATE repository_access_tokens SET name = provider || ' Token' WHERE name IS NULL OR name = ''",
                    (updateErr) => {
                      if (updateErr) {
                        logger.debug("Error setting default names:", updateErr.message);
                      }
                    }
                  );
                }
              });
              // Create indexes for repository_access_tokens table
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_repo_tokens_user_id ON repository_access_tokens(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating repository_access_tokens user_id index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_repo_tokens_provider ON repository_access_tokens(provider)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating repository_access_tokens provider index:", {
                      error: idxErr,
                    });
                  }
                }
              );
            }
          }
        );

        // Create tracked_apps table
        db.run(
          `CREATE TABLE IF NOT EXISTS tracked_apps (
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
          // eslint-disable-next-line max-lines-per-function -- Database table creation callback requires comprehensive error handling
          (err) => {
            if (err) {
              logger.error("Error creating tracked_apps table:", { error: err });
            } else {
              logger.info("Tracked apps table ready");
              // Add repository_token_id column if it doesn't exist (migration for existing databases)
              db.run(
                "ALTER TABLE tracked_apps ADD COLUMN repository_token_id INTEGER",
                (alterErr) => {
                  // Ignore error if column already exists
                  if (alterErr && !alterErr.message.includes("duplicate column")) {
                    logger.debug(
                      "Repository token ID column may already exist or migration not needed:",
                      alterErr.message
                    );
                  }
                }
              );
              // Create indexes
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_tracked_apps_user_id ON tracked_apps(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating tracked_apps user_id index:", { error: idxErr });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_tracked_apps_name ON tracked_apps(name)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating tracked_apps name index:", { error: idxErr });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_tracked_apps_image_name ON tracked_apps(image_name)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating tracked_apps image_name index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_tracked_apps_github_repo ON tracked_apps(github_repo)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating tracked_apps github_repo index:", {
                      error: idxErr,
                    });
                  }
                }
              );
            }
          }
        );

        // Create deployed_images table - tracks actual images used by containers
        db.run(
          `CREATE TABLE IF NOT EXISTS deployed_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image_repo TEXT NOT NULL,
        image_tag TEXT NOT NULL,
        image_digest TEXT,
        image_created_date TEXT,
        registry TEXT,
        namespace TEXT,
        repository TEXT,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, image_repo, image_tag, image_digest),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
          // eslint-disable-next-line max-lines-per-function -- Database table creation callback requires comprehensive error handling
          (err) => {
            if (err) {
              logger.error("Error creating deployed_images table:", { error: err });
            } else {
              logger.info("Deployed images table ready");
              // Create indexes for deployed_images table
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_deployed_images_user_id ON deployed_images(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating deployed_images user_id index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_deployed_images_image_repo ON deployed_images(image_repo)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating deployed_images image_repo index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_deployed_images_last_seen ON deployed_images(last_seen)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating deployed_images last_seen index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              // Add repository_token_id column if it doesn't exist (migration for existing databases)
              db.run(
                "ALTER TABLE deployed_images ADD COLUMN repository_token_id INTEGER",
                (alterErr) => {
                  // Ignore error if column already exists
                  if (alterErr && !alterErr.message.includes("duplicate column")) {
                    logger.debug(
                      "Repository token ID column may already exist or migration not needed:",
                      alterErr.message
                    );
                  } else {
                    // Add foreign key constraint if column was just created
                    db.run(
                      "CREATE INDEX IF NOT EXISTS idx_deployed_images_repository_token_id ON deployed_images(repository_token_id)",
                      (idxErr) => {
                        if (idxErr && !idxErr.message.includes("already exists")) {
                          logger.debug(
                            "Index for repository_token_id may already exist:",
                            idxErr.message
                          );
                        }
                      }
                    );
                  }
                }
              );
            }
          }
        );

        // Create registry_image_versions table - tracks latest versions available in registries
        db.run(
          `CREATE TABLE IF NOT EXISTS registry_image_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image_repo TEXT NOT NULL,
        registry TEXT NOT NULL,
        provider TEXT,
        namespace TEXT,
        repository TEXT NOT NULL,
        tag TEXT,
        latest_digest TEXT,
        latest_version TEXT,
        latest_publish_date TEXT,
        exists_in_registry INTEGER DEFAULT 0,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, image_repo, tag),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
          (err) => {
            if (err) {
              logger.error("Error creating registry_image_versions table:", { error: err });
            } else {
              logger.info("Registry image versions table ready");
              // Add provider column if it doesn't exist (migration for existing databases)
              db.run("ALTER TABLE registry_image_versions ADD COLUMN provider TEXT", (alterErr) => {
                // Ignore error if column already exists
                if (alterErr && !alterErr.message.includes("duplicate column")) {
                  logger.debug(
                    "Provider column may already exist or migration not needed:",
                    alterErr.message
                  );
                }
              });
              // Create indexes for registry_image_versions table
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_user_id ON registry_image_versions(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating registry_image_versions user_id index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_image_repo ON registry_image_versions(image_repo)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating registry_image_versions image_repo index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_last_checked ON registry_image_versions(last_checked)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating registry_image_versions last_checked index:", {
                      error: idxErr,
                    });
                  }
                }
              );
            }
          }
        );

        // Create containers table (renamed from portainer_containers) to store container state per user
        db.run(
          `CREATE TABLE IF NOT EXISTS containers (
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
        deployed_image_id INTEGER,
        uses_network_mode INTEGER DEFAULT 0,
        provides_network INTEGER DEFAULT 0,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, container_id, portainer_instance_id, endpoint_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )`,
          // eslint-disable-next-line max-lines-per-function -- Database table creation callback requires comprehensive error handling
          (err) => {
            if (err) {
              logger.error("Error creating containers table:", { error: err });
            } else {
              logger.info("Containers table ready");
              // Create indexes for containers table
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_containers_user_id ON containers(user_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating containers user_id index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_containers_instance ON containers(portainer_instance_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating containers instance index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_containers_deployed_image ON containers(deployed_image_id)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating containers deployed_image_id index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_containers_image_repo ON containers(image_repo)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating containers image_repo index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_containers_last_seen ON containers(last_seen)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating containers last_seen index:", {
                      error: idxErr,
                    });
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
                  if (
                    idxErr &&
                    !idxErr.message.includes("already exists") &&
                    !idxErr.message.includes("no such column")
                  ) {
                    logger.error("Error creating discord_webhooks user_id index:", {
                      error: idxErr,
                    });
                  } else if (idxErr && idxErr.message.includes("no such column")) {
                    logger.debug(
                      "Discord webhooks table exists without user_id column - migration will handle this"
                    );
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_enabled ON discord_webhooks(enabled)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating discord_webhooks enabled index:", {
                      error: idxErr,
                    });
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

        // Create discord_notifications_sent table to persist notification deduplication
        // This ensures notifications are only sent once per SHA, even across server restarts
        db.run(
          `CREATE TABLE IF NOT EXISTS discord_notifications_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        deduplication_key TEXT NOT NULL,
        notification_type TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, deduplication_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
          (err) => {
            if (err) {
              logger.error("Error creating discord_notifications_sent table:", { error: err });
            } else {
              logger.info("Discord notifications sent table ready");
              // Create indexes for discord_notifications_sent table
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_discord_notifications_user_key ON discord_notifications_sent(user_id, deduplication_key)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating discord_notifications user_key index:", {
                      error: idxErr,
                    });
                  }
                }
              );
              db.run(
                "CREATE INDEX IF NOT EXISTS idx_discord_notifications_sent_at ON discord_notifications_sent(sent_at DESC)",
                (idxErr) => {
                  if (idxErr && !idxErr.message.includes("already exists")) {
                    logger.error("Error creating discord_notifications sent_at index:", {
                      error: idxErr,
                    });
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

    // Run migrations after schema is created
    try {
      const { runMigrations } = require("./migrations");
      await runMigrations();
    } catch (migrationError) {
      logger.error("Error running migrations:", { error: migrationError });
      // Don't fail initialization if migrations fail - log and continue
      // This allows the app to start even if there are migration issues
    }
  } catch (initError) {
    logger.error("Error in initializeDatabase:", initError);
    logger.error("Stack:", { error: initError });
    // eslint-disable-next-line require-atomic-updates -- Flag reset after initialization complete, safe to reset
    initializationStarted = false; // Allow retry on next call
  }
}

/**
 * Wait for database to be ready
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
            reject(
              new Error(`Database not ready after ${maxRetries} retries: users table not found`)
            );
          }
        }
      });
    };
    checkTable();
  });
}

/**
 * Close database connection
 * @returns {Promise<void>}
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

/**
 * Get the database connection instance
 * @returns {sqlite3.Database} - The database connection
 * @throws {Error} - If database is not initialized
 */
function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

/**
 * Check if database connection is established
 * @returns {boolean}
 */
function isConnected() {
  return dbConnectionEstablished && db !== null;
}

module.exports = {
  getDatabase,
  initializeDatabase,
  waitForDatabase,
  closeDatabase,
  queueDatabaseOperation,
  isConnected,
  DB_PATH,
};
