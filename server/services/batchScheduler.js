/**
 * @deprecated This file is deprecated. Use server/services/batch/index.js instead.
 *
 * This file is kept for backward compatibility during migration.
 * All new batch system functionality is in server/services/batch/
 *
 * The new batch system provides:
 * - Modular architecture with clear separation of concerns
 * - Extensible job handler interface
 * - Robust scheduler with retries and error handling
 * - Structured logging
 * - Better error recovery
 *
 * Migration: Replace require('./services/batchScheduler') with require('./services/batch')
 */

// Re-export the new batch system for backward compatibility
const batchSystem = require("./batch");

module.exports = {
  startBatchScheduler: () => batchSystem.start(),
  stopBatchScheduler: () => batchSystem.stop(),
  getSchedulerStatus: () => batchSystem.getStatus(),
  // Note: These functions are deprecated and require userId parameter
  // They should not be used directly - use the batch system scheduler instead
  runDockerHubPull: userId => {
    if (!userId) {
      throw new Error("userId is required for runDockerHubPull");
    }
    return batchSystem.executeJob(userId, "docker-hub-pull");
  },
  runTrackedAppsCheck: userId => {
    if (!userId) {
      throw new Error("userId is required for runTrackedAppsCheck");
    }
    return batchSystem.executeJob(userId, "tracked-apps-check");
  },
};
