/**
 * Migration 9: Add version tracking columns to runners table
 *
 * Adds version, latest_version, and version_checked_at columns to support
 * Tier 1 version tracking: comparing the running dockhand binary version
 * against the latest GitHub release.
 *
 * Version: 9
 * Date: 2026-02-27
 */

const logger = require("../../utils/logger");
const { addColumnIfNotExists } = require("./helpers");

module.exports = {
  version: 9,
  name: "Add runner version tracking columns",
  up: async () => {
    logger.info("Migration 9: Adding version tracking columns to runners table");

    await addColumnIfNotExists("runners", "version", "TEXT");
    await addColumnIfNotExists("runners", "latest_version", "TEXT");
    await addColumnIfNotExists("runners", "version_checked_at", "TEXT");

    logger.info("Migration 9: Runner version tracking columns added successfully");
  },
};
