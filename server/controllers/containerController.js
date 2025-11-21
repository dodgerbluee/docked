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
const { getAllPortainerInstances, getPortainerContainersWithUpdates } = require("../db/database");
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
      // Docker Hub data can be added later via "Pull" button or batch process
      logger.info("Fetched Portainer-only container data", {
        module: "containerController",
        operation: "getContainers",
        containerCount: portainerResult.containers?.length || 0,
      });
      res.json(portainerResult);
      return;
    }

    // Check if cached data has network mode flags (providesNetwork, usesNetworkMode)
    // If not, it's old cached data and we need to refresh from Portainer to add these flags
    const hasNetworkModeFlags = cached.containers.some(
      (container) =>
        Object.prototype.hasOwnProperty.call(container, "providesNetwork") ||
        Object.prototype.hasOwnProperty.call(container, "usesNetworkMode")
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
 * Fetches fresh data from Portainer and Docker Hub
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
      logger.warn("Docker Hub rate limit exceeded - not updating container data", {
        module: "containerController",
        operation: "pullContainers",
        error: error,
        portainerUrl: req.body?.portainerUrl || "all-instances",
      });

      // Check if credentials exist to customize message
      const userId = req.user?.id;
      let message =
        "Docker Hub rate limit exceeded. Please wait a few minutes before trying again.";
      if (userId) {
        const { getDockerHubCreds } = require("../utils/dockerHubCreds");
        const creds = await getDockerHubCreds(userId);
        if (!creds.username || !creds.token) {
          message += " Or configure Docker Hub credentials in Settings for higher rate limits.";
        }
      } else {
        message += " Or configure Docker Hub credentials in Settings for higher rate limits.";
      }

      // Return error without updating container data
      return res.status(429).json({
        success: false,
        error: error.message || "Docker Hub rate limit exceeded",
        rateLimitExceeded: true,
        message: message,
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

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

    // Get instance credentials from database for this user
    const instances = await getAllPortainerInstances(userId);
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
      imageName,
      userId
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { containers } = req.body;

    // Validate input
    const validationError = validateContainerArray(containers);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Get all instances once to avoid repeated DB queries (for this user)
    const instances = await getAllPortainerInstances(userId);
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
          container.imageName,
          userId
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
 * Get all container data from normalized tables (developer mode only)
 * Shows data from normalized tables: portainer_containers and docker_hub_image_versions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getContainerData(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Get ALL containers with joined deployed images and registry versions
    const { getPortainerContainersWithUpdates } = require("../db/database");
    const allContainers = await getPortainerContainersWithUpdates(userId);
    const userInstances = await getAllPortainerInstances(userId);
    const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

    // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
    const normalizeDigest = (digest) => {
      if (!digest) {
        return null;
      }
      // Ensure digest starts with sha256: for consistent comparison
      return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
    };

    // Format containers for display (include Portainer data even if no Docker Hub data)
    // Also preserve portainerInstanceId for grouping
    const formattedContainers = allContainers.map((c) => {
      const instance = instanceMap.get(c.portainerInstanceId);

      // Data is already joined from getPortainerContainersWithUpdates
      // hasUpdate is already computed in the query

      return {
        id: c.containerId,
        name: c.containerName,
        image: c.imageName,
        imageRepo: c.imageRepo,
        status: c.status,
        state: c.state,
        portainerUrl: instance ? instance.url : null,
        portainerName: instance ? instance.name : null,
        portainerInstanceId: c.portainerInstanceId, // Preserve for grouping
        endpointId: c.endpointId,
        stackName: c.stackName,
        currentDigest: c.currentDigest,
        currentTag: c.imageTag || (c.imageName?.includes(":") ? c.imageName.split(":")[1] : "latest"),
        currentVersion: c.imageTag || (c.imageName?.includes(":") ? c.imageName.split(":")[1] : "latest"),
        currentImageCreated: c.imageCreatedDate,
        usesNetworkMode: c.usesNetworkMode || false,
        providesNetwork: c.providesNetwork || false,
        // Registry version data (already joined, may be null if not available)
        hasUpdate: c.hasUpdate || false,
        latestDigest: c.latestDigest || null,
        latestVersion: c.latestVersion || null,
        latestTag: c.latestTag || null,
        latestPublishDate: c.latestPublishDate || null,
        existsInDockerHub: false, // Deprecated - use existsInRegistry
        existsInRegistry: true, // Will be determined from registry_image_versions
        deployedImageId: c.deployedImageId || null,
        lastSeen: c.lastSeen,
        updatedAt: c.updatedAt,
      };
    });

    // Group by image (repo:tag) for formatted view - show all containers using same image together
    const containersByImage = new Map();
    formattedContainers.forEach((c) => {
      if (c.imageRepo) {
        const imageKey = `${c.imageRepo}:${c.currentTag || "latest"}`;
        if (!containersByImage.has(imageKey)) {
          containersByImage.set(imageKey, {
            imageRepo: c.imageRepo,
            imageTag: c.currentTag || "latest",
            currentDigest: c.currentDigest,
            currentVersion: c.currentVersion,
            latestDigest: c.latestDigest,
            latestVersion: c.latestVersion,
            latestTag: c.latestTag,
            latestPublishDate: c.latestPublishDate,
            hasUpdate: c.hasUpdate,
            existsInRegistry: c.existsInRegistry,
            containers: [],
          });
        }
        containersByImage.get(imageKey).containers.push(c);
        // Update hasUpdate if any container has update
        if (c.hasUpdate) {
          containersByImage.get(imageKey).hasUpdate = true;
        }
      }
    });

    // Also group by portainer instance for instance-based view
    const containersByInstanceId = new Map();
    formattedContainers.forEach((c) => {
      if (c.portainerInstanceId) {
        if (!containersByInstanceId.has(c.portainerInstanceId)) {
          containersByInstanceId.set(c.portainerInstanceId, []);
        }
        containersByInstanceId.get(c.portainerInstanceId).push(c);
      }
    });

    // Create entries grouped by image (for formatted view)
    const imageEntries = Array.from(containersByImage.entries()).map(([imageKey, imageData]) => ({
      key: `image-${imageKey}`,
      imageRepo: imageData.imageRepo,
      imageTag: imageData.imageTag,
      containerCount: imageData.containers.length,
      containerNames: imageData.containers.map((c) => c.name || c.id || "Unknown"),
      data: {
        imageRepo: imageData.imageRepo,
        imageTag: imageData.imageTag,
        currentDigest: imageData.currentDigest,
        currentVersion: imageData.currentVersion,
        latestDigest: imageData.latestDigest,
        latestVersion: imageData.latestVersion,
        latestTag: imageData.latestTag,
        latestPublishDate: imageData.latestPublishDate,
        hasUpdate: imageData.hasUpdate,
        existsInRegistry: imageData.existsInRegistry,
        containers: imageData.containers,
      },
      createdAt: null,
      updatedAt: imageData.containers.length > 0 ? imageData.containers[0].updatedAt || null : null,
    }));

    // Also create entries grouped by instance (for instance-based view)
    const instanceEntries = userInstances.map((instance) => {
      const instanceContainers = containersByInstanceId.get(instance.id) || [];
      return {
        key: `portainer-${instance.id}`,
        containerCount: instanceContainers.length,
        containerNames: instanceContainers.map((c) => c.name || c.id || "Unknown"),
        data: {
          instanceName: instance.name,
          instanceUrl: instance.url,
          containers: instanceContainers,
        },
        createdAt: null,
        updatedAt: instanceContainers.length > 0 ? instanceContainers[0].updatedAt || null : null,
      };
    });

    // Use image-based entries for formatted view (shows all containers using same image together)
    const entries = imageEntries;

    logger.info("Container data retrieved from normalized tables", {
      module: "containerController",
      operation: "getContainerData",
      entryCount: entries.length,
      totalContainers: allContainers.length,
      formattedContainers: formattedContainers.length,
      containersByInstanceId: Array.from(containersByInstanceId.entries()).map(
        ([id, containers]) => ({
          instanceId: id,
          containerCount: containers.length,
        })
      ),
    });

    // Get raw database records for debugging
    const rawDatabaseRecords = await getRawDatabaseRecords(userId);

    res.json({
      success: true,
      entries: entries,
      rawDatabaseRecords: rawDatabaseRecords, // Add raw DB records for debugging
    });
  } catch (error) {
    logger.error("Error getting container data", {
      module: "containerController",
      operation: "getContainerData",
      error: error,
    });
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get container data",
    });
  }
}

/**
 * Get raw database records for all relevant tables (for debugging)
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Raw database records organized by table
 */
async function getRawDatabaseRecords(userId) {
  const { getRawDatabaseRecords: getRawRecords } = require("../db/database");
  return await getRawRecords(userId);
}

/**
 * Clear container data from database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearContainerData(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { clearUserContainerData } = require("../db/database");
    await clearUserContainerData(userId);
    logger.info("User container data cleared", {
      module: "containerController",
      operation: "clearContainerData",
      userId: userId,
    });
    res.json({
      success: true,
      message: "Container data cleared successfully",
    });
  } catch (error) {
    logger.error("Error clearing container data", {
      module: "containerController",
      operation: "clearContainerData",
      error: error,
    });
    res.status(500).json({
      success: false,
      error: error.message || "Failed to clear container data",
    });
  }
}

module.exports = {
  getContainers,
  pullContainers,
  getContainerData,
  clearContainerData,
  upgradeContainer,
  batchUpgradeContainers,
};
