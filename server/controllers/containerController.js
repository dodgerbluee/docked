/**
 * Container Controller
 * Handles HTTP requests for container operations
 */

const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const {
  validateRequiredFields,
  isValidContainerId,
  validateContainerArray,
} = require("../utils/validation");
const { RateLimitExceededError } = require("../utils/retry");
const { getAllPortainerInstances, setContainerCache, getAllContainerCacheEntries } = require("../db/database");
const logger = require("../utils/logger");

/**
 * Get all containers with update status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getContainers(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    // Check if we should fetch from Portainer only (no Docker Hub)
    const portainerOnly = req.query.portainerOnly === "true";

    if (portainerOnly) {
      // Fetch from Portainer without Docker Hub checks
      const result = await containerService.getContainersFromPortainer(userId);
      // Cache Portainer-only data so we don't have to refetch on every request
      try {
        await setContainerCache("containers", result, { lastPortainerPull: new Date().toISOString() });
        logger.info("Cached Portainer-only container data (portainerOnly=true)", {
          module: "containerController",
          operation: "getContainers",
          containerCount: result.containers?.length || 0,
        });
      } catch (cacheError) {
        logger.warn("Failed to cache Portainer-only data (portainerOnly=true):", cacheError.message);
        // Continue even if cache fails
      }
      res.json(result);
      return;
    }

    // IMPORTANT: Never call Docker Hub here - only return cached data or fetch from Portainer
    // Docker Hub is ONLY called via /api/containers/pull endpoint (manual pull or batch process)
    const cached = await containerService.getAllContainersWithUpdates(false, null, userId);

    // If cache is empty or has no containers, fetch from Portainer only (NO Docker Hub)
    if (!cached || !cached.containers || cached.containers.length === 0) {
      logger.info("No cached container data found, fetching from Portainer only", {
        module: "containerController",
        operation: "getContainers",
        source: "portainer-only",
      });
      const portainerResult = await containerService.getContainersFromPortainer(userId);
      // Cache Portainer-only data so we don't have to refetch on every request
      // Docker Hub data can be added later via "Pull" button or batch process
      try {
        await setContainerCache("containers", portainerResult, { lastPortainerPull: new Date().toISOString() });
        logger.info("Cached Portainer-only container data", {
          module: "containerController",
          operation: "getContainers",
          containerCount: portainerResult.containers?.length || 0,
        });
      } catch (cacheError) {
        logger.warn("Failed to cache Portainer-only data:", cacheError.message);
        // Continue even if cache fails
      }
      res.json(portainerResult);
      return;
    }

    // Check if cached data has network mode flags (providesNetwork, usesNetworkMode)
    // If not, it's old cached data and we need to refresh from Portainer to add these flags
    const hasNetworkModeFlags = cached.containers.some(
      (container) =>
        container.hasOwnProperty("providesNetwork") || container.hasOwnProperty("usesNetworkMode")
    );

    if (!hasNetworkModeFlags && cached.containers.length > 0) {
      logger.info("Cached data missing network mode flags, refreshing from Portainer", {
        module: "containerController",
        operation: "getContainers",
        source: "portainer-refresh-for-flags",
      });
      // Fetch fresh data from Portainer (includes network mode detection)
      const portainerResult = await containerService.getContainersFromPortainer(userId);

      // Merge Portainer network mode flags into cached data (preserve Docker Hub update info)
      const portainerContainersMap = new Map();
      portainerResult.containers.forEach((c) => {
        portainerContainersMap.set(c.id, c);
      });

      // Update cached containers with network mode flags from Portainer data
      const updatedContainers = cached.containers.map((cachedContainer) => {
        const portainerContainer = portainerContainersMap.get(cachedContainer.id);
        if (portainerContainer) {
          return {
            ...cachedContainer,
            providesNetwork: portainerContainer.providesNetwork || false,
            usesNetworkMode: portainerContainer.usesNetworkMode || false,
          };
        }
        // If container not found in Portainer data, add default flags
        return {
          ...cachedContainer,
          providesNetwork: false,
          usesNetworkMode: false,
        };
      });

      const updatedCache = {
        ...cached,
        containers: updatedContainers,
      };

      // Update cache with network mode flags
      // Preserve existing metadata and update Portainer pull timestamp
      const existingMetadata = cached._metadata || {};
      try {
        await setContainerCache("containers", updatedCache, { 
          ...existingMetadata,
          lastPortainerPull: new Date().toISOString() 
        });
      } catch (cacheError) {
        logger.warn("Failed to update cache with network mode flags:", cacheError.message);
      }

      res.json(updatedCache);
      return;
    }

    // Return cached data (may contain Docker Hub info from previous pull, but no new Docker Hub calls)
    res.json(cached);
  } catch (error) {
    // If there's an error, try fetching from Portainer only as fallback
    logger.error("Error getting containers from cache", {
      module: "containerController",
      operation: "getContainers",
      error: error,
    });
    try {
      const portainerResult = await containerService.getContainersFromPortainer(userId);
      logger.info("Fallback to Portainer-only fetch succeeded", {
        module: "containerController",
        operation: "getContainers",
      });
      // Cache Portainer-only data so we don't have to refetch on every request
      try {
        await setContainerCache("containers", portainerResult, { lastPortainerPull: new Date().toISOString() });
        logger.info("Cached Portainer-only container data (fallback)", {
          module: "containerController",
          operation: "getContainers",
          containerCount: portainerResult.containers?.length || 0,
        });
      } catch (cacheError) {
        logger.warn("Failed to cache Portainer-only data (fallback):", cacheError.message);
        // Continue even if cache fails
      }
      res.json(portainerResult);
    } catch (portainerError) {
      logger.error("Fallback to Portainer-only fetch failed", {
        module: "containerController",
        operation: "getContainers",
        error: portainerError,
      });
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { portainerUrl } = req.body;
    logger.info("Pull request received - fetching container data from Docker Hub", {
      module: "containerController",
      operation: "pullContainers",
      portainerUrl: portainerUrl || "all-instances",
      note: "This is the ONLY endpoint that calls Docker Hub",
    });

    // Force refresh - this is the ONLY place that should call Docker Hub
    // Called by: 1) Manual "Pull from Docker Hub" button, 2) Batch process, 3) After adding new instance
    const result = await containerService.getAllContainersWithUpdates(true, portainerUrl, userId);

    logger.info("Container data pull completed successfully", {
      module: "containerController",
      operation: "pullContainers",
      containerCount: result.containers?.length || 0,
      portainerUrl: portainerUrl || "all-instances",
    });

    res.json({
      success: true,
      message: "Container data pulled successfully",
      ...result,
    });
  } catch (error) {
    // Handle rate limit exceeded errors specially
    if (error.isRateLimitExceeded || error instanceof RateLimitExceededError) {
      logger.warn("Docker Hub rate limit exceeded", {
        module: "containerController",
        operation: "pullContainers",
        error: error,
        portainerUrl: req.body?.portainerUrl || "all-instances",
      });
      return res.status(429).json({
        success: false,
        error: error.message || "Docker Hub rate limit exceeded",
        rateLimitExceeded: true,
        message:
          "Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.",
      });
    }

    logger.error("Error pulling container data from Docker Hub", {
      module: "containerController",
      operation: "pullContainers",
      error: error,
      portainerUrl: req.body?.portainerUrl || "all-instances",
    });

    // Return a more detailed error response
    res.status(500).json({
      success: false,
      error: error.message || "Failed to pull container data",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
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
      return res.status(400).json({ error: "Invalid container ID" });
    }

    const validationError = validateRequiredFields({ endpointId, imageName, portainerUrl }, [
      "endpointId",
      "imageName",
      "portainerUrl",
    ]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Get instance credentials from database
    const instances = await getAllPortainerInstances();
    const instance = instances.find((inst) => inst.url === portainerUrl);
    if (!instance) {
      return res.status(404).json({ error: "Portainer instance not found" });
    }

    await portainerService.authenticatePortainer(
      portainerUrl,
      instance.username,
      instance.password,
      instance.api_key,
      instance.auth_type || "apikey"
    );
    const result = await containerService.upgradeSingleContainer(
      portainerUrl,
      endpointId,
      containerId,
      imageName
    );

    res.json({
      success: true,
      message: "Container upgraded successfully",
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
    const instanceMap = new Map(instances.map((inst) => [inst.url, inst]));

    // Group containers by Portainer instance for efficient authentication
    const containersByInstance = new Map();
    for (const container of containers) {
      const instance = instanceMap.get(container.portainerUrl);
      if (!instance) {
        continue; // Will be handled in the upgrade promises
      }
      if (!containersByInstance.has(container.portainerUrl)) {
        containersByInstance.set(container.portainerUrl, {
          instance,
          containers: [],
        });
      }
      containersByInstance.get(container.portainerUrl).containers.push(container);
    }

    // Authenticate all Portainer instances upfront
    const authPromises = Array.from(containersByInstance.entries()).map(
      async ([portainerUrl, { instance }]) => {
        try {
          await portainerService.authenticatePortainer(
            portainerUrl,
            instance.username,
            instance.password,
            instance.api_key,
            instance.auth_type || "apikey"
          );
          return { portainerUrl, success: true };
        } catch (error) {
          logger.error("Failed to authenticate Portainer instance", {
            module: "containerController",
            operation: "batchUpgradeContainers",
            portainerUrl: portainerUrl,
            error: error,
          });
          return { portainerUrl, success: false, error: error.message };
        }
      }
    );
    await Promise.all(authPromises);

    // Upgrade all containers concurrently
    const upgradePromises = containers.map(async (container) => {
      try {
        const instance = instanceMap.get(container.portainerUrl);
        if (!instance) {
          throw new Error(`Portainer instance not found: ${container.portainerUrl}`);
        }

        // Authenticate for this instance (may be redundant but ensures we have a valid session)
        // This is safe to call multiple times as it will reuse existing sessions if available
        await portainerService.authenticatePortainer(
          container.portainerUrl,
          instance.username,
          instance.password,
          instance.api_key,
          instance.auth_type || "apikey"
        );

        const result = await containerService.upgradeSingleContainer(
          container.portainerUrl,
          container.endpointId,
          container.containerId,
          container.imageName
        );
        return { success: true, result, containerId: container.containerId };
      } catch (error) {
        logger.error("Error upgrading container in batch", {
          module: "containerController",
          operation: "batchUpgradeContainers",
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          portainerUrl: container.portainerUrl,
          error: error,
        });
        return {
          success: false,
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          error: error.message,
        };
      }
    });

    // Wait for all upgrades to complete (whether successful or failed)
    const upgradeResults = await Promise.allSettled(upgradePromises);

    // Separate results and errors
    const results = [];
    const errors = [];

    for (const settledResult of upgradeResults) {
      if (settledResult.status === "fulfilled") {
        const upgradeResult = settledResult.value;
        if (upgradeResult.success) {
          results.push(upgradeResult.result);
        } else {
          errors.push({
            containerId: upgradeResult.containerId,
            containerName: upgradeResult.containerName,
            error: upgradeResult.error,
          });
        }
      } else {
        // Promise was rejected (shouldn't happen since we catch all errors, but handle it)
        errors.push({
          containerId: "unknown",
          containerName: "Unknown",
          error: settledResult.reason?.message || "Unknown error",
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
 * Get all container cache entries (developer mode only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getCacheData(req, res, next) {
  try {
    const entries = await getAllContainerCacheEntries();
    
    // Process entries to extract container information
    const processedEntries = entries.map((entry) => {
      if (!entry.data || entry.error) {
        return {
          key: entry.key,
          error: entry.error || "No data",
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
      }

      // Extract container names from cache data
      const containers = entry.data.containers || [];
      const containerNames = containers.map((c) => c.name || c.id || "Unknown");
      
      // Extract metadata (remove _metadata from data to avoid duplication)
      const metadata = entry.data._metadata || {};
      const dataWithoutMetadata = { ...entry.data };
      delete dataWithoutMetadata._metadata;

      return {
        key: entry.key,
        containerCount: containers.length,
        containerNames: containerNames,
        data: dataWithoutMetadata,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        lastPortainerPull: metadata.lastPortainerPull || null,
        lastDockerHubPull: metadata.lastDockerHubPull || null,
      };
    });

    logger.info("Cache data retrieved", {
      module: "containerController",
      operation: "getCacheData",
      entryCount: processedEntries.length,
    });

    res.json({
      success: true,
      entries: processedEntries,
    });
  } catch (error) {
    logger.error("Error getting cache data", {
      module: "containerController",
      operation: "getCacheData",
      error: error,
    });
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get cache data",
    });
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
    const { clearContainerCache } = require("../db/database");
    await clearContainerCache();
    logger.info("Container cache cleared", {
      module: "containerController",
      operation: "clearCache",
    });
    res.json({
      success: true,
      message: "Cache cleared successfully",
    });
  } catch (error) {
    logger.error("Error clearing container cache", {
      module: "containerController",
      operation: "clearCache",
      error: error,
    });
    res.status(500).json({
      success: false,
      error: error.message || "Failed to clear cache",
    });
  }
}

module.exports = {
  getContainers,
  pullContainers,
  getCacheData,
  clearCache,
  upgradeContainer,
  batchUpgradeContainers,
};
