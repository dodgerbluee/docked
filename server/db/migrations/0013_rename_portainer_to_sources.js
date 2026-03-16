/**
 * Migration 13: Rename Portainer to Sources
 *
 * Renames the portainer_instances table to source_instances and updates all
 * foreign key references across containers, upgrade_history, and intent tables.
 *
 * Column renames:
 *   containers.portainer_instance_id       -> source_instance_id
 *   upgrade_history.portainer_instance_id   -> source_instance_id
 *   upgrade_history.portainer_instance_name -> source_instance_name
 *   upgrade_history.portainer_url           -> source_url
 *   intent_execution_containers.portainer_instance_id -> source_instance_id
 *
 * Adds runner_id column to intent_execution_containers for runner-backed
 * container upgrades.
 *
 * Renames intents.match_instances -> match_sources to support typed source IDs
 * (e.g., "portainer:5", "runner:3").
 *
 * Also adds exclude_containers and exclude_registries columns that were defined
 * in code but missing from the DB migration (they exist via addColumnIfNotExists
 * in migration 2 implicitly).
 *
 * Because SQLite does not support ALTER COLUMN / RENAME COLUMN (pre-3.25),
 * affected tables are recreated using the established create-copy-drop-rename
 * pattern.
 *
 * Version: 13
 * Date: 2026-03-02
 */

const logger = require("../../utils/logger");
const {
  tableExists,
  columnExists,
  executeSql,
  createIndexIfNotExists,
} = require("./helpers");

