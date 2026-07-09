/**
 * Migration 16: Add runner online_status column
 *
 * Tracks whether each runner is considered online or offline based on
 * heartbeat staleness. Used by the runner health checker to persist
 * state transitions and send Discord notifications only on change.
 *
 * Version: 16
 * Date: 2026-05-15
 */

const logger = require("../../utils/logger");
const { addColumnIfNotExists } = require("./helpers");

module.exports = {
  version: 16,
  name: "Add runner online_status column",
  up: async () => {
    logger.info("Migration 16: Adding runner online_status column");

    await addColumnIfNotExists("runners", "online_status", "TEXT DEFAULT 'online'");

    logger.info("Migration 16: Runner online_status column ready");
  },
};
