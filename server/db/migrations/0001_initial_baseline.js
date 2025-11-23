/**
 * Migration 1: Initial Schema Baseline
 * 
 * This migration establishes the baseline version for the current schema.
 * The actual schema is created in initializeDatabase() before migrations run.
 * All future schema changes should be added as new migrations.
 * 
 * Version: 1
 * Date: 2025-01-27
 */

const logger = require("../../utils/logger");

module.exports = {
  version: 1,
  name: "Initial schema baseline",
  up: async () => {
    // Schema is created in initializeDatabase() before migrations run
    // This migration just marks version 1 as applied to establish baseline
    logger.info("Migration 1: Initial schema baseline (schema created in initializeDatabase)");
  },
};

