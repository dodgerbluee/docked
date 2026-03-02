/**
 * Migration 12: Add docker_enabled column to runners
 *
 * Tracks whether Docker management is enabled on a runner (set from the
 * health endpoint's dockerOk field during version polling). NULL means
 * unknown (not yet polled); 1 = enabled; 0 = disabled.
 *
 * When docker_enabled = 0, the server skips fetching containers from that
 * runner to avoid noisy 404 warnings.
 *
 * Version: 12
 * Date: 2026-03-01
 */

const logger = require("../../utils/logger");
const { addColumnIfNotExists } = require("./helpers");

module.exports = {
  version: 12,
  name: "Add runner docker_enabled column",
  up: async () => {
    logger.info("Migration 12: Adding docker_enabled column to runners");
    await addColumnIfNotExists("runners", "docker_enabled", "INTEGER");
    logger.info(
      "Migration 12: docker_enabled column added (NULL = unknown, 1 = enabled, 0 = disabled)"
    );
  },
};
