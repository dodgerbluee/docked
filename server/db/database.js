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
const logger = require("../utils/logger");

// Use DATA_DIR environment variable or default to /data
// This allows the database to be stored outside the codebase
// In test environment, default to temp directory
function getDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  if (process.env.NODE_ENV === "test") {
    const os = require("os");
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
      throw err;
    }
  }
}

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error("Error opening database:", err.message);
    logger.error("Stack:", err.stack);
  } else {
    logger.info(`Connected to SQLite database at ${DB_PATH}`);
    try {
      initializeDatabase();
    } catch (initError) {
      logger.error("Error initializing database:", initError);
      logger.error("Stack:", initError.stack);
    }
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
          logger.error("Error creating users table:", err.message);
        } else {
          logger.info("Users table ready");
          // Create indexes for users table
          db.run("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)", (idxErr) => {
            if (idxErr && !idxErr.message.includes("already exists")) {
              logger.error("Error creating username index:", idxErr.message);
            }
          });
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
          logger.error("Error creating portainer_instances table:", err.message);
        } else {
          logger.info("Portainer instances table ready");
          // Create indexes for portainer_instances table
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
          // Add display_order column if it doesn't exist (migration)
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN display_order INTEGER DEFAULT 0`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                logger.error("Error adding display_order column:", alterErr.message);
              }
            }
          );
          // Add api_key and auth_type columns if they don't exist (migration)
          db.run(`ALTER TABLE portainer_instances ADD COLUMN api_key TEXT`, (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding api_key column:", alterErr.message);
            }
          });
          db.run(
            `ALTER TABLE portainer_instances ADD COLUMN auth_type TEXT DEFAULT 'password'`,
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                logger.error("Error adding auth_type column:", alterErr.message);
              } else {
                // Update existing rows to have auth_type = 'password'
                db.run(
                  `UPDATE portainer_instances SET auth_type = 'password' WHERE auth_type IS NULL`,
                  (updateErr) => {
                    if (updateErr) {
                      logger.error("Error updating auth_type:", updateErr.message);
                    }
                  }
                );
              }
            }
          );
          // Add ip_address column if it doesn't exist (migration)
          db.run(`ALTER TABLE portainer_instances ADD COLUMN ip_address TEXT`, (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding ip_address column:", alterErr.message);
            }
          });
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
        name TEXT NOT NULL,
        image_name TEXT,
        github_repo TEXT,
        source_type TEXT DEFAULT 'docker', -- 'docker' or 'github'
        current_version TEXT,
        current_digest TEXT,
        latest_version TEXT,
        latest_digest TEXT,
        has_update INTEGER DEFAULT 0,
        current_version_publish_date TEXT,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(image_name, github_repo)
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating tracked_images table:", err.message);
        } else {
          logger.info("Tracked images table ready");

          // Migrate existing tracked_images table to add new columns if needed
          db.run("ALTER TABLE tracked_images ADD COLUMN github_repo TEXT", (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding github_repo column:", alterErr.message);
            }
          });
          db.run(
            "ALTER TABLE tracked_images ADD COLUMN source_type TEXT DEFAULT 'docker'",
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                logger.error("Error adding source_type column:", alterErr.message);
              }
            }
          );
          db.run("ALTER TABLE tracked_images ADD COLUMN gitlab_token TEXT", (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding gitlab_token column:", alterErr.message);
            }
          });
          db.run(
            "ALTER TABLE tracked_images ADD COLUMN current_version_publish_date TEXT",
            (alterErr) => {
              // Ignore error if column already exists
              if (alterErr && !alterErr.message.includes("duplicate column")) {
                logger.error("Error adding current_version_publish_date column:", alterErr.message);
              }
            }
          );

          // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
          // to remove the NOT NULL constraint from image_name
          db.get(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tracked_images'",
            [],
            (err, row) => {
              if (!err && row && row.sql && row.sql.includes("image_name TEXT NOT NULL")) {
                logger.info("Migrating tracked_images table to allow NULL image_name...");
                // Check if new columns already exist
                db.all("PRAGMA table_info(tracked_images)", [], (pragmaErr, columns) => {
                  if (pragmaErr) {
                    logger.error("Error checking table info:", pragmaErr.message);
                    return;
                  }

                  const hasGithubRepo = columns.some((col) => col.name === "github_repo");
                  const hasSourceType = columns.some((col) => col.name === "source_type");

                  // Create new table with correct schema
                  db.run(
                    `
                  CREATE TABLE IF NOT EXISTS tracked_images_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    image_name TEXT,
                    github_repo TEXT,
                    source_type TEXT DEFAULT 'docker',
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
                    UNIQUE(image_name, github_repo)
                  )
                `,
                    (createErr) => {
                      if (createErr) {
                        logger.error("Error creating new tracked_images table:", createErr.message);
                      } else {
                        // Copy data from old table to new table
                        // Use COALESCE to handle existing columns or defaults
                        const githubRepoSelect = hasGithubRepo ? "github_repo" : "NULL";
                        const sourceTypeSelect = hasSourceType ? "source_type" : "'docker'";

                        const hasLatestVersionPublishDate = columns.some(
                          (col) => col.name === "latest_version_publish_date"
                        );
                        const latestVersionPublishDateSelect = hasLatestVersionPublishDate
                          ? "latest_version_publish_date"
                          : "NULL";

                        db.run(
                          `
                      INSERT INTO tracked_images_new 
                      (id, name, image_name, github_repo, source_type, current_version, current_digest, latest_version, latest_digest, has_update, current_version_publish_date, latest_version_publish_date, last_checked, created_at, updated_at)
                      SELECT 
                        id, 
                        name, 
                        image_name, 
                        ${githubRepoSelect} as github_repo, 
                        ${sourceTypeSelect} as source_type,
                        current_version, 
                        current_digest, 
                        latest_version, 
                        latest_digest, 
                        has_update,
                        current_version_publish_date,
                        ${latestVersionPublishDateSelect} as latest_version_publish_date,
                        last_checked, 
                        created_at, 
                        updated_at
                      FROM tracked_images
                    `,
                          (copyErr) => {
                            if (copyErr) {
                              logger.error("Error copying data to new table:", copyErr.message);
                            } else {
                              // Drop old table
                              db.run("DROP TABLE tracked_images", (dropErr) => {
                                if (dropErr) {
                                  logger.error(
                                    "Error dropping old tracked_images table:",
                                    dropErr.message
                                  );
                                } else {
                                  // Rename new table
                                  db.run(
                                    "ALTER TABLE tracked_images_new RENAME TO tracked_images",
                                    (renameErr) => {
                                      if (renameErr) {
                                        logger.error(
                                          "Error renaming tracked_images table:",
                                          renameErr.message
                                        );
                                      } else {
                                        logger.info("Successfully migrated tracked_images table");
                                        // Recreate indexes
                                        db.run(
                                          "CREATE INDEX IF NOT EXISTS idx_tracked_images_name ON tracked_images(name)",
                                          () => {}
                                        );
                                        db.run(
                                          "CREATE INDEX IF NOT EXISTS idx_tracked_images_image_name ON tracked_images(image_name)",
                                          () => {}
                                        );
                                        db.run(
                                          "CREATE INDEX IF NOT EXISTS idx_tracked_images_github_repo ON tracked_images(github_repo)",
                                          () => {}
                                        );
                                      }
                                    }
                                  );
                                }
                              });
                            }
                          }
                        );
                      }
                    }
                  );
                });
              }
            }
          );

          // Check if latest_version_publish_date column exists, add it if not
          db.all("PRAGMA table_info(tracked_images)", [], (pragmaErr, columns) => {
            if (!pragmaErr && columns) {
              const hasLatestVersionPublishDate = columns.some(
                (col) => col.name === "latest_version_publish_date"
              );
              if (!hasLatestVersionPublishDate) {
                logger.info("Adding latest_version_publish_date column to tracked_images...");
                db.run(
                  "ALTER TABLE tracked_images ADD COLUMN latest_version_publish_date TEXT",
                  (alterErr) => {
                    if (alterErr) {
                      logger.error(
                        "Error adding latest_version_publish_date column:",
                        alterErr.message
                      );
                    } else {
                      logger.info("Successfully added latest_version_publish_date column");
                    }
                  }
                );
              }
            }
          });

          // Create indexes
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
          // Check if job_type column exists and if there's a CHECK constraint on id
          db.all("PRAGMA table_info(batch_config)", (pragmaErr, columns) => {
            if (pragmaErr) {
              logger.error("Error checking batch_config schema:", pragmaErr.message);
              return;
            }

            const hasJobType = columns.some((col) => col.name === "job_type");

            // Check for CHECK constraint by looking at table creation SQL
            db.get(
              "SELECT sql FROM sqlite_master WHERE type='table' AND name='batch_config'",
              (sqlErr, tableInfo) => {
                if (sqlErr) {
                  logger.error("Error checking batch_config SQL:", sqlErr.message);
                  return;
                }

                const hasCheckConstraint =
                  tableInfo &&
                  tableInfo.sql &&
                  tableInfo.sql.includes("CHECK") &&
                  tableInfo.sql.includes("id = 1");
                const needsMigration = !hasJobType || hasCheckConstraint;

                if (needsMigration) {
                  logger.info(
                    "Migrating batch_config table to remove CHECK constraint and add job_type column..."
                  );
                  // Always recreate the table to remove CHECK constraint
                  db.run("BEGIN TRANSACTION", (beginErr) => {
                    if (beginErr) {
                      logger.error("Error beginning transaction:", beginErr.message);
                      return;
                    }

                    // Get existing data
                    db.all("SELECT * FROM batch_config", [], (selectErr, oldRows) => {
                      if (selectErr) {
                        logger.error("Error reading old batch_config:", selectErr.message);
                        db.run("ROLLBACK");
                        return;
                      }

                      // Drop old table
                      db.run("DROP TABLE batch_config", (dropErr) => {
                        if (dropErr) {
                          logger.error("Error dropping batch_config:", dropErr.message);
                          db.run("ROLLBACK");
                          return;
                        }

                        // Create new table with job_type and no CHECK constraint
                        db.run(
                          `CREATE TABLE batch_config (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          job_type TEXT NOT NULL UNIQUE,
                          enabled INTEGER DEFAULT 0,
                          interval_minutes INTEGER DEFAULT 60,
                          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )`,
                          (createErr) => {
                            if (createErr) {
                              logger.error("Error recreating batch_config:", createErr.message);
                              db.run("ROLLBACK");
                              return;
                            }

                            // Migrate old data - assume it's for docker-hub-pull
                            if (oldRows && oldRows.length > 0) {
                              const oldRow = oldRows[0];
                              db.run(
                                "INSERT INTO batch_config (job_type, enabled, interval_minutes) VALUES ('docker-hub-pull', ?, ?)",
                                [oldRow.enabled || 0, oldRow.interval_minutes || 60],
                                (insertErr) => {
                                  if (insertErr) {
                                    logger.error(
                                      "Error migrating docker-hub-pull config:",
                                      insertErr.message
                                    );
                                  }
                                  // Also ensure tracked-apps-check exists
                                  db.run(
                                    "INSERT OR IGNORE INTO batch_config (job_type, enabled, interval_minutes) VALUES ('tracked-apps-check', 0, 60)",
                                    (insertErr2) => {
                                      if (insertErr2) {
                                        logger.error(
                                          "Error creating tracked-apps-check config:",
                                          insertErr2.message
                                        );
                                      }
                                      db.run("COMMIT", (commitErr) => {
                                        if (commitErr) {
                                          logger.error(
                                            "Error committing transaction:",
                                            commitErr.message
                                          );
                                        } else {
                                          logger.info(
                                            "✅ Successfully migrated batch_config table (removed CHECK constraint)"
                                          );
                                        }
                                      });
                                    }
                                  );
                                }
                              );
                            } else {
                              // No old data, just create defaults
                              db.run(
                                "INSERT INTO batch_config (job_type, enabled, interval_minutes) VALUES ('docker-hub-pull', 0, 60)",
                                (insertErr1) => {
                                  if (insertErr1) {
                                    logger.error(
                                      "Error creating docker-hub-pull config:",
                                      insertErr1.message
                                    );
                                  }
                                  db.run(
                                    "INSERT INTO batch_config (job_type, enabled, interval_minutes) VALUES ('tracked-apps-check', 0, 60)",
                                    (insertErr2) => {
                                      if (insertErr2) {
                                        logger.error(
                                          "Error creating tracked-apps-check config:",
                                          insertErr2.message
                                        );
                                      }
                                      db.run("COMMIT", (commitErr) => {
                                        if (commitErr) {
                                          logger.error(
                                            "Error committing transaction:",
                                            commitErr.message
                                          );
                                        } else {
                                          logger.info(
                                            "✅ Successfully recreated batch_config table (removed CHECK constraint)"
                                          );
                                        }
                                      });
                                    }
                                  );
                                }
                              );
                            }
                          }
                        );
                      });
                    });
                  });
                } else {
                  // Column exists, proceed with normal migration
                  // Migrate old single-row config to new per-job-type configs
                  db.get("SELECT * FROM batch_config WHERE id = 1", (migrateErr, oldRow) => {
                    if (!migrateErr && oldRow && !oldRow.job_type) {
                      // Old format exists, migrate it
                      const enabled = oldRow.enabled || 0;
                      const intervalMinutes = oldRow.interval_minutes || 60;

                      // Delete old row
                      db.run("DELETE FROM batch_config WHERE id = 1", (delErr) => {
                        if (delErr) {
                          logger.error("Error deleting old batch_config:", delErr.message);
                        } else {
                          // Insert new rows for each job type
                          db.run(
                            "INSERT OR IGNORE INTO batch_config (job_type, enabled, interval_minutes) VALUES ('docker-hub-pull', ?, ?)",
                            [enabled, intervalMinutes],
                            (insertErr1) => {
                              if (insertErr1) {
                                logger.error(
                                  "Error migrating docker-hub-pull config:",
                                  insertErr1.message
                                );
                              }
                            }
                          );
                          db.run(
                            "INSERT OR IGNORE INTO batch_config (job_type, enabled, interval_minutes) VALUES ('tracked-apps-check', ?, ?)",
                            [enabled, intervalMinutes],
                            (insertErr2) => {
                              if (insertErr2) {
                                logger.error(
                                  "Error migrating tracked-apps-check config:",
                                  insertErr2.message
                                );
                              } else {
                                logger.info("✅ Migrated batch_config to per-job-type format");
                              }
                            }
                          );
                        }
                      });
                    } else {
                      // No old config or already migrated, initialize defaults
                      db.get(
                        "SELECT id FROM batch_config WHERE job_type = 'docker-hub-pull'",
                        (initErr1, row1) => {
                          if (!initErr1 && !row1) {
                            db.run(
                              "INSERT INTO batch_config (job_type, enabled, interval_minutes) VALUES ('docker-hub-pull', 0, 60)",
                              (insertErr1) => {
                                if (insertErr1) {
                                  logger.error(
                                    "Error initializing docker-hub-pull config:",
                                    insertErr1.message
                                  );
                                }
                              }
                            );
                          }
                        }
                      );
                      db.get(
                        "SELECT id FROM batch_config WHERE job_type = 'tracked-apps-check'",
                        (initErr2, row2) => {
                          if (!initErr2 && !row2) {
                            db.run(
                              "INSERT INTO batch_config (job_type, enabled, interval_minutes) VALUES ('tracked-apps-check', 0, 60)",
                              (insertErr2) => {
                                if (insertErr2) {
                                  logger.error(
                                    "Error initializing tracked-apps-check config:",
                                    insertErr2.message
                                  );
                                }
                              }
                            );
                          }
                        }
                      );
                    }
                  });
                }
              }
            ); // Close db.get at line 391
          }); // Close db.all at line 382
        }
      }
    );

    // Create settings table for application settings
    db.run(
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          logger.error("Error creating settings table:", err.message);
        } else {
          logger.info("Settings table ready");
          // Create index for settings table
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

          // Add avatar_url column if it doesn't exist (migration)
          db.run("ALTER TABLE discord_webhooks ADD COLUMN avatar_url TEXT", (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding avatar_url column:", alterErr.message);
            } else if (!alterErr) {
              logger.info("Added avatar_url column to discord_webhooks table");
            }
          });

          // Add guild_id and channel_id columns if they don't exist (migration)
          db.run("ALTER TABLE discord_webhooks ADD COLUMN guild_id TEXT", (alterErr) => {
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding guild_id column:", alterErr.message);
            } else if (!alterErr) {
              logger.info("Added guild_id column to discord_webhooks table");
            }
          });

          db.run("ALTER TABLE discord_webhooks ADD COLUMN channel_id TEXT", (alterErr) => {
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding channel_id column:", alterErr.message);
            } else if (!alterErr) {
              logger.info("Added channel_id column to discord_webhooks table");
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
              }
            }
          );
          // Add job_type column if it doesn't exist (migration)
          db.run(
            `ALTER TABLE batch_runs ADD COLUMN job_type TEXT DEFAULT 'docker-hub-pull'`,
            (alterErr) => {
              // Ignore error if column already exists
            }
          );
          // Add is_manual column if it doesn't exist (migration)
          db.run(`ALTER TABLE batch_runs ADD COLUMN is_manual INTEGER DEFAULT 0`, (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes("duplicate column")) {
              logger.error("Error adding is_manual column:", alterErr.message);
            }
          });
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
      logger.error("Error checking users:", err.message);
      return;
    }

    if (row.count === 0) {
      // Use ADMIN_PASSWORD if set and not empty, otherwise default to 'admin'
      const defaultPassword =
        (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim()) || "admin";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      db.run(
        "INSERT INTO users (username, password_hash, role, password_changed) VALUES (?, ?, ?, ?)",
        ["admin", passwordHash, "Administrator", 0],
        (err) => {
          if (err) {
            logger.error("Error creating default admin:", err.message);
          } else {
            logger.info("Default admin user created (username: admin, password: admin)");
            logger.info("⚠️  Password change will be required on first login!");
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
async function updatePassword(username, newPassword, markPasswordChanged = true) {
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
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances ORDER BY display_order ASC, created_at ASC",
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
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances WHERE id = ?",
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
 * @param {string} apiKey - API key (for API key auth)
 * @param {string} authType - Authentication type
 * @param {string} ipAddress - IP address (optional, will be resolved if not provided)
 * @returns {Promise<number>} - ID of created instance
 */
function createPortainerInstance(
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "apikey",
  ipAddress = null
) {
  return new Promise((resolve, reject) => {
    // Get max display_order to set new instance at the end
    db.get("SELECT MAX(display_order) as max_order FROM portainer_instances", [], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      const nextOrder = (row?.max_order ?? -1) + 1;

      // Use appropriate fields based on auth type
      // IMPORTANT: When creating with a specific auth type, only store data for that method
      // Use empty strings instead of null to satisfy NOT NULL constraints
      const finalUsername = authType === "apikey" ? "" : username || "";
      const finalPassword = authType === "apikey" ? "" : password || "";
      // Only store API key when using API key auth, otherwise set to null
      const finalApiKey = authType === "apikey" ? apiKey || null : null;

      db.run(
        "INSERT INTO portainer_instances (name, url, username, password, api_key, auth_type, display_order, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [name, url, finalUsername, finalPassword, finalApiKey, authType, nextOrder, ipAddress],
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
  name,
  url,
  username,
  password,
  apiKey = null,
  authType = "apikey",
  ipAddress = null
) {
  return new Promise((resolve, reject) => {
    // Use appropriate fields based on auth type
    // IMPORTANT: When switching auth methods, explicitly clear the old method's data
    // Use empty strings instead of null to satisfy NOT NULL constraints
    const finalUsername = authType === "apikey" ? "" : username || "";
    const finalPassword = authType === "apikey" ? "" : password || "";
    // Clear API key when using password auth, set it when using API key auth
    const finalApiKey = authType === "apikey" ? apiKey || null : null;

    db.run(
      "UPDATE portainer_instances SET name = ?, url = ?, username = ?, password = ?, api_key = ?, auth_type = ?, ip_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [name, url, finalUsername, finalPassword, finalApiKey, authType, ipAddress, id],
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
    db.run("DELETE FROM portainer_instances WHERE id = ?", [id], function (err) {
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
 * Get batch configuration for a specific job type or all job types
 * @param {string} jobType - Optional job type (e.g., 'docker-hub-pull', 'tracked-apps-check'). If null, returns all configs.
 * @returns {Promise<Object|null>} - Batch configuration(s) or null
 */
function getBatchConfig(jobType = null) {
  return new Promise((resolve, reject) => {
    if (jobType) {
      // Get config for specific job type
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
    } else {
      // Get all configs (for backward compatibility and frontend)
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
            // Ensure both job types exist
            if (!configs["docker-hub-pull"]) {
              configs["docker-hub-pull"] = { enabled: false, intervalMinutes: 60, updatedAt: null };
            }
            if (!configs["tracked-apps-check"]) {
              configs["tracked-apps-check"] = {
                enabled: false,
                intervalMinutes: 60,
                updatedAt: null,
              };
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
 * @param {string} jobType - Job type (e.g., 'docker-hub-pull', 'tracked-apps-check')
 * @param {boolean} enabled - Whether batch processing is enabled
 * @param {number} intervalMinutes - Interval in minutes between batch runs
 * @returns {Promise<void>}
 */
function updateBatchConfig(jobType, enabled, intervalMinutes) {
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
 * @param {string} status - Run status ('running', 'completed', 'failed')
 * @param {string} jobType - Job type ('docker-hub-pull', 'tracked-apps-check', etc.)
 * @param {boolean} isManual - Whether this run was manually triggered
 * @returns {Promise<number>} - ID of created batch run
 */
function createBatchRun(status = "running", jobType = "docker-hub-pull", isManual = false) {
  return new Promise((resolve, reject) => {
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
 * @param {string} status - Final status ('completed', 'failed')
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
    // Calculate duration
    db.get("SELECT started_at FROM batch_runs WHERE id = ?", [runId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (!row) {
        reject(new Error("Batch run not found"));
        return;
      }

      // Parse started_at as UTC (SQLite DATETIME is stored as UTC without timezone info)
      const startedAtStr = row.started_at;
      let startedAt;
      if (
        typeof startedAtStr === "string" &&
        /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
      ) {
        // SQLite datetime format - convert to ISO and add Z for UTC
        startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
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
 * @param {string} jobType - Job type to filter by (e.g., 'docker-hub-pull', 'tracked-apps-check')
 * @returns {Promise<Object|null>} - Most recent batch run for the job type or null
 */
function getLatestBatchRunByJobType(jobType) {
  return new Promise((resolve, reject) => {
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
 * Close database connection
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
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
 * Get all tracked images
 * @returns {Promise<Array>} - Array of tracked images
 */
function getAllTrackedImages() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM tracked_images ORDER BY name ASC", [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get a tracked image by ID
 * @param {number} id - Tracked image ID
 * @returns {Promise<Object|null>} - Tracked image or null
 */
function getTrackedImageById(id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM tracked_images WHERE id = ?", [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Get a tracked image by image name or GitHub repo
 * @param {string} imageName - Image name (or null for GitHub)
 * @param {string} githubRepo - GitHub repo (or null for Docker)
 * @returns {Promise<Object|null>} - Tracked image or null
 */
function getTrackedImageByImageName(imageName = null, githubRepo = null) {
  return new Promise((resolve, reject) => {
    if (githubRepo) {
      db.get("SELECT * FROM tracked_images WHERE github_repo = ?", [githubRepo], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    } else if (imageName) {
      db.get("SELECT * FROM tracked_images WHERE image_name = ?", [imageName], (err, row) => {
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
 * @param {string} name - Display name
 * @param {string} imageName - Image name (e.g., 'homeassistant/home-assistant:latest') or null for GitHub
 * @param {string} githubRepo - GitHub repo (e.g., 'home-assistant/core') or null for Docker
 * @param {string} sourceType - 'docker', 'github', or 'gitlab'
 * @param {string} gitlabToken - GitLab token for authentication (optional)
 * @returns {Promise<number>} - ID of created tracked image
 */
function createTrackedImage(
  name,
  imageName = null,
  githubRepo = null,
  sourceType = "docker",
  gitlabToken = null
) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO tracked_images (name, image_name, github_repo, source_type, gitlab_token) VALUES (?, ?, ?, ?, ?)",
      [name, imageName, githubRepo, sourceType, gitlabToken],
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
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
function updateTrackedImage(id, updateData) {
  return new Promise((resolve, reject) => {
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
    values.push(id);

    const sql = `UPDATE tracked_images SET ${fields.join(", ")} WHERE id = ?`;

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
 * @returns {Promise<void>}
 */
function deleteTrackedImage(id) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM tracked_images WHERE id = ?", [id], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Clear latest version data for all tracked images
 * This resets latest_version, latest_digest, has_update, and current_version_publish_date
 * @returns {Promise<number>} - Number of rows updated
 */
function clearLatestVersionsForAllTrackedImages() {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE tracked_images 
       SET latest_version = NULL, 
           latest_digest = NULL, 
           has_update = 0,
           current_version_publish_date = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      [],
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
 * Get a setting value by key
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} - Setting value or null if not found
 */
function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get("SELECT value FROM settings WHERE key = ?", [key], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.value : null);
      }
    });
  });
}

/**
 * Set a setting value by key
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<void>}
 */
function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO settings (key, value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
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
 * Get all Discord webhooks
 * @returns {Promise<Array>} - Array of webhook objects
 */
function getAllDiscordWebhooks() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT id, webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks ORDER BY created_at ASC",
      [],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Don't expose full webhook URL for security, just indicate if it's set
          const sanitized = rows.map((row) => ({
            id: row.id,
            webhookUrl: row.webhook_url ? "***configured***" : null,
            serverName: row.server_name || null,
            channelName: row.channel_name || null,
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
 * Get a Discord webhook by ID (with full URL for internal use)
 * @param {number} id - Webhook ID
 * @returns {Promise<Object|null>} - Webhook object or null
 */
function getDiscordWebhookById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT id, webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE id = ?",
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
  avatarUrl = null,
  guildId = null,
  channelId = null
) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO discord_webhooks (webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [webhookUrl, serverName, channelName, avatarUrl, guildId, channelId, enabled ? 1 : 0],
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
 * Get all enabled Discord webhooks (for sending notifications)
 * @returns {Promise<Array>} - Array of enabled webhook objects with full URLs
 */
function getEnabledDiscordWebhooks() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT id, webhook_url, server_name, channel_name FROM discord_webhooks WHERE enabled = 1",
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
  getAllTrackedImages,
  getTrackedImageById,
  getTrackedImageByImageName,
  createTrackedImage,
  updateTrackedImage,
  deleteTrackedImage,
  clearLatestVersionsForAllTrackedImages,
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