module.exports = {
  version: 13,
  name: "Rename portainer to sources",
  // eslint-disable-next-line max-lines-per-function -- Migration requires comprehensive table recreation
  up: async () => {
    logger.info("Migration 13: Renaming portainer_instances to source_instances");

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Rename portainer_instances -> source_instances
    // ═══════════════════════════════════════════════════════════════════════
    if (await tableExists("portainer_instances")) {
      await executeSql(`
        CREATE TABLE IF NOT EXISTS source_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          username TEXT DEFAULT '',
          password TEXT DEFAULT '',
          api_key TEXT,
          auth_type TEXT DEFAULT 'password',
          ip_address TEXT,
          display_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, url)
        )
      `);

      await executeSql(`
        INSERT INTO source_instances (
          id, user_id, name, url, username, password, api_key, auth_type,
          ip_address, display_order, created_at, updated_at
        )
        SELECT
          id, user_id, name, url, username, password, api_key, auth_type,
          ip_address, display_order, created_at, updated_at
        FROM portainer_instances
      `);

      await executeSql("DROP TABLE portainer_instances");

      await createIndexIfNotExists("idx_source_user_id", "source_instances", "user_id");
      await createIndexIfNotExists("idx_source_url", "source_instances", "user_id, url");
      await createIndexIfNotExists(
        "idx_source_display_order",
        "source_instances",
        "user_id, display_order"
      );

      logger.info("Migration 13: Renamed portainer_instances to source_instances");
    } else if (!(await tableExists("source_instances"))) {
      logger.warn("Migration 13: Neither portainer_instances nor source_instances exists");
    } else {
      logger.info("Migration 13: source_instances already exists, skipping table rename");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Recreate containers table with renamed FK column
    //    portainer_instance_id -> source_instance_id
    // ═══════════════════════════════════════════════════════════════════════
    if (await columnExists("containers", "portainer_instance_id")) {
      await executeSql(`
        CREATE TABLE IF NOT EXISTS containers_v13 (
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

      await executeSql(`
        INSERT INTO containers_v13 (
          id, user_id, source_instance_id, runner_id,
          container_id, container_name, endpoint_id,
          image_name, image_repo, status, state, stack_name,
          deployed_image_id, uses_network_mode, provides_network,
          last_seen, created_at, updated_at
        )
        SELECT
          id, user_id, portainer_instance_id, runner_id,
          container_id, container_name, endpoint_id,
          image_name, image_repo, status, state, stack_name,
          deployed_image_id, uses_network_mode, provides_network,
          last_seen, created_at, updated_at
        FROM containers
      `);

      await executeSql("DROP TABLE containers");
      await executeSql("ALTER TABLE containers_v13 RENAME TO containers");

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

      logger.info("Migration 13: Containers table updated (portainer_instance_id -> source_instance_id)");
    } else {
      logger.info("Migration 13: containers.portainer_instance_id already renamed, skipping");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Recreate upgrade_history table with renamed columns
    //    portainer_instance_id   -> source_instance_id
    //    portainer_instance_name -> source_instance_name
    //    portainer_url           -> source_url
    // ═══════════════════════════════════════════════════════════════════════
    if (await columnExists("upgrade_history", "portainer_instance_id")) {
      await executeSql(`
        CREATE TABLE IF NOT EXISTS upgrade_history_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          source_instance_id INTEGER,
          source_instance_name TEXT,
          runner_id INTEGER,
          runner_name TEXT,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          endpoint_id TEXT,
          source_url TEXT,
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
          FOREIGN KEY (source_instance_id) REFERENCES source_instances(id) ON DELETE SET NULL,
          FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE SET NULL
        )
      `);

      await executeSql(`
        INSERT INTO upgrade_history_v13 (
          id, user_id, source_instance_id, source_instance_name,
          runner_id, runner_name,
          container_id, container_name, endpoint_id, source_url,
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

      await executeSql("DROP TABLE upgrade_history");
      await executeSql("ALTER TABLE upgrade_history_v13 RENAME TO upgrade_history");

      await createIndexIfNotExists("idx_upgrade_history_user_id", "upgrade_history", "user_id");
      await createIndexIfNotExists(
        "idx_upgrade_history_created_at",
        "upgrade_history",
        "created_at"
      );
      await createIndexIfNotExists(
        "idx_upgrade_history_container_name",
        "upgrade_history",
        "container_name"
      );
      await createIndexIfNotExists(
        "idx_upgrade_history_intent_id",
        "upgrade_history",
        "intent_id"
      );

      logger.info("Migration 13: upgrade_history columns renamed (portainer -> source)");
    } else {
      logger.info("Migration 13: upgrade_history already renamed, skipping");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Recreate intent_execution_containers table
    //    portainer_instance_id -> source_instance_id
    //    Add runner_id column
    // ═══════════════════════════════════════════════════════════════════════
    if (await columnExists("intent_execution_containers", "portainer_instance_id")) {
      await executeSql(`
        CREATE TABLE IF NOT EXISTS intent_execution_containers_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id INTEGER NOT NULL,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          image_name TEXT NOT NULL,
          source_instance_id INTEGER,
          runner_id INTEGER,
          status TEXT NOT NULL,
          old_image TEXT,
          new_image TEXT,
          old_digest TEXT,
          new_digest TEXT,
          error_message TEXT,
          duration_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES intent_executions(id) ON DELETE CASCADE
        )
      `);

      await executeSql(`
        INSERT INTO intent_execution_containers_v13 (
          id, execution_id, container_id, container_name, image_name,
          source_instance_id, runner_id, status,
          old_image, new_image, old_digest, new_digest,
          error_message, duration_ms, created_at
        )
        SELECT
          id, execution_id, container_id, container_name, image_name,
          portainer_instance_id, NULL, status,
          old_image, new_image, old_digest, new_digest,
          error_message, duration_ms, created_at
        FROM intent_execution_containers
      `);

      await executeSql("DROP TABLE intent_execution_containers");
      await executeSql(
        "ALTER TABLE intent_execution_containers_v13 RENAME TO intent_execution_containers"
      );

      await createIndexIfNotExists(
        "idx_intent_exec_containers_execution_id",
        "intent_execution_containers",
        "execution_id"
      );

      logger.info(
        "Migration 13: intent_execution_containers updated (portainer_instance_id -> source_instance_id, added runner_id)"
      );
    } else {
      logger.info("Migration 13: intent_execution_containers already updated, skipping");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. Recreate intents table: rename match_instances -> match_sources
    // ═══════════════════════════════════════════════════════════════════════
    if (await columnExists("intents", "match_instances")) {
      await executeSql(`
        CREATE TABLE IF NOT EXISTS intents_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          match_containers TEXT,
          match_images TEXT,
          match_sources TEXT,
          match_stacks TEXT,
          match_registries TEXT,
          exclude_containers TEXT,
          exclude_images TEXT,
          exclude_stacks TEXT,
          exclude_registries TEXT,
          schedule_type TEXT NOT NULL DEFAULT 'immediate',
          schedule_cron TEXT,
          max_concurrent INTEGER NOT NULL DEFAULT 1,
          dry_run INTEGER NOT NULL DEFAULT 0,
          sequential_delay_sec INTEGER NOT NULL DEFAULT 30,
          last_evaluated_at DATETIME,
          last_execution_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Migrate data: convert old match_instances (plain numeric IDs) to typed
      // source IDs with "portainer:" prefix. E.g., [1,5] -> ["portainer:1","portainer:5"]
      await executeSql(`
        INSERT INTO intents_v13 (
          id, user_id, name, description, enabled,
          match_containers, match_images, match_sources, match_stacks, match_registries,
          exclude_containers, exclude_images, exclude_stacks, exclude_registries,
          schedule_type, schedule_cron, max_concurrent, dry_run, sequential_delay_sec,
          last_evaluated_at, last_execution_id, created_at, updated_at
        )
        SELECT
          id, user_id, name, description, enabled,
          match_containers, match_images,
          CASE
            WHEN match_instances IS NOT NULL AND match_instances != '[]' AND match_instances != 'null'
            THEN replace(replace(replace(match_instances, '[', '["portainer:'), ',', '","portainer:'), ']', '"]')
            ELSE match_instances
          END,
          match_stacks, match_registries,
          exclude_containers, exclude_images, exclude_stacks, exclude_registries,
          schedule_type, schedule_cron, max_concurrent, dry_run, sequential_delay_sec,
          last_evaluated_at, last_execution_id, created_at, updated_at
        FROM intents
      `);

      await executeSql("DROP TABLE intents");
      await executeSql("ALTER TABLE intents_v13 RENAME TO intents");

      await createIndexIfNotExists("idx_intents_user_id", "intents", "user_id");
      await createIndexIfNotExists("idx_intents_enabled", "intents", "user_id, enabled");

      logger.info("Migration 13: intents table updated (match_instances -> match_sources)");
    } else {
      logger.info("Migration 13: intents.match_instances already renamed, skipping");
    }

    logger.info("Migration 13: Portainer to Sources rename complete");
  },
};
