/**
 * Migration 4: Add OAuth Providers Table
 *
 * Adds database-backed OAuth/SSO provider configuration:
 * - Creates oauth_providers table for runtime provider management
 * - Adds provider_name column to oauth_states for multi-provider callback routing
 *
 * Note: password_hash nullable fix is handled separately in migration 5.
 *
 * Version: 4
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
  version: 4,
  name: "Add OAuth providers table",
  up: async () => {
    logger.info("Migration 4: Adding OAuth providers table");

    // 1. Create oauth_providers table
    if (!(await tableExists("oauth_providers"))) {
      await executeSql(`
        CREATE TABLE oauth_providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          client_id TEXT NOT NULL,
          client_secret TEXT NOT NULL,
          issuer_url TEXT NOT NULL,
          scopes TEXT DEFAULT 'openid,profile,email',
          auto_register INTEGER DEFAULT 1,
          default_role TEXT DEFAULT 'Administrator',
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logger.info("Created oauth_providers table");
    }

    // 2. Create indexes on oauth_providers
    await createIndexIfNotExists("idx_oauth_providers_name", "oauth_providers", "name", true);
    await createIndexIfNotExists("idx_oauth_providers_enabled", "oauth_providers", "enabled");

    // 3. Add provider_name column to oauth_states for multi-provider routing
    await addColumnIfNotExists("oauth_states", "provider_name", "TEXT");

    logger.info("Migration 4: OAuth providers table added successfully");
  },
};
