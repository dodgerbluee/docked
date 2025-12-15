/**
 * Batch Controller
 * Handles HTTP requests for batch configuration and logs
 */

const {
  getBatchConfig,
  updateBatchConfig,
  createBatchRun,
  updateBatchRun,
  getLatestBatchRun,
  getLatestBatchRunsByJobType,
  getRecentBatchRuns,
  getBatchRunById,
} = require("../db/index");
const batchSystem = require("../services/batch");
// const {
//   setLogLevel: setBatchLogLevel, // Unused
//   getLogLevel: getBatchLogLevel, // Unused
// } = require("../services/batch/Logger");
const { setLogLevel, getLogLevel } = require("../utils/logLevel");
const logger = require("../utils/logger");

/**
 * Get batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchConfigHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const configs = await getBatchConfig(userId); // Returns all configs for this user
    return res.json({
      success: true,
      config: configs, // Return all configs as an object
    });
  } catch (error) {
    logger.error("Error fetching batch config:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch batch configuration",
    });
  }
}

/**
 * Update batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Complex batch config update logic
async function updateBatchConfigHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { jobType, enabled, intervalMinutes } = req.body;

    // Validate required fields
    if (!jobType || typeof jobType !== "string") {
      return res.status(400).json({
        success: false,
        error: "jobType is required and must be a string",
      });
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(", ")}`,
      });
    }

    // Validate with handler if available
    const handler = batchSystem.getHandler(jobType);
    if (handler) {
      const validation = handler.validateConfig({ enabled, intervalMinutes });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || "Invalid configuration",
        });
      }
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean",
      });
    }

    if (typeof intervalMinutes !== "number" || intervalMinutes < 1 || intervalMinutes > 1440) {
      return res.status(400).json({
        success: false,
        error: "intervalMinutes must be a number between 1 and 1440",
      });
    }

    await updateBatchConfig(userId, jobType, enabled, intervalMinutes);

    const updatedConfigs = await getBatchConfig(userId); // Get all configs for this user

    return res.json({
      success: true,
      config: updatedConfigs,
      message: "Batch configuration updated successfully",
    });
  } catch (error) {
    logger.error("Error updating batch config:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update batch configuration",
    });
  }
}

/**
 * Create a new batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createBatchRunHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { status, jobType } = req.body;
    const runId = await createBatchRun(userId, status || "running", jobType || "docker-hub-pull");
    return res.json({
      success: true,
      runId,
    });
  } catch (error) {
    logger.error("Error creating batch run:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create batch run",
    });
  }
}

/**
 * Update a batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateBatchRunHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const runId = parseInt(req.params.id, 10);
    if (isNaN(runId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid run ID",
      });
    }

    const { status, containersChecked, containersUpdated, errorMessage, logs } = req.body;

    await updateBatchRun(runId, userId, {
      status,
      containersChecked: containersChecked || 0,
      containersUpdated: containersUpdated || 0,
      errorMessage: errorMessage || null,
      logs: logs || null,
    });

    return res.json({
      success: true,
      message: "Batch run updated successfully",
    });
  } catch (error) {
    logger.error("Error updating batch run:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update batch run",
    });
  }
}

/**
 * Get latest batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Complex batch run retrieval logic
async function getLatestBatchRunHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Check if we want latest runs by job type
    const byJobType = req.query.byJobType === "true";

    logger.debug("Fetching latest batch run", {
      module: "batchController",
      operation: "getLatestBatchRunHandler",
      byJobType,
      purpose: byJobType
        ? 'Frontend polling to check for batch job completions (updates "Last scanned" timestamps)'
        : "Fetching single latest batch run",
    });

    if (byJobType) {
      const latestRuns = await getLatestBatchRunsByJobType(userId);

      logger.debug("Latest batch runs by job type retrieved", {
        module: "batchController",
        operation: "getLatestBatchRunHandler",
        jobTypes: Object.keys(latestRuns || {}),
        runCount: Object.keys(latestRuns || {}).length,
      });

      return res.json({
        success: true,
        runs: latestRuns,
      });
    }
    const latestRun = await getLatestBatchRun(userId);

    logger.debug("Latest batch run retrieved", {
      module: "batchController",
      operation: "getLatestBatchRunHandler",
      runId: latestRun?.id,
      jobType: latestRun?.job_type,
      status: latestRun?.status,
    });

    return res.json({
      success: true,
      run: latestRun,
    });
  } catch (error) {
    logger.error("Error fetching latest batch run", {
      module: "batchController",
      operation: "getLatestBatchRunHandler",
      byJobType: req.query.byJobType === "true",
      error,
    });
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch latest batch run",
    });
  }
}

/**
 * Get recent batch runs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getRecentBatchRunsHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const limit = parseInt(req.query.limit, 10) || 50;
    const runs = await getRecentBatchRuns(userId, limit);
    return res.json({
      success: true,
      runs,
    });
  } catch (error) {
    logger.error("Error fetching recent batch runs:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recent batch runs",
    });
  }
}

/**
 * Get batch run by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchRunByIdHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const runId = parseInt(req.params.id, 10);
    if (isNaN(runId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid run ID",
      });
    }

    const run = await getBatchRunById(runId, userId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Batch run not found",
      });
    }

    return res.json({
      success: true,
      run,
    });
  } catch (error) {
    logger.error("Error fetching batch run:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch batch run",
    });
  }
}

/**
 * Trigger a batch job manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function triggerBatchJobHandler(req, res, _next) {
  try {
    const { jobType } = req.body;

    if (!jobType || typeof jobType !== "string") {
      return res.status(400).json({
        success: false,
        error: "jobType is required and must be a string",
      });
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(", ")}`,
      });
    }

    // Get userId from request (should be set by auth middleware)
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    // Execute the job (don't await - let it run in background)
    // Pass isManual=true to mark this as a manually triggered run
    batchSystem
      .executeJob(userId, jobType, true)
      .then((result) => {
        logger.info(`✅ Manually triggered job ${jobType} completed for user ${userId}:`, result);
      })
      .catch((err) => {
        logger.error(`❌ Manually triggered job ${jobType} failed for user ${userId}:`, err);
      });

    return res.json({
      success: true,
      message: `Job ${jobType} triggered successfully. Check batch logs for execution details.`,
    });
  } catch (error) {
    logger.error("Error triggering batch job:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to trigger batch job",
    });
  }
}

/**
 * Get batch system status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function getBatchStatusHandler(req, res, _next) {
  try {
    const status = batchSystem.getStatus();
    return res.json({
      success: true,
      status,
    });
  } catch (error) {
    logger.error("Error fetching batch status:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch batch status",
    });
  }
}

/**
 * Get log level
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getLogLevelHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Use DB-backed log level (persists across restarts) - system-wide
    const level = await getLogLevel();
    return res.json({
      success: true,
      logLevel: level,
    });
  } catch (error) {
    logger.error("Error getting log level:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get log level",
    });
  }
}

/**
 * Set log level
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function setLogLevelHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { logLevel } = req.body;

    if (!logLevel || (logLevel !== "info" && logLevel !== "debug")) {
      return res.status(400).json({
        success: false,
        error: 'logLevel must be "info" or "debug"',
      });
    }

    // Use DB-backed log level (persists across restarts) - system-wide
    await setLogLevel(logLevel);

    // Also update the logger's cached level
    logger.updateLevel();

    return res.json({
      success: true,
      logLevel,
      message: `Log level set to ${logLevel}`,
    });
  } catch (error) {
    logger.error("Error setting log level:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to set log level",
    });
  }
}

module.exports = {
  getBatchConfigHandler,
  updateBatchConfigHandler,
  createBatchRunHandler,
  updateBatchRunHandler,
  getLatestBatchRunHandler,
  getRecentBatchRunsHandler,
  getBatchRunByIdHandler,
  triggerBatchJobHandler,
  getBatchStatusHandler,
  getLogLevelHandler,
  setLogLevelHandler,
};
