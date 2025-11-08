/**
 * Container Controller
 * Handles HTTP requests for container operations
 */

const containerService = require('../services/containerService');
const portainerService = require('../services/portainerService');
const {
  validateRequiredFields,
  isValidContainerId,
  validateContainerArray,
} = require('../utils/validation');
const { RateLimitExceededError } = require('../utils/retry');

/**
 * Get all containers with update status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getContainers(req, res, next) {
  try {
    // Check if we should fetch from Portainer only (no Docker Hub)
    const portainerOnly = req.query.portainerOnly === 'true';
    
    if (portainerOnly) {
      // Fetch from Portainer without Docker Hub checks
      const result = await containerService.getContainersFromPortainer();
      res.json(result);
      return;
    }

    // Always use cached data unless explicitly requested to refresh
    // If no cache exists, automatically fetch from Portainer only (no Docker Hub)
    const cached = await containerService.getAllContainersWithUpdates(false);
    
    // If cache is empty or has no containers, fetch from Portainer only
    if (!cached || !cached.containers || cached.containers.length === 0) {
      console.log('📦 No cached data found, automatically fetching from Portainer (no Docker Hub checks)...');
      const portainerResult = await containerService.getContainersFromPortainer();
      // Don't cache this result - user must click "Pull" to cache with Docker Hub data
      res.json(portainerResult);
      return;
    }
    
    // Return cached data
    res.json(cached);
  } catch (error) {
    // If there's an error, try fetching from Portainer only as fallback
    console.error('Error getting containers:', error);
    try {
      const portainerResult = await containerService.getContainersFromPortainer();
      res.json(portainerResult);
    } catch (portainerError) {
      console.error('Error fetching from Portainer:', portainerError);
      res.json({
        grouped: true,
        stacks: [],
        containers: [],
        portainerInstances: [],
        unusedImagesCount: 0,
      });
    }
  }
}

/**
 * Pull fresh container data from Docker Hub
 * Clears cache and fetches fresh data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function pullContainers(req, res, next) {
  try {
    console.log('🔄 Pull request received - clearing cache and fetching fresh data...');
    // Force refresh - clears cache and fetches fresh data
    const result = await containerService.getAllContainersWithUpdates(true);
    console.log('✅ Pull completed successfully');
    res.json({
      success: true,
      message: 'Container data pulled successfully',
      ...result,
    });
  } catch (error) {
    // Handle rate limit exceeded errors specially
    if (error.isRateLimitExceeded || error instanceof RateLimitExceededError) {
      console.error('❌ Docker Hub rate limit exceeded - stopping pull operation');
      return res.status(429).json({
        success: false,
        error: error.message || 'Docker Hub rate limit exceeded',
        rateLimitExceeded: true,
        message: 'Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.',
      });
    }
    
    console.error('❌ Error in pullContainers:', error);
    // Return a more detailed error response
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pull container data',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}


/**
 * Upgrade a single container
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function upgradeContainer(req, res, next) {
  try {
    const { containerId } = req.params;
    const { endpointId, imageName, portainerUrl } = req.body;

    // Validate input
    if (!isValidContainerId(containerId)) {
      return res.status(400).json({ error: 'Invalid container ID' });
    }

    const validationError = validateRequiredFields(
      { endpointId, imageName, portainerUrl },
      ['endpointId', 'imageName', 'portainerUrl']
    );
    if (validationError) {
      return res.status(400).json(validationError);
    }

    await portainerService.authenticatePortainer(portainerUrl);
    const result = await containerService.upgradeSingleContainer(
      portainerUrl,
      endpointId,
      containerId,
      imageName
    );

    res.json({
      success: true,
      message: 'Container upgraded successfully',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Batch upgrade multiple containers
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function batchUpgradeContainers(req, res, next) {
  try {
    const { containers } = req.body;

    // Validate input
    const validationError = validateContainerArray(containers);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Upgrade containers sequentially to avoid conflicts
    const results = [];
    const errors = [];

    for (const container of containers) {
      try {
        await portainerService.authenticatePortainer(container.portainerUrl);
        const result = await containerService.upgradeSingleContainer(
          container.portainerUrl,
          container.endpointId,
          container.containerId,
          container.imageName
        );
        results.push(result);
      } catch (error) {
        console.error(
          `Error upgrading container ${container.containerId}:`,
          error
        );
        errors.push({
          containerId: container.containerId,
          containerName: container.containerName || 'Unknown',
          error: error.message,
        });
      }
    }

    res.json({
      success: errors.length === 0,
      message: `Upgraded ${results.length} container(s), ${errors.length} error(s)`,
      results: results,
      errors: errors,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Clear container cache
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearCache(req, res, next) {
  try {
    const { clearContainerCache } = require('../db/database');
    await clearContainerCache();
    console.log('🗑️ Container cache cleared');
    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to clear cache',
    });
  }
}

module.exports = {
  getContainers,
  pullContainers,
  clearCache,
  upgradeContainer,
  batchUpgradeContainers,
};

