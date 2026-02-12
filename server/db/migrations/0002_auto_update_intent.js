/**
 * Migration 2: Add Auto-Update Intent Support
 *
 * This migration adds the auto_update_intents table which stores user intent
 * for automatic container upgrades. Auto-update intents are persistent across
 * Portainer database wipes and match containers dynamically using stable
 * identifiers (image repo, stack+service, container name).
 *
 * Version: 2
 * Date: 2025-02-03
 */

const logger = require("../../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("../connection");

module.exports = {
  version: 2,
  name: "Add auto-update intent support",
  up: async () => {
    return queueDatabaseOperation(
      () =>
        new Promise((resolve, reject) => {
          try {
            const db = getDatabase();

            // Create auto_update_intents table
            db.run(
              `CREATE TABLE IF NOT EXISTS auto_update_intents (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              
              -- Matching criteria (at least one must be set)
              -- Matched in priority order: stack_service > image_repo > container_name
              stack_name TEXT,
              service_name TEXT,
              image_repo TEXT,
              container_name TEXT,
              
              -- Intent configuration
              enabled INTEGER DEFAULT 0,
              notify_discord INTEGER DEFAULT 0,
              notify_on_update_detected INTEGER DEFAULT 0,
              notify_on_batch_start INTEGER DEFAULT 0,
              notify_on_success INTEGER DEFAULT 0,
              notify_on_failure INTEGER DEFAULT 0,
              
              -- Metadata
              description TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              
              -- Constraints
              UNIQUE(user_id, stack_name, service_name),
              UNIQUE(user_id, image_repo),
              UNIQUE(user_id, container_name),
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,
              (err) => {
                if (err) {
                  logger.warn(
                    "auto_update_intents table may already exist or migration error:",
                    err.message
                  );
                  // Continue - table might already exist
                }

                // Create indexes for matching
                const indexes = [
                  {
                    name: "idx_auto_update_intents_user_enabled",
                    sql: `CREATE INDEX IF NOT EXISTS idx_auto_update_intents_user_enabled 
                      ON auto_update_intents(user_id, enabled)`,
                  },
                  {
                    name: "idx_auto_update_intents_stack_service",
                    sql: `CREATE INDEX IF NOT EXISTS idx_auto_update_intents_stack_service 
                      ON auto_update_intents(user_id, stack_name, service_name) WHERE enabled = 1`,
                  },
                  {
                    name: "idx_auto_update_intents_image_repo",
                    sql: `CREATE INDEX IF NOT EXISTS idx_auto_update_intents_image_repo 
                      ON auto_update_intents(user_id, image_repo) WHERE enabled = 1`,
                  },
                  {
                    name: "idx_auto_update_intents_container_name",
                    sql: `CREATE INDEX IF NOT EXISTS idx_auto_update_intents_container_name 
                      ON auto_update_intents(user_id, container_name) WHERE enabled = 1`,
                  },
                ];

                let completedIndexes = 0;
                const totalIndexes = indexes.length;

                if (totalIndexes === 0) {
                  logger.info("Migration 2: auto-update intent table created successfully");
                  return resolve();
                }

                indexes.forEach((indexDef) => {
                  db.run(indexDef.sql, (indexErr) => {
                    if (indexErr) {
                      logger.warn(`Failed to create index ${indexDef.name}:`, indexErr.message);
                      // Continue - index might already exist
                    }
                    completedIndexes++;

                    if (completedIndexes === totalIndexes) {
                      logger.info("Migration 2: auto-update intent support added successfully");
                      resolve();
                    }
                  });
                });
              }
            );
          } catch (err) {
            logger.error("Migration 2 error:", err);
            reject(err);
          }
        })
    );
  },

  down: async () => {
    // Rollback not typically used in production, but provided for completeness
    return queueDatabaseOperation(
      () =>
        new Promise((resolve, reject) => {
          try {
            const db = getDatabase();

            // Drop indexes first
            const indexes = [
              "idx_auto_update_intents_user_enabled",
              "idx_auto_update_intents_stack_service",
              "idx_auto_update_intents_image_repo",
              "idx_auto_update_intents_container_name",
            ];

            let completedDrops = 0;
            const totalDrops = indexes.length;

            if (totalDrops === 0) {
              // Drop table
              db.run("DROP TABLE IF EXISTS auto_update_intents", (tableErr) => {
                if (tableErr) {
                  logger.warn("Failed to drop auto_update_intents table:", tableErr.message);
                }
                resolve();
              });
              return;
            }

            indexes.forEach((indexName) => {
              db.run(`DROP INDEX IF EXISTS ${indexName}`, (err) => {
                if (err) {
                  logger.warn(`Failed to drop index ${indexName}:`, err.message);
                }
                completedDrops++;

                if (completedDrops === totalDrops) {
                  // Drop table after all indexes
                  db.run("DROP TABLE IF EXISTS auto_update_intents", (tableErr) => {
                    if (tableErr) {
                      logger.warn(
                        "Failed to drop auto_update_intents table:",
                        tableErr.message
                      );
                    }
                    resolve();
                  });
                }
              });
            });
          } catch (err) {
            logger.error("Migration 2 rollback error:", err);
            reject(err);
          }
        })
    );
  },
};
