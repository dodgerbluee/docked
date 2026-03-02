/**
 * Migration 10: Runner Container Support
 *
 * - Makes portainer_instance_id nullable in the containers table so that
 *   containers managed directly by a dockhand runner can be stored without
 *   a Portainer instance reference.
 * - Adds runner_id FK to containers and upgrade_history tables.
 * - Adds runner_name to upgrade_history for display purposes.
 *
 * Because SQLite does not support DROP/ALTER COLUMN, the containers table
 * is recreated with the updated schema. All existing rows (Portainer-backed)
 * are preserved.
 *
 * Version: 10
 * Date: 2026-03-01
 */

const logger = require("../../utils/logger");
const { tableExists, columnExists, addColumnIfNotExists, executeSql, createIndexIfNotExists } =
  require("./helpers");

module.exports = {
  version: 10,
  name: "Runner container support",
  up: async () => {
    logger.info("Migration 10: Adding runner container support");

    // ── upgrade_history additions (simple ADD COLUMN, no table recreation) ──
    await addColumnIfNotExists("upgrade_history", "runner_id", "INTEGER REFERENCES runners(id) ON DELETE SET NULL");
    await addColumnIfNotExists("upgrade_history", "runner_name", "TEXT");

    // ── containers table ────────────────────────────────────────────────────
    // Only recreate if runner_id column doesn't exist yet.
    if (await columnExists("containers", "runner_id")) {
      logger.info("Migration 10: containers.runner_id already exists, skipping recreation");
      return;
    }

    // Step 1: Create new table with updated schema.
    // portainer_instance_id is now nullable (was NOT NULL).
    // runner_id is a new nullable FK to the runners table.
    await executeSql(`
      CREATE TABLE IF NOT EXISTS containers_v10 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER,
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
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )
    `);

    // Step 2: Copy all existing data (all rows are Portainer-backed, runner_id = NULL).
    await executeSql(`
      INSERT INTO containers_v10 (
        id, user_id, portainer_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      )
      SELECT
        id, user_id, portainer_instance_id, NULL,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      FROM containers
    `);

    // Step 3: Drop old table and rename new one.
    await executeSql("DROP TABLE containers");
    await executeSql("ALTER TABLE containers_v10 RENAME TO containers");

    // Step 4: Recreate indexes.
    await createIndexIfNotExists("idx_containers_user_id", "containers", "user_id");
    await createIndexIfNotExists("idx_containers_instance", "containers", "portainer_instance_id");
    await createIndexIfNotExists("idx_containers_runner_id", "containers", "runner_id");
    await createIndexIfNotExists("idx_containers_deployed_image", "containers", "deployed_image_id");
    await createIndexIfNotExists("idx_containers_image_repo", "containers", "image_repo");
    await createIndexIfNotExists("idx_containers_last_seen", "containers", "last_seen");

    logger.info("Migration 10: Runner container support applied successfully");
  },
};
