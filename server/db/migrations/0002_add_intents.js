/**
 * Migration 2: Add Intents Tables
 *
 * Creates the intent system tables for declarative container upgrade policies:
 * - intents: policy definitions with match criteria and schedule
 * - intent_executions: one row per execution cycle
 * - intent_execution_containers: per-container detail within an execution
 * Also adds intent_id column to existing upgrade_history table.
 *
 * Version: 2
 * Date: 2026-02-20
 */

const logger = require("../../utils/logger");
const {
  addColumnIfNotExists,
  tableExists,
  createIndexIfNotExists,
  executeSql,
} = require("./helpers");

module.exports = {
  version: 2,
  name: "Add intents tables",
  up: async () => {
    logger.info("Migration 2: Creating intents tables");

    // 1. Create intents table
    if (!(await tableExists("intents"))) {
      await executeSql(`
        CREATE TABLE intents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          match_containers TEXT,
          match_images TEXT,
          match_instances TEXT,
          match_stacks TEXT,
          match_registries TEXT,
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
      logger.info("Created intents table");
    }

    // 2. Create intent_executions table
    if (!(await tableExists("intent_executions"))) {
      await executeSql(`
        CREATE TABLE intent_executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          intent_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          trigger_type TEXT NOT NULL,
          containers_matched INTEGER DEFAULT 0,
          containers_upgraded INTEGER DEFAULT 0,
          containers_failed INTEGER DEFAULT 0,
          containers_skipped INTEGER DEFAULT 0,
          error_message TEXT,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          duration_ms INTEGER,
          FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      logger.info("Created intent_executions table");
    }

    // 3. Create intent_execution_containers table
    if (!(await tableExists("intent_execution_containers"))) {
      await executeSql(`
        CREATE TABLE intent_execution_containers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id INTEGER NOT NULL,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          image_name TEXT NOT NULL,
          portainer_instance_id INTEGER,
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
      logger.info("Created intent_execution_containers table");
    }

    // 4. Add intent_id to upgrade_history
    await addColumnIfNotExists("upgrade_history", "intent_id", "INTEGER");

    // 5. Create indexes
    await createIndexIfNotExists("idx_intents_user_id", "intents", "user_id");
    await createIndexIfNotExists("idx_intents_enabled", "intents", "user_id, enabled");
    await createIndexIfNotExists(
      "idx_intent_executions_intent_id",
      "intent_executions",
      "intent_id"
    );
    await createIndexIfNotExists("idx_intent_executions_user_id", "intent_executions", "user_id");
    await createIndexIfNotExists(
      "idx_intent_executions_status",
      "intent_executions",
      "intent_id, status"
    );
    await createIndexIfNotExists(
      "idx_intent_exec_containers_execution_id",
      "intent_execution_containers",
      "execution_id"
    );
    await createIndexIfNotExists("idx_upgrade_history_intent_id", "upgrade_history", "intent_id");

    logger.info("Migration 2: Intents tables created successfully");
  },
};
