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
} = require('../db/database');
const batchSystem = require('../services/batch');
const { setLogLevel: setBatchLogLevel, getLogLevel: getBatchLogLevel } = require('../services/batch/Logger');
const logger = require('../utils/logger');

/**
 * Get batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchConfigHandler(req, res, next) {
  try {
    const configs = await getBatchConfig(); // Returns all configs
    res.json({
      success: true,
      config: configs, // Return all configs as an object
    });
  } catch (error) {
    logger.error('Error fetching batch config:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch batch configuration',
    });
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
    if (!jobType || typeof jobType !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'jobType is required and must be a string',
      });
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(', ')}`,
      });
    }

    // Validate with handler if available
    const handler = batchSystem.getHandler(jobType);
    if (handler) {
      const validation = handler.validateConfig({ enabled, intervalMinutes });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || 'Invalid configuration',
        });
      }
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled must be a boolean',
      });
    }

    if (typeof intervalMinutes !== 'number' || intervalMinutes < 1 || intervalMinutes > 1440) {
      return res.status(400).json({
        success: false,
        error: 'intervalMinutes must be a number between 1 and 1440',
      });
    }

    await updateBatchConfig(jobType, enabled, intervalMinutes);
    
    const updatedConfigs = await getBatchConfig(); // Get all configs
    
    res.json({
      success: true,
      config: updatedConfigs,
      message: 'Batch configuration updated successfully',
    });
  } catch (error) {
    logger.error('Error updating batch config:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update batch configuration',
    });
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
    const { status, jobType } = req.body;
    const runId = await createBatchRun(status || 'running', jobType || 'docker-hub-pull');
    res.json({
      success: true,
      runId,
    });
  } catch (error) {
    logger.error('Error creating batch run:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create batch run',
    });
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
      return res.status(400).json({
        success: false,
        error: 'Invalid run ID',
      });
    }

    const { status, containersChecked, containersUpdated, errorMessage, logs } = req.body;
    
    await updateBatchRun(
      runId,
      status,
      containersChecked || 0,
      containersUpdated || 0,
      errorMessage || null,
      logs || null
    );

    res.json({
      success: true,
      message: 'Batch run updated successfully',
    });
  } catch (error) {
    logger.error('Error updating batch run:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update batch run',
    });
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
    const byJobType = req.query.byJobType === 'true';
    
    logger.debug('Fetching latest batch run', {
      module: 'batchController',
      operation: 'getLatestBatchRunHandler',
      byJobType: byJobType,
      purpose: byJobType 
        ? 'Frontend polling to check for batch job completions (updates "Last scanned" timestamps)'
        : 'Fetching single latest batch run',
    });
    
    if (byJobType) {
      const latestRuns = await getLatestBatchRunsByJobType();
      
      logger.debug('Latest batch runs by job type retrieved', {
        module: 'batchController',
        operation: 'getLatestBatchRunHandler',
        jobTypes: Object.keys(latestRuns || {}),
        runCount: Object.keys(latestRuns || {}).length,
      });
      
      res.json({
        success: true,
        runs: latestRuns,
      });
    } else {
      const latestRun = await getLatestBatchRun();
      
      logger.debug('Latest batch run retrieved', {
        module: 'batchController',
        operation: 'getLatestBatchRunHandler',
        runId: latestRun?.id,
        jobType: latestRun?.job_type,
        status: latestRun?.status,
      });
      
      res.json({
        success: true,
        run: latestRun,
      });
    }
  } catch (error) {
    logger.error('Error fetching latest batch run', {
      module: 'batchController',
      operation: 'getLatestBatchRunHandler',
      byJobType: req.query.byJobType === 'true',
      error: error,
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch latest batch run',
    });
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
    const runs = await getRecentBatchRuns(limit);
    res.json({
      success: true,
      runs,
    });
  } catch (error) {
    logger.error('Error fetching recent batch runs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch recent batch runs',
    });
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
      return res.status(400).json({
        success: false,
        error: 'Invalid run ID',
      });
    }

    const run = await getBatchRunById(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'Batch run not found',
      });
    }

    res.json({
      success: true,
      run,
    });
  } catch (error) {
    logger.error('Error fetching batch run:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch batch run',
    });
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
      return res.status(400).json({
        success: false,
        error: 'jobType is required and must be a string',
      });
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(', ')}`,
      });
    }

    // Execute the job (don't await - let it run in background)
    // Pass isManual=true to mark this as a manually triggered run
    batchSystem.executeJob(jobType, true)
      .then(result => {
        logger.info(`✅ Manually triggered job ${jobType} completed:`, result);
      })
      .catch(err => {
        logger.error(`❌ Manually triggered job ${jobType} failed:`, err);
      });

    res.json({
      success: true,
      message: `Job ${jobType} triggered successfully. Check batch logs for execution details.`,
    });
  } catch (error) {
    logger.error('Error triggering batch job:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger batch job',
    });
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
    res.json({
      success: true,
      status,
    });
  } catch (error) {
    logger.error('Error fetching batch status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch batch status',
    });
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
    const level = getBatchLogLevel();
    res.json({
      success: true,
      logLevel: level,
    });
  } catch (error) {
    logger.error('Error getting log level:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get log level',
    });
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
      return res.status(400).json({
        success: false,
        error: 'logLevel must be "info" or "debug"',
      });
    }

    setBatchLogLevel(logLevel);
    res.json({
      success: true,
      logLevel,
      message: `Log level set to ${logLevel}`,
    });
  } catch (error) {
    logger.error('Error setting log level:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set log level',
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

