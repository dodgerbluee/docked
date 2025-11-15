/**
 * Batch Controller
 * Handles HTTP requests for batch configuration and logs
 * Uses: Repositories, ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const batchSystem = require('../services/batch');
const { setLogLevel: setBatchLogLevel, getLogLevel: getBatchLogLevel } = require('../services/batch/Logger');
const { setLogLevel, getLogLevel } = require('../utils/logLevel');
const { sendSuccess, sendCreated } = require('../utils/responseHelper');
const { ValidationError, NotFoundError } = require('../domain/errors');
const logger = require('../utils/logger');

// Resolve dependencies from container
const batchConfigRepository = container.resolve('batchConfigRepository');
const batchRunRepository = container.resolve('batchRunRepository');

/**
 * Get batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchConfigHandler(req, res, next) {
  try {
    const configs = await batchConfigRepository.findAll();
    sendSuccess(res, { config: configs });
  } catch (error) {
    next(error);
  }
}

/**
 * Update batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateBatchConfigHandler(req, res, next) {
  try {
    const { jobType, enabled, intervalMinutes } = req.body;

    // Validate required fields
    if (!jobType || typeof jobType !== "string") {
      throw new ValidationError("jobType is required and must be a string", 'jobType', jobType);
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      throw new ValidationError(
        `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(', ')}`,
        'jobType',
        jobType
      );
    }

    // Validate with handler if available
    const handler = batchSystem.getHandler(jobType);
    if (handler) {
      const validation = handler.validateConfig({ enabled, intervalMinutes });
      if (!validation.valid) {
        throw new ValidationError(
          validation.error || 'Invalid configuration',
          'config'
        );
      }
    }

    if (typeof enabled !== "boolean") {
      throw new ValidationError("enabled must be a boolean", 'enabled', enabled);
    }

    if (typeof intervalMinutes !== "number" || intervalMinutes < 1 || intervalMinutes > 1440) {
      throw new ValidationError("intervalMinutes must be a number between 1 and 1440", 'intervalMinutes', intervalMinutes);
    }

    await batchConfigRepository.update(jobType, enabled, intervalMinutes);
    const updatedConfigs = await batchConfigRepository.findAll();
    
    sendSuccess(res, {
      config: updatedConfigs,
      message: "Batch configuration updated successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createBatchRunHandler(req, res, next) {
  try {
    const { status = 'running', jobType = 'docker-hub-pull', isManual = false } = req.body;
    const runId = await batchRunRepository.create({ status, jobType, isManual });
    sendCreated(res, { runId });
  } catch (error) {
    next(error);
  }
}

/**
 * Update a batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateBatchRunHandler(req, res, next) {
  try {
    const runId = parseInt(req.params.id);
    if (isNaN(runId)) {
      throw new ValidationError('Invalid run ID', 'id', req.params.id);
    }

    const { status, containersChecked, containersUpdated, errorMessage, logs } = req.body;
    
    await batchRunRepository.update(runId, {
      status,
      containersChecked: containersChecked || 0,
      containersUpdated: containersUpdated || 0,
      errorMessage: errorMessage || null,
      logs: logs || null,
    });

    sendSuccess(res, { message: 'Batch run updated successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Get latest batch run
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getLatestBatchRunHandler(req, res, next) {
  try {
    // Check if we want latest runs by job type
    const byJobType = req.query.byJobType === "true";

    logger.debug("Fetching latest batch run", {
      module: "batchController",
      operation: "getLatestBatchRunHandler",
      byJobType: byJobType,
      purpose: byJobType
        ? 'Frontend polling to check for batch job completions (updates "Last scanned" timestamps)'
        : "Fetching single latest batch run",
    });

    if (byJobType) {
      // Get latest runs for each job type
      const jobTypes = ['docker-hub-pull', 'tracked-apps-check'];
      const latestRuns = {};
      for (const jobType of jobTypes) {
        const run = await batchRunRepository.findLatestByJobType(jobType);
        if (run) {
          latestRuns[jobType] = run;
        }
      }
      
      logger.debug('Latest batch runs by job type retrieved', {
        module: 'batchController',
        operation: 'getLatestBatchRunHandler',
        jobTypes: Object.keys(latestRuns || {}),
        runCount: Object.keys(latestRuns || {}).length,
      });
      
      sendSuccess(res, { runs: latestRuns });
    } else {
      const latestRun = await batchRunRepository.findLatest();
      
      logger.debug('Latest batch run retrieved', {
        module: 'batchController',
        operation: 'getLatestBatchRunHandler',
        runId: latestRun?.id,
        jobType: latestRun?.job_type,
        status: latestRun?.status,
      });
      
      sendSuccess(res, { run: latestRun });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Get recent batch runs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getRecentBatchRunsHandler(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const runs = await batchRunRepository.findRecent(limit);
    sendSuccess(res, { runs });
  } catch (error) {
    next(error);
  }
}

/**
 * Get batch run by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchRunByIdHandler(req, res, next) {
  try {
    const runId = parseInt(req.params.id);
    if (isNaN(runId)) {
      throw new ValidationError('Invalid run ID', 'id', req.params.id);
    }

    const run = await batchRunRepository.findById(runId);
    if (!run) {
      throw new NotFoundError('Batch run');
    }

    sendSuccess(res, { run });
  } catch (error) {
    next(error);
  }
}

/**
 * Trigger a batch job manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function triggerBatchJobHandler(req, res, next) {
  try {
    const { jobType } = req.body;

    if (!jobType || typeof jobType !== 'string') {
      throw new ValidationError('jobType is required and must be a string', 'jobType', jobType);
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      throw new ValidationError(
        `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(', ')}`,
        'jobType',
        jobType
      );
    }

    // Execute the job (don't await - let it run in background)
    // Pass isManual=true to mark this as a manually triggered run
    batchSystem
      .executeJob(jobType, true)
      .then((result) => {
        logger.info(`✅ Manually triggered job ${jobType} completed:`, result);
      })
      .catch((err) => {
        logger.error(`❌ Manually triggered job ${jobType} failed:`, err);
      });

    sendSuccess(res, {
      message: `Job ${jobType} triggered successfully. Check batch logs for execution details.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get batch system status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchStatusHandler(req, res, next) {
  try {
    const status = batchSystem.getStatus();
    sendSuccess(res, { status });
  } catch (error) {
    next(error);
  }
}

/**
 * Get log level
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getLogLevelHandler(req, res, next) {
  try {
    // Use DB-backed log level (persists across restarts)
    const level = await getLogLevel();
    sendSuccess(res, { logLevel: level });
  } catch (error) {
    next(error);
  }
}

/**
 * Set log level
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function setLogLevelHandler(req, res, next) {
  try {
    const { logLevel } = req.body;

    if (!logLevel || (logLevel !== 'info' && logLevel !== 'debug')) {
      throw new ValidationError('logLevel must be "info" or "debug"', 'logLevel', logLevel);
    }

    // Use DB-backed log level (persists across restarts)
    await setLogLevel(logLevel);

    // Also update the logger's cached level
    logger.updateLevel();
    
    sendSuccess(res, {
      logLevel,
      message: `Log level set to ${logLevel}`,
    });
  } catch (error) {
    next(error);
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
