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
  getRecentBatchRuns,
  getBatchRunById,
} = require('../db/database');

/**
 * Get batch configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getBatchConfigHandler(req, res, next) {
  try {
    const config = await getBatchConfig();
    res.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('Error fetching batch config:', error);
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
    const { enabled, intervalMinutes } = req.body;

    // Validate required fields
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

    await updateBatchConfig(enabled, intervalMinutes);
    
    const updatedConfig = await getBatchConfig();
    
    res.json({
      success: true,
      config: updatedConfig,
      message: 'Batch configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating batch config:', error);
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
    console.error('Error creating batch run:', error);
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
    console.error('Error updating batch run:', error);
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
    const latestRun = await getLatestBatchRun();
    res.json({
      success: true,
      run: latestRun,
    });
  } catch (error) {
    console.error('Error fetching latest batch run:', error);
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
    console.error('Error fetching recent batch runs:', error);
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
    console.error('Error fetching batch run:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch batch run',
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
};

