/**
 * Database Migrations
 *
 * This module handles database schema migrations in a versioned, safe manner.
 * Migrations are automatically discovered from files in this directory and
 * applied in order. Applied migrations are tracked to prevent duplicate execution.
 *
 * Migration files should follow the pattern: XXXX_description.js
 * Where XXXX is a zero-padded 4-digit version number.
 *
 * See README.md in this directory for migration creation guidelines.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("../connection");

/**
 * Get the current database schema version
 * @returns {Promise<number>} - Current schema version (0 if no migrations table exists)
 */
async function getCurrentVersion() {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();

          // Check if migrations table exists
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            (err, row) => {
              if (err) {
                return reject(err);
              }

              if (!row) {
                // No migrations table, schema version is 0
                return resolve(0);
              }

              // Get the latest migration version
              db.get(
                "SELECT MAX(version) as version FROM schema_migrations",
                [],

                // eslint-disable-next-line no-shadow -- Error parameter shadows outer scope, but needed for callback
                (err, versionRow) => {
                  if (err) {
                    return reject(err);
                  }
                  resolve(versionRow?.version || 0);
                }
              );
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Record that a migration has been applied
 * @param {number} version - Migration version number
 * @param {string} name - Migration name
 * @returns {Promise<void>}
 */
async function recordMigration(version, name) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            [version, name],
            (err) => {
              if (err) {
                logger.error("Error recording migration:", { version, name, error: err });
                return reject(err);
              }
              logger.info(`Migration ${version}: ${name} recorded`);
              resolve();
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Create the migrations tracking table
 * @returns {Promise<void>}
 */
async function createMigrationsTable() {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            `CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
            (err) => {
              if (err) {
                logger.error("Error creating migrations table:", { error: err });
                return reject(err);
              }
              logger.info("Migrations table ready");
              resolve();
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Discover and load all migration files from the migrations directory
 * @returns {Array<Object>} - Array of migration objects sorted by version
 */
function loadMigrations() {
  const migrationsDir = __dirname;
  const migrations = [];

  try {
    // Read all files in the migrations directory
    const files = fs
      .readdirSync(migrationsDir)
      .filter(
        (file) =>
          // Only include .js files, exclude index.js, helpers.js, README.md
          file.endsWith(".js") && file !== "index.js" && file !== "helpers.js"
      )
      .sort(); // Natural sort handles 0001, 0002, 0010, etc. correctly

    // Load each migration file
    for (const file of files) {
      try {
        const filePath = path.join(migrationsDir, file);
        const migration = require(filePath);

        // Validate migration structure
        if (!migration.version || !migration.name || typeof migration.up !== "function") {
          logger.warn(`Invalid migration file ${file}: missing version, name, or up function`);
          continue;
        }

        // Extract version from filename for validation
        // eslint-disable-next-line prefer-named-capture-group -- Simple regex, named group not needed
        const filenameVersion = parseInt(file.match(/^(\d+)/)?.[1], 10);
        if (filenameVersion && filenameVersion !== migration.version) {
          logger.warn(
            `Migration file ${file} version mismatch: filename suggests ${filenameVersion}, but migration has ${migration.version}`
          );
        }

        migrations.push({
          version: migration.version,
          name: migration.name,
          up: migration.up,
          filename: file,
        });
      } catch (err) {
        logger.error(`Error loading migration file ${file}:`, { error: err });
        // Continue loading other migrations even if one fails
      }
    }

    // Sort by version number to ensure correct execution order
    migrations.sort((a, b) => a.version - b.version);

    logger.info(`Loaded ${migrations.length} migration(s) from files`);
    return migrations;
  } catch (err) {
    logger.error("Error discovering migrations:", { error: err });
    throw err;
  }
}

/**
 * Run all pending migrations
 * @returns {Promise<void>}
 */
async function runMigrations() {
  try {
    // Create migrations table if it doesn't exist
    await createMigrationsTable();

    // Get current version
    const currentVersion = await getCurrentVersion();
    logger.info(`Current database schema version: ${currentVersion}`);

    // Discover and load all migrations
    const allMigrations = loadMigrations();

    if (allMigrations.length === 0) {
      logger.warn("No migration files found");
      return;
    }

    // Filter to only pending migrations
    const pendingMigrations = allMigrations.filter((m) => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      logger.info("No pending migrations");
      return;
    }

    logger.info(
      `Found ${pendingMigrations.length} pending migration(s) out of ${allMigrations.length} total`
    );

    // Run each migration in order
    for (const migration of pendingMigrations) {
      logger.info(
        `Running migration ${migration.version}: ${migration.name} (${migration.filename})`
      );
      try {
        await migration.up();
        await recordMigration(migration.version, migration.name);
        logger.info(`Migration ${migration.version}: ${migration.name} completed successfully`);
      } catch (err) {
        logger.error(`Migration ${migration.version}: ${migration.name} failed:`, { error: err });
        throw new Error(`Migration ${migration.version} failed: ${err.message}`);
      }
    }

    const newVersion = await getCurrentVersion();
    logger.info(`Database schema updated to version: ${newVersion}`);
  } catch (err) {
    logger.error("Error running migrations:", { error: err });
    throw err;
  }
}

module.exports = {
  getCurrentVersion,
  recordMigration,
  createMigrationsTable,
  loadMigrations,
  runMigrations,
};
