/**
 * Migration 3: Add OAuth Support
 *
 * Adds OAuth/OpenID Connect support to the authentication system:
 * - Adds oauth_provider and oauth_provider_id columns to users table
 * - Creates oauth_states table for CSRF (state) and PKCE (code_verifier) storage
 *
 * Note: password_hash NOT NULL constraint is fixed in migration 4 which
 * rebuilds the users table with password_hash as nullable (TEXT instead
 * of TEXT NOT NULL), required for OAuth-only users.
 *
 * Version: 3
 * Date: 2026-02-22
 */

const logger = require("../../utils/logger");
const {
  addColumnIfNotExists,
  tableExists,
  createIndexIfNotExists,
  executeSql,
} = require("./helpers");

module.exports = {
  version: 3,
  name: "Add OAuth support",
  up: async () => {
    logger.info("Migration 3: Adding OAuth support");

    // 1. Add OAuth columns to users table
    await addColumnIfNotExists("users", "oauth_provider", "TEXT");
    await addColumnIfNotExists("users", "oauth_provider_id", "TEXT");

    // 2. Create unique index on (oauth_provider, oauth_provider_id)
    // Only applies when both are non-null (SQLite ignores NULLs in unique indexes)
    await createIndexIfNotExists(
      "idx_users_oauth_provider_id",
      "users",
      "oauth_provider, oauth_provider_id",
      true
    );

    // 3. Create oauth_states table for CSRF/PKCE ephemeral storage
    if (!(await tableExists("oauth_states"))) {
      await executeSql(`
        CREATE TABLE oauth_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          state TEXT UNIQUE NOT NULL,
          code_verifier TEXT NOT NULL,
          nonce TEXT NOT NULL,
          redirect_uri TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logger.info("Created oauth_states table");
    }

    // 4. Create indexes for oauth_states
    await createIndexIfNotExists("idx_oauth_states_state", "oauth_states", "state", true);
    await createIndexIfNotExists("idx_oauth_states_created_at", "oauth_states", "created_at");

    logger.info("Migration 3: OAuth support added successfully");
  },
};
