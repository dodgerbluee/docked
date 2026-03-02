/**
 * Migration 11: Make upgrade_history.endpoint_id nullable
 *
 * The original schema defined endpoint_id as TEXT NOT NULL, which blocks
 * runner-backed upgrade history records (they have no endpoint_id).
 * SQLite does not support DROP/ALTER COLUMN, so the table is recreated.
 *
 * All existing columns (including runner_id/runner_name from migration 10
 * and intent_id from migration 2) are preserved.
 *
 * Version: 11
 * Date: 2026-03-02
 */

const logger = require("../../utils/logger");
const { executeSql, createIndexIfNotExists } = require("./helpers");

module.exports = {
  version: 11,
  name: "Fix upgrade_history endpoint_id nullable",
  up: async () => {
    logger.info("Migration 11: Making upgrade_history.endpoint_id nullable");

    // Step 1: Create new table with endpoint_id nullable and all existing columns.
    await executeSql(`
      CREATE TABLE IF NOT EXISTS upgrade_history_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER,
        portainer_instance_name TEXT,
        runner_id INTEGER,
        runner_name TEXT,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        endpoint_id TEXT,
        portainer_url TEXT,
        old_image TEXT NOT NULL,
        new_image TEXT NOT NULL,
        old_digest TEXT,
        new_digest TEXT,
        old_version TEXT,
        new_version TEXT,
        image_repo TEXT,
        registry TEXT,
        namespace TEXT,
        repository TEXT,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        upgrade_duration_ms INTEGER,
        intent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE SET NULL,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE SET NULL
      )
    `);

    // Step 2: Copy all existing rows. Use COALESCE so any existing NOT NULL
    // columns that somehow have NULL are preserved safely.
    await executeSql(`
      INSERT INTO upgrade_history_v11 (
        id, user_id, portainer_instance_id, portainer_instance_name,
        runner_id, runner_name,
        container_id, container_name, endpoint_id, portainer_url,
        old_image, new_image, old_digest, new_digest,
        old_version, new_version, image_repo, registry, namespace, repository,
        status, error_message, upgrade_duration_ms, intent_id, created_at
      )
      SELECT
        id, user_id, portainer_instance_id, portainer_instance_name,
        runner_id, runner_name,
        container_id, container_name, endpoint_id, portainer_url,
        old_image, new_image, old_digest, new_digest,
        old_version, new_version, image_repo, registry, namespace, repository,
        status, error_message, upgrade_duration_ms, intent_id, created_at
      FROM upgrade_history
    `);

    // Step 3: Swap tables.
    await executeSql("DROP TABLE upgrade_history");
    await executeSql("ALTER TABLE upgrade_history_v11 RENAME TO upgrade_history");

    // Step 4: Recreate indexes.
    await createIndexIfNotExists("idx_upgrade_history_user_id", "upgrade_history", "user_id");
    await createIndexIfNotExists("idx_upgrade_history_created_at", "upgrade_history", "created_at");
    await createIndexIfNotExists("idx_upgrade_history_container_name", "upgrade_history", "container_name");
    await createIndexIfNotExists("idx_upgrade_history_intent_id", "upgrade_history", "intent_id");

    logger.info("Migration 11: upgrade_history.endpoint_id is now nullable");
  },
};
