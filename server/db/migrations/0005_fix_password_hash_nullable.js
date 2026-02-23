/**
 * Migration 5: Make password_hash nullable
 *
 * Rebuilds the users table to change password_hash from NOT NULL to nullable.
 * This is required for OAuth-only users who have no local password.
 * SQLite does not support ALTER COLUMN, so we must recreate the table.
 *
 * Version: 5
 * Date: 2026-02-23
 */

const logger = require("../../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("../connection");

/**
 * Rebuild the users table to change password_hash from NOT NULL to nullable.
 * Uses the standard SQLite rename-copy-drop pattern.
 */
async function makePasswordHashNullable() {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        const db = getDatabase();
        db.serialize(() => {
          // 1. Rename existing table
          db.run("ALTER TABLE users RENAME TO users_old", (err) => {
            if (err) {
              logger.error("Migration 5: Failed to rename users table:", { error: err });
              return reject(err);
            }

            // 2. Create new table with password_hash nullable (TEXT instead of TEXT NOT NULL)
            db.run(
              `CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                email TEXT,
                role TEXT DEFAULT 'Administrator',
                password_changed INTEGER DEFAULT 0,
                instance_admin INTEGER DEFAULT 0,
                verification_token TEXT,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                oauth_provider TEXT,
                oauth_provider_id TEXT
              )`,
              (createErr) => {
                if (createErr) {
                  // Attempt to undo the rename
                  db.run("ALTER TABLE users_old RENAME TO users", () => {});
                  logger.error("Migration 5: Failed to create new users table:", {
                    error: createErr,
                  });
                  return reject(createErr);
                }

                // 3. Copy all data from old table to new table
                db.run(
                  `INSERT INTO users (id, username, password_hash, email, role, password_changed,
                    instance_admin, verification_token, last_login, created_at, updated_at,
                    oauth_provider, oauth_provider_id)
                   SELECT id, username, password_hash, email, role, password_changed,
                    instance_admin, verification_token, last_login, created_at, updated_at,
                    oauth_provider, oauth_provider_id
                   FROM users_old`,
                  (copyErr) => {
                    if (copyErr) {
                      // Attempt to undo: drop new table, rename old back
                      db.run("DROP TABLE users", () => {
                        db.run("ALTER TABLE users_old RENAME TO users", () => {});
                      });
                      logger.error("Migration 5: Failed to copy user data:", { error: copyErr });
                      return reject(copyErr);
                    }

                    // 4. Drop old table
                    db.run("DROP TABLE users_old", (dropErr) => {
                      if (dropErr) {
                        logger.warn("Migration 5: Failed to drop users_old:", {
                          error: dropErr,
                        });
                        // Non-fatal: data is already in the new table
                      }

                      // 5. Recreate indexes
                      db.run(
                        "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
                        () => {}
                      );
                      db.run(
                        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_provider_id ON users(oauth_provider, oauth_provider_id)",
                        (idxErr) => {
                          if (idxErr) {
                            logger.warn("Migration 5: Index recreation warning:", {
                              error: idxErr,
                            });
                          }
                          logger.info(
                            "Migration 5: Rebuilt users table with nullable password_hash"
                          );
                          resolve();
                        }
                      );
                    });
                  }
                );
              }
            );
          });
        });
      })
  );
}

module.exports = {
  version: 5,
  name: "Make password_hash nullable for OAuth users",
  up: async () => {
    logger.info("Migration 5: Making password_hash nullable");
    await makePasswordHashNullable();
    logger.info("Migration 5 completed successfully");
  },
};
