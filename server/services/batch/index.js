/**
 * Batch System Entry Point
 * Initializes and exports the batch manager with all registered job handlers
 */

const BatchManager = require("./BatchManager");
const DockerHubPullHandler = require("./handlers/DockerHubPullHandler");
const TrackedAppsCheckHandler = require("./handlers/TrackedAppsCheckHandler");

// Create singleton batch manager instance
const batchManager = new BatchManager();

// Register all job handlers
batchManager.registerHandler(new DockerHubPullHandler());
batchManager.registerHandler(new TrackedAppsCheckHandler());

/**
 * Start the batch system
 */
async function start() {
  try {
    await batchManager.start();
  } catch (err) {
    console.error("❌ Failed to start batch system:", err);
    throw err;
  }
}

/**
 * Stop the batch system
 */
function stop() {
  batchManager.stop();
}

/**
 * Execute a specific job manually (for API endpoints)
 * @param {string} jobType - The type of the job to execute.
 * @param {boolean} isManual - Whether this run was manually triggered (default: false)
 */
async function executeJob(jobType, isManual = false) {
  return await batchManager.executeJob(jobType, isManual);
}

/**
 * Get batch system status
 */
function getStatus() {
  return batchManager.getStatus();
}

/**
 * Get registered job types
 */
function getRegisteredJobTypes() {
  return batchManager.getRegisteredJobTypes();
}

/**
 * Get handler for a job type
 */
function getHandler(jobType) {
  return batchManager.getHandler(jobType);
}

module.exports = {
  start,
  stop,
  executeJob,
  getStatus,
  getRegisteredJobTypes,
  getHandler,
  batchManager, // Export for testing
};
