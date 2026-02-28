/**
 * Migration 7: Add Runners Table
 *
 * Creates the runners table for managing docked-runner instances.
 * Runners are lightweight agents that manage Docker containers directly
 * without requiring Portainer.
 *
 * Version: 7
 * Date: 2026-02-26
 */

const logger = require("../../utils/logger");
const { tableExists, executeSql, createIndexIfNotExists } = require("./helpers");

module.exports = {
  version: 7,
  name: "Add runners table",
  up: async () => {
    logger.info("Migration 7: Creating runners table");

    if (!(await tableExists("runners"))) {
      await executeSql(`
        CREATE TABLE runners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          api_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      logger.info("Migration 7: Created runners table");
    }

    await createIndexIfNotExists("idx_runners_user_id", "runners", "user_id");

    logger.info("Migration 7: Runners table created successfully");
  },
};
