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
const { getAllPortainerInstances } = require('../db/database');

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

    // IMPORTANT: Never call Docker Hub here - only return cached data or fetch from Portainer
    // Docker Hub is ONLY called via /api/containers/pull endpoint (manual pull or batch process)
    const cached = await containerService.getAllContainersWithUpdates(false);
    
    // If cache is empty or has no containers, fetch from Portainer only (NO Docker Hub)
    if (!cached || !cached.containers || cached.containers.length === 0) {
      console.log('📦 No cached data found, automatically fetching from Portainer (no Docker Hub checks)...');
      const portainerResult = await containerService.getContainersFromPortainer();
      // Don't cache this result - user must click "Pull" to cache with Docker Hub data
      res.json(portainerResult);
      return;
    }
    
    // Return cached data (may contain Docker Hub info from previous pull, but no new Docker Hub calls)
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
    console.log('🔄 Pull request received - this is the ONLY endpoint that calls Docker Hub...');
    // Force refresh - this is the ONLY place that should call Docker Hub
    // Called by: 1) Manual "Pull from Docker Hub" button, 2) Batch process
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

    // Get instance credentials from database
    const instances = await getAllPortainerInstances();
    const instance = instances.find(inst => inst.url === portainerUrl);
    if (!instance) {
      return res.status(404).json({ error: 'Portainer instance not found' });
    }

    await portainerService.authenticatePortainer(
      portainerUrl,
      instance.username,
      instance.password,
      instance.api_key,
      instance.auth_type || 'password'
    );
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

    // Get all instances once to avoid repeated DB queries
    const instances = await getAllPortainerInstances();
    const instanceMap = new Map(instances.map(inst => [inst.url, inst]));

    // Upgrade containers sequentially to avoid conflicts
    const results = [];
    const errors = [];

    for (const container of containers) {
      try {
        const instance = instanceMap.get(container.portainerUrl);
        if (!instance) {
          errors.push({
            containerId: container.containerId,
            error: `Portainer instance not found: ${container.portainerUrl}`,
          });
          continue;
        }

        await portainerService.authenticatePortainer(
          container.portainerUrl,
          instance.username,
          instance.password,
          instance.api_key,
          instance.auth_type || 'password'
        );
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

