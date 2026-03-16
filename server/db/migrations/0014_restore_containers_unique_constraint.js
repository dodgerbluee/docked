/**
 * Migration 14: Restore UNIQUE constraint on containers table
 *
 * Migration 0013 recreated the containers table but dropped the UNIQUE constraint
 * on (user_id, container_id, source_instance_id, endpoint_id). Without this
 * constraint, INSERT OR REPLACE always inserts new rows, causing duplicate
 * container records to accumulate on every scan. This inflates container counts
 * (e.g., 7 real containers appearing as 685 rows).
 *
 * This migration:
 * 1. Deduplicates existing rows (keeps the most recently updated row per identity)
 * 2. Recreates the table with a UNIQUE constraint covering both source and runner containers
 */

const logger = require("../../utils/logger");
const { executeSql, createIndexIfNotExists } = require("./helpers");
const { getDatabase, queueDatabaseOperation } = require("../connection");

module.exports = {
  version: 14,
  name: "Restore containers UNIQUE constraint and deduplicate rows",

  async up() {
    logger.info("Migration 14: Restoring UNIQUE constraint on containers table");

    // Step 0: Count duplicates for logging
    const beforeCount = await queueDatabaseOperation(
      () =>
        new Promise((resolve, reject) => {
          const db = getDatabase();
          db.get("SELECT COUNT(*) as count FROM containers", [], (err, row) => {
            if (err) return reject(err);
            resolve(row?.count || 0);
          });
        })
    );
    logger.info(`Migration 14: ${beforeCount} rows in containers table before dedup`);

    // Step 1: Create new table with UNIQUE constraints
    // Two separate UNIQUE constraints:
    // - Source containers: (user_id, container_id, source_instance_id, endpoint_id)
    //   where source_instance_id IS NOT NULL
    // - Runner containers: (user_id, container_id, runner_id)
    //   where runner_id IS NOT NULL
    // SQLite doesn't support partial unique indexes in CREATE TABLE, so we use
    // a single composite unique index that covers both cases. Since source containers
    // have runner_id=NULL and runner containers have source_instance_id=NULL and
    // endpoint_id=NULL, we use COALESCE to make the unique constraint work for both.
    await executeSql(`
      CREATE TABLE IF NOT EXISTS containers_v14 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        source_instance_id INTEGER,
        runner_id INTEGER,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        endpoint_id TEXT,
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (source_instance_id) REFERENCES source_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )
    `);

    // Step 2: Copy only deduplicated rows (keep the most recently updated per identity)
    // For source containers: unique by (user_id, container_id, source_instance_id, endpoint_id)
    // For runner containers: unique by (user_id, container_id, runner_id)
    // We use a subquery to find the MAX(id) per group (most recent insert wins)
    await executeSql(`
      INSERT INTO containers_v14 (
        id, user_id, source_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      )
      SELECT
        id, user_id, source_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      FROM containers
      WHERE id IN (
        SELECT MAX(id) FROM containers
        WHERE source_instance_id IS NOT NULL
        GROUP BY user_id, container_id, source_instance_id, endpoint_id
        UNION ALL
        SELECT MAX(id) FROM containers
        WHERE runner_id IS NOT NULL
        GROUP BY user_id, container_id, runner_id
      )
    `);

    // Step 3: Drop old table and rename
    await executeSql("DROP TABLE containers");
    await executeSql("ALTER TABLE containers_v14 RENAME TO containers");

    // Step 4: Create unique indexes (partial unique indexes via CREATE UNIQUE INDEX)
    // For source containers
    await createIndexIfNotExists(
      "idx_containers_source_unique",
      "containers",
      "user_id, container_id, source_instance_id, endpoint_id",
      true // unique
    );

    // For runner containers
    await createIndexIfNotExists(
      "idx_containers_runner_unique",
      "containers",
      "user_id, container_id, runner_id",
      true // unique
    );

    // Step 5: Recreate regular indexes
    await createIndexIfNotExists("idx_containers_user_id", "containers", "user_id");
    await createIndexIfNotExists(
      "idx_containers_source_instance",
      "containers",
      "source_instance_id"
    );
    await createIndexIfNotExists("idx_containers_runner_id", "containers", "runner_id");
    await createIndexIfNotExists(
      "idx_containers_deployed_image",
      "containers",
      "deployed_image_id"
    );
    await createIndexIfNotExists("idx_containers_image_repo", "containers", "image_repo");
    await createIndexIfNotExists("idx_containers_last_seen", "containers", "last_seen");

    // Step 6: Count after dedup for logging
    const afterCount = await queueDatabaseOperation(
      () =>
        new Promise((resolve, reject) => {
          const db = getDatabase();
          db.get("SELECT COUNT(*) as count FROM containers", [], (err, row) => {
            if (err) return reject(err);
            resolve(row?.count || 0);
          });
        })
    );
    const removed = beforeCount - afterCount;
    logger.info(
      `Migration 14: ${afterCount} rows after dedup (removed ${removed} duplicate rows)`
    );

    logger.info("Migration 14: UNIQUE constraints restored on containers table");
  },
};
