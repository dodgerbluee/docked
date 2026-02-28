/**
 * Migration 8: Add Runner Enrollment Tokens Table
 *
 * Creates the runner_enrollment_tokens table for the automated runner
 * enrollment flow. Tokens are short-lived (10 min), single-use secrets
 * that allow a newly-installed dockhand agent to register itself with
 * the Docked server without manual API-key copy/paste.
 *
 * Version: 8
 * Date: 2026-02-27
 */

const logger = require("../../utils/logger");
const { tableExists, executeSql, createIndexIfNotExists } = require("./helpers");

module.exports = {
  version: 8,
  name: "Add runner enrollment tokens table",
  up: async () => {
    logger.info("Migration 8: Creating runner_enrollment_tokens table");

    if (!(await tableExists("runner_enrollment_tokens"))) {
      await executeSql(`
        CREATE TABLE runner_enrollment_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      logger.info("Migration 8: Created runner_enrollment_tokens table");
    }

    await createIndexIfNotExists("idx_enrollment_token", "runner_enrollment_tokens", "token", true);
    await createIndexIfNotExists("idx_enrollment_user_id", "runner_enrollment_tokens", "user_id");

    logger.info("Migration 8: Runner enrollment tokens table created successfully");
  },
};
