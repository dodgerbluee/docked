/**
 * Batch System Entry Point
 * Initializes and exports the batch manager with all registered job handlers
 */

// Lazy load batch manager to avoid initialization issues
let batchManager = null;

function getBatchManager() {
  if (!batchManager) {
    const BatchManager = require("./BatchManager");
    batchManager = new BatchManager();
  }
  return batchManager;
}

// Lazy load and register handlers to avoid initialization issues
function registerHandlers() {
  const manager = getBatchManager();
  try {
    const DockerHubPullHandler = require("./handlers/DockerHubPullHandler");
    manager.registerHandler(new DockerHubPullHandler());
  } catch (error) {
    console.error("Error registering DockerHubPullHandler:", error);
  }

  try {
    const TrackedAppsCheckHandler = require("./handlers/TrackedAppsCheckHandler");
    manager.registerHandler(new TrackedAppsCheckHandler());
  } catch (error) {
    console.error("Error registering TrackedAppsCheckHandler:", error);
  }
}

/**
 * Start the batch system
 */
async function start() {
  try {
    // Register handlers before starting
    registerHandlers();
    const manager = getBatchManager();
    await manager.start();
  } catch (err) {
    console.error("❌ Failed to start batch system:", err);
    throw err;
  }
}

/**
 * Stop the batch system
 */
function stop() {
  if (batchManager) {
    batchManager.stop();
  }
}

/**
 * Execute a specific job manually (for API endpoints)
 * @param {string} jobType - The type of the job to execute.
 * @param {boolean} isManual - Whether this run was manually triggered (default: false)
 */
async function executeJob(jobType, isManual = false) {
  const manager = getBatchManager();
  return await manager.executeJob(jobType, isManual);
}

/**
 * Get batch system status
 */
function getStatus() {
  if (!batchManager) {
    return { running: false, handlers: [] };
  }
  return batchManager.getStatus();
}

/**
 * Get registered job types
 */
function getRegisteredJobTypes() {
  if (!batchManager) {
    return [];
  }
  return batchManager.getRegisteredJobTypes();
}

/**
 * Get handler for a job type
 */
function getHandler(jobType) {
  if (!batchManager) {
    return null;
  }
  return batchManager.getHandler(jobType);
}

module.exports = {
  start,
  stop,
  executeJob,
  getStatus,
  getRegisteredJobTypes,
  getHandler,
  get batchManager() { return batchManager; }, // Export for testing
};
