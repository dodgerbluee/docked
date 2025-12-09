/**
 * Container Controller
 * Handles HTTP requests for container operations
 */
/* eslint-disable max-lines -- Large controller file with comprehensive container operations */

const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const containerGroupingService = require("../services/containerGroupingService");
const { computeHasUpdate } = require("../utils/containerUpdateHelpers");
const {
  // validateRequiredFields, // Unused
  // isValidContainerId, // Unused
  validateContainerArray,
} = require("../utils/validation");
const { RateLimitExceededError } = require("../utils/retry");
const { getAllPortainerInstances } = require("../db/index");
const logger = require("../utils/logger");
// const { sendErrorResponse, sendValidationErrorResponse } = require("../utils/responseHelpers"); // Unused

/**
 * Get all containers with update status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

// eslint-disable-next-line max-lines-per-function, complexity -- Container retrieval requires comprehensive data processing
async function getContainers(req, res, _next) {
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
    // Check if we should refresh and re-evaluate update status
    const refreshUpdates = req.query.refreshUpdates === "true";
    // Check if we should use the new cache service
    const useNewCache = req.query.useNewCache === "true" || process.env.USE_NEW_CACHE === "true";

    // Use new cache service if enabled (provides better experience)
    if (useNewCache) {
      const containerCacheService = require("../services/cache/containerCacheService");
      const portainerUrl = req.query.portainerUrl || null;
      const result = await containerCacheService.getContainersWithCache(userId, {
        forceRefresh: refreshUpdates || portainerOnly,
        portainerUrl,
      });
      return res.json(result);
    }

    if (portainerOnly) {
      // Fetch from Portainer (fresh container data)
      const portainerResult = await containerService.getContainersFromPortainer(userId);

      // If refreshUpdates is true, merge fresh Portainer data with cached update info
      // This allows refreshing container status/names while preserving Docker update information
      if (refreshUpdates) {
        // Get cached containers with update info (properly formatted)
        // Note: These containers have hasUpdate computed from OLD currentDigest in DB
        // We will override currentDigest with fresh Portainer data and recompute hasUpdate
        const cached = await containerService.getAllContainersWithUpdates(false, null, userId);

        if (cached && cached.containers && cached.containers.length > 0) {
          // Create a map of cached containers by ID for quick lookup
          const cachedMap = new Map();
          cached.containers.forEach((c) => {
            cachedMap.set(c.id, c);
          });

          // Merge: use fresh Portainer data (status, state, names) but preserve update info from cache
          const mergedContainers = portainerResult.containers.map((portainerContainer) => {
            const cachedContainer = cachedMap.get(portainerContainer.id);

            if (cachedContainer) {
              // Merge: fresh Portainer data + cached update info
              // CRITICAL: Always use fresh currentDigest from Portainer to detect manual upgrades
              // Don't fall back to cached currentDigest - the fresh one is the source of truth
              const freshCurrentDigest =
                portainerContainer.currentDigest || portainerContainer.currentDigestFull;
              const freshCurrentDigestFull =
                portainerContainer.currentDigestFull || portainerContainer.currentDigest;

              // Build merged container with fresh Portainer data prioritized
              // IMPORTANT: Don't spread cachedContainer.hasUpdate - we'll compute it fresh
              const { hasUpdate: _cachedHasUpdate, ...cachedWithoutHasUpdate } = cachedContainer;

              const mergedContainer = {
                ...cachedWithoutHasUpdate, // Start with cached data (but exclude old hasUpdate)
                // Override Portainer-specific fields (status, state, names) with fresh data
                status: portainerContainer.status,
                state: portainerContainer.state,
                name: portainerContainer.name,
                // Preserve network mode flags from fresh Portainer data
                usesNetworkMode:
                  portainerContainer.usesNetworkMode !== undefined
                    ? portainerContainer.usesNetworkMode
                    : cachedContainer.usesNetworkMode,
                providesNetwork:
                  portainerContainer.providesNetwork !== undefined
                    ? portainerContainer.providesNetwork
                    : cachedContainer.providesNetwork,
                // CRITICAL: Always use fresh currentDigest from Portainer (actual running container)
                // This is the key to detecting manual upgrades - don't use cached digest
                currentDigest: freshCurrentDigest || null, // Use fresh or null, never cached
                currentDigestFull: freshCurrentDigestFull || null, // Use fresh or null, never cached
                currentTag: portainerContainer.currentTag || cachedContainer.currentTag,
                currentVersion: portainerContainer.currentVersion || cachedContainer.currentVersion,
                currentImageCreated:
                  portainerContainer.currentImageCreated || cachedContainer.currentImageCreated,
                // Preserve all update-related fields from cache (latest digest, versions, etc.)
                latestDigest: cachedContainer.latestDigest,
                latestDigestFull: cachedContainer.latestDigestFull,
                latestTag: cachedContainer.latestTag,
                latestVersion: cachedContainer.latestVersion,
                newVersion: cachedContainer.newVersion,
                latestPublishDate: cachedContainer.latestPublishDate,
                imageRepo: cachedContainer.imageRepo,
                existsInDockerHub: cachedContainer.existsInDockerHub,
                provider: cachedContainer.provider,
                updateSourceType: cachedContainer.updateSourceType,
                updateGitHubRepo: cachedContainer.updateGitHubRepo,
                updateGitLabRepo: cachedContainer.updateGitLabRepo,
                noDigest: cachedContainer.noDigest,
                lastChecked: cachedContainer.lastChecked,
              };

              // Compute hasUpdate on-the-fly using fresh currentDigest from Portainer
              // This will correctly detect if container was manually upgraded
              // This MUST be computed after merging to use the fresh currentDigest
              mergedContainer.hasUpdate = computeHasUpdate(mergedContainer);

              return mergedContainer;
            }

            // No cached data - container is new, return Portainer data as-is
            return portainerContainer;
          });

          // Update stacks and portainerInstances with merged data
          const { stacks } = containerGroupingService.groupContainersByStackWithUnstacked(
            mergedContainers,
            "Unstacked"
          );

          const userInstances = await getAllPortainerInstances(userId);
          const portainerInstancesArray = containerGroupingService
            .groupContainersByPortainerInstance(mergedContainers, userInstances)
            .map((instance) => {
              const withUpdates = instance.containers.filter((c) => c.hasUpdate);
              const upToDate = instance.containers.filter((c) => !c.hasUpdate);
              return {
                ...instance,
                withUpdates,
                upToDate,
              };
            });

          return res.json({
            ...portainerResult,
            containers: mergedContainers,
            stacks,
            portainerInstances: portainerInstancesArray,
            unusedImagesCount: cached.unusedImagesCount || portainerResult.unusedImagesCount,
          });
        }
      }

      // No refreshUpdates or no cached data - return Portainer data as-is
      return res.json(portainerResult);
    }

    // IMPORTANT: Never call registries here - only return cached data or fetch from Portainer
    // Registry checks are ONLY done via /api/containers/pull endpoint (manual pull or batch process)
    const cached = await containerService.getAllContainersWithUpdates(false, null, userId);

    // If cache is empty or has no containers, fetch from Portainer only (NO registry checks)
    if (!cached || !cached.containers || cached.containers.length === 0) {
      logger.info("No cached container data found, fetching from Portainer only", {
        module: "containerController",
        operation: "getContainers",
        source: "portainer-only",
      });
      const portainerResult = await containerService.getContainersFromPortainer(userId);
      // Registry update data can be added later via "Pull" button or batch process
      logger.info("Fetched Portainer-only container data", {
        module: "containerController",
        operation: "getContainers",
        containerCount: portainerResult.containers?.length || 0,
      });
      return res.json(portainerResult);
    }

    // Check if cached data has network mode flags (providesNetwork, usesNetworkMode)
    // If not, it's old cached data and we need to refresh from Portainer to add these flags
    const hasNetworkModeFlags = cached.containers.some(
      (container) =>
        Object.hasOwn(container, "providesNetwork") || Object.hasOwn(container, "usesNetworkMode")
    );

    if (!hasNetworkModeFlags && cached.containers.length > 0) {
      logger.info("Cached data missing network mode flags, refreshing from Portainer", {
        module: "containerController",
        operation: "getContainers",
        source: "portainer-refresh-for-flags",
      });
      // Fetch fresh data from Portainer (includes network mode detection)
      const portainerResult = await containerService.getContainersFromPortainer(userId);

      // Merge Portainer network mode flags into cached data (preserve registry update info)
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

      return res.json(updatedCache);
    }

    // Return cached data (may contain registry update info from previous pull, but no new registry calls)
    return res.json(cached);
  } catch (error) {
    // If there's an error, try fetching from Portainer only as fallback
    logger.error("Error getting containers from cache", {
      module: "containerController",
      operation: "getContainers",
      error,
    });
    try {
      const portainerResult = await containerService.getContainersFromPortainer(req.user?.id);
      logger.info("Fallback to Portainer-only fetch succeeded", {
        module: "containerController",
        operation: "getContainers",
      });
      return res.json(portainerResult);
    } catch (portainerError) {
      logger.error("Fallback to Portainer-only fetch failed", {
        module: "containerController",
        operation: "getContainers",
        error: portainerError,
      });
      return res.json({
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
 * Pull fresh container data from registries
 * Fetches fresh data from Portainer and checks for updates in container registries
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Complex container pull logic
async function pullContainers(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { portainerUrl } = req.body;
    logger.info("Pull request received - fetching container data from registries", {
      module: "containerController",
      operation: "pullContainers",
      portainerUrl: portainerUrl || "all-instances",
    });

    // Force refresh - checks for updates in container registries
    // Called by: 1) Manual "Pull" button, 2) Batch process, 3) After adding new instance

    // Use new cache service if enabled (provides better experience and correct merge logic)
    const useNewCache = process.env.USE_NEW_CACHE === "true";
    if (useNewCache) {
      const containerCacheService = require("../services/cache/containerCacheService");
      // First, trigger the pull to update registries
      await containerService.getAllContainersWithUpdates(true, portainerUrl, userId);
      // Then get the merged result from cache service
      const result = await containerCacheService.getContainersWithCache(userId, {
        forceRefresh: true,
        portainerUrl,
      });

      logger.info("Container data pull completed successfully (using new cache)", {
        module: "containerController",
        operation: "pullContainers",
        containerCount: result.containers?.length || 0,
        portainerUrl: portainerUrl || "all-instances",
      });

      return res.json({
        success: true,
        message: "Container data pulled successfully",
        ...result,
      });
    }

    // Fallback to old method
    const result = await containerService.getAllContainersWithUpdates(true, portainerUrl, userId);

    logger.info("Container data pull completed successfully", {
      module: "containerController",
      operation: "pullContainers",
      containerCount: result.containers?.length || 0,
      portainerUrl: portainerUrl || "all-instances",
    });

    return res.json({
      success: true,
      message: "Container data pulled successfully",
      ...result,
    });
  } catch (error) {
    // Handle rate limit exceeded errors specially
    if (error.isRateLimitExceeded || error instanceof RateLimitExceededError) {
      logger.warn("Registry rate limit exceeded - not updating container data", {
        module: "containerController",
        operation: "pullContainers",
        error,
        portainerUrl: req.body?.portainerUrl || "all-instances",
      });

      // Check if credentials exist to customize message
      const userId = req.user?.id;
      let message = "Registry rate limit exceeded. Please wait a few minutes before trying again.";
      if (userId) {
        const { getDockerHubCreds } = require("../utils/dockerHubCreds");
        const creds = await getDockerHubCreds(userId);
        if (!creds.username || !creds.token) {
          message += " Or configure registry credentials in Settings for higher rate limits.";
        }
      } else {
        message += " Or configure registry credentials in Settings for higher rate limits.";
      }

      // Return error without updating container data
      return res.status(429).json({
        success: false,
        error: error.message || "Registry rate limit exceeded",
        rateLimitExceeded: true,
        message,
      });
    }

    logger.error("Error pulling container data from registries", {
      module: "containerController",
      operation: "pullContainers",
      error,
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

    // Note: Input validation is now handled by validation middleware
    // All validation (containerId, endpointId, imageName, portainerUrl) is handled in routes

    // Get instance credentials from database for this user
    const instances = await getAllPortainerInstances(userId);
    const instance = instances.find((inst) => inst.url === portainerUrl);
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: "Portainer instance not found",
      });
    }

    await portainerService.authenticatePortainer({
      portainerUrl,
      username: instance.username,
      password: instance.password,
      apiKey: instance.api_key,
      authType: instance.auth_type || "apikey",
    });
    const result = await containerService.upgradeSingleContainer(
      portainerUrl,
      endpointId,
      containerId,
      imageName,
      userId
    );

    return res.json({
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
// eslint-disable-next-line max-lines-per-function, complexity -- Complex batch upgrade logic
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
      // If validation returns errors array, format it for the response
      if (validationError.errors && Array.isArray(validationError.errors)) {
        return res.status(400).json({
          success: false,
          error: validationError.error,
          errors: validationError.errors,
        });
      }
      return res.status(400).json({
        success: false,
        ...validationError,
      });
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
          await portainerService.authenticatePortainer({
            portainerUrl,
            username: instance.username,
            password: instance.password,
            apiKey: instance.api_key,
            authType: instance.auth_type || "apikey",
          });
          return { portainerUrl, success: true };
        } catch (error) {
          logger.error("Failed to authenticate Portainer instance", {
            module: "containerController",
            operation: "batchUpgradeContainers",
            portainerUrl,
            error,
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
        await portainerService.authenticatePortainer({
          portainerUrl: container.portainerUrl,
          username: instance.username,
          password: instance.password,
          apiKey: instance.api_key,
          authType: instance.auth_type || "apikey",
        });

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
          error,
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

    return res.json({
      success: errors.length === 0,
      message: `Upgraded ${results.length} container(s), ${errors.length} error(s)`,
      results,
      errors,
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
/**
 * Correlate database records by image name/version
 * Groups all related records (containers, deployed_images, registry_image_versions, portainer_instances)
 * together for easier debugging
 * @param {Object} rawDatabaseRecords - Raw database records by table
 * @param {Array} allContainers - All containers with joined data
 * @param {Array} userInstances - All Portainer instances
 * @returns {Object} Correlated records grouped by image
 */
// eslint-disable-next-line max-lines-per-function -- Complex correlation logic
function correlateRecordsByImage(rawDatabaseRecords, allContainers, userInstances) {
  const correlated = {};
  const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

  // Helper to extract image repo and tag from various formats
  const extractImageInfo = (imageName, imageRepo, imageTag) => {
    let repo = imageRepo || "";
    let tag = imageTag || "latest";

    // If we have imageName, try to extract from it
    if (imageName && !repo) {
      if (imageName.includes(":")) {
        const parts = imageName.split(":");
        repo = parts.slice(0, -1).join(":");
        tag = parts[parts.length - 1];
      } else {
        repo = imageName;
      }
    }

    // Remove @sha256 suffix if present
    if (tag && tag.includes("@")) {
      tag = tag.split("@")[0];
    }

    return { repo, tag };
  };

  // First pass: Group containers by image_repo:tag
  const containersByImage = new Map();

  (rawDatabaseRecords.containers || []).forEach((container) => {
    const { repo, tag } = extractImageInfo(container.image_name, container.image_repo, null);
    const imageKey = `${repo}:${tag}`;

    if (!containersByImage.has(imageKey)) {
      containersByImage.set(imageKey, {
        imageRepo: repo,
        imageTag: tag,
        containers: [],
        deployedImages: [],
        registryVersions: [],
        portainerInstances: new Set(),
      });
    }

    containersByImage.get(imageKey).containers.push(container);

    // Track which Portainer instance this container belongs to
    if (container.portainer_instance_id) {
      containersByImage.get(imageKey).portainerInstances.add(container.portainer_instance_id);
    }

    // Also track deployed_image_id if present
    if (container.deployed_image_id) {
      containersByImage.get(imageKey).deployedImageIds =
        containersByImage.get(imageKey).deployedImageIds || new Set();
      containersByImage.get(imageKey).deployedImageIds.add(container.deployed_image_id);
    }
  });

  // Second pass: Correlate deployed_images by image_repo and by ID
  const deployedImageMap = new Map();
  (rawDatabaseRecords.deployed_images || []).forEach((deployedImage) => {
    deployedImageMap.set(deployedImage.id, deployedImage);

    const { repo, tag } = extractImageInfo(null, deployedImage.image_repo, deployedImage.image_tag);
    const imageKey = `${repo}:${tag}`;

    if (containersByImage.has(imageKey)) {
      containersByImage.get(imageKey).deployedImages.push(deployedImage);
    } else {
      // Create entry for deployed images without containers
      if (!containersByImage.has(imageKey)) {
        containersByImage.set(imageKey, {
          imageRepo: repo,
          imageTag: tag,
          containers: [],
          deployedImages: [],
          registryVersions: [],
          portainerInstances: new Set(),
        });
      }
      containersByImage.get(imageKey).deployedImages.push(deployedImage);
    }
  });

  // Third pass: Match deployed_images to containers by deployed_image_id
  containersByImage.forEach((data) => {
    if (data.deployedImageIds) {
      data.deployedImageIds.forEach((deployedImageId) => {
        const deployedImage = deployedImageMap.get(deployedImageId);
        if (deployedImage && !data.deployedImages.find((di) => di.id === deployedImage.id)) {
          data.deployedImages.push(deployedImage);
        }
      });
      delete data.deployedImageIds;
    }
  });

  // Fourth pass: Correlate registry_image_versions by image_repo
  (rawDatabaseRecords.registry_image_versions || []).forEach((version) => {
    const imageRepo = version.image_repo || "";
    // Try to match by current_tag, latest_tag, or any tag
    const imageTag = version.current_tag || version.latest_tag || version.image_tag || "latest";
    const imageKey = `${imageRepo}:${imageTag}`;

    // Try exact match first
    if (containersByImage.has(imageKey)) {
      containersByImage.get(imageKey).registryVersions.push(version);
    } else {
      // Try matching by repo only (any tag)
      let matched = false;
      containersByImage.forEach((data, key) => {
        if (key.startsWith(`${imageRepo}:`)) {
          data.registryVersions.push(version);
          matched = true;
        }
      });

      // If no match, create a repo-only entry
      if (!matched) {
        const repoOnlyKey = `${imageRepo}:*`;
        if (!containersByImage.has(repoOnlyKey)) {
          containersByImage.set(repoOnlyKey, {
            imageRepo,
            imageTag: "*",
            containers: [],
            deployedImages: [],
            registryVersions: [],
            portainerInstances: new Set(),
          });
        }
        containersByImage.get(repoOnlyKey).registryVersions.push(version);
      }
    }
  });

  // Convert to object format and add Portainer instance details
  containersByImage.forEach((data, imageKey) => {
    const portainerInstances = Array.from(data.portainerInstances)
      .map((instanceId) => {
        const instance = instanceMap.get(instanceId);
        return instance || { id: instanceId, error: "Instance not found" };
      })
      .filter(Boolean);

    correlated[imageKey] = {
      imageRepo: data.imageRepo,
      imageTag: data.imageTag,
      containers: data.containers,
      deployedImages: data.deployedImages,
      registryVersions: data.registryVersions,
      portainerInstances,
      // Add summary counts
      summary: {
        containerCount: data.containers.length,
        deployedImageCount: data.deployedImages.length,
        registryVersionCount: data.registryVersions.length,
        portainerInstanceCount: portainerInstances.length,
      },
    };
  });

  return correlated;
}
// eslint-disable-next-line max-lines-per-function -- Complex container data retrieval logic
async function getContainerData(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Get ALL containers with joined deployed images and registry versions
    const {
      getPortainerContainersWithUpdates: getPortainerContainersWithUpdatesLocal,
    } = require("../db/index");
    const allContainers = await getPortainerContainersWithUpdatesLocal(userId);
    const userInstances = await getAllPortainerInstances(userId);
    const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

    // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
    const _normalizeDigest = (digest) => {
      if (!digest) {
        return null;
      }
      // Ensure digest starts with sha256: for consistent comparison
      return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
    };

    // Format containers for display (include Portainer data even if no registry update data)
    // Also preserve portainerInstanceId for grouping
    // eslint-disable-next-line complexity -- Complex formatting logic needed for container display
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
        currentTag:
          c.imageTag || (c.imageName?.includes(":") ? c.imageName.split(":")[1] : "latest"),
        currentVersion:
          c.imageTag || (c.imageName?.includes(":") ? c.imageName.split(":")[1] : "latest"),
        currentImageCreated: c.imageCreatedDate,
        usesNetworkMode: c.usesNetworkMode || false,
        providesNetwork: c.providesNetwork || false,
        // Registry version data (already joined, may be null if not available)
        // hasUpdate will be computed below
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

      // Compute hasUpdate on-the-fly
      formattedContainer.hasUpdate = computeHasUpdate(formattedContainer);

      return formattedContainer;
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
    const _instanceEntries = userInstances.map((instance) => {
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

    // Create correlated view: group all DB records by image name/version
    const correlatedRecords = correlateRecordsByImage(
      rawDatabaseRecords,
      allContainers,
      userInstances
    );

    return res.json({
      success: true,
      entries,
      rawDatabaseRecords, // Add raw DB records for debugging
      correlatedRecords, // Add correlated records for formatted view
    });
  } catch (error) {
    logger.error("Error getting container data", {
      module: "containerController",
      operation: "getContainerData",
      error,
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
function getRawDatabaseRecords(userId) {
  const { getRawDatabaseRecords: getRawRecords } = require("../db/index");
  return getRawRecords(userId);
}

/**
 * Clear container data from database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearContainerData(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { clearUserContainerData } = require("../db/index");

    // Clear database tables (containers, deployed_images, registry_image_versions)
    // NOTE: tracked_apps table is NOT touched - it's managed separately
    await clearUserContainerData(userId);

    // Clear memory cache for this user
    try {
      const containerCacheService = require("../services/cache/containerCacheService");
      containerCacheService.invalidateCache(userId);
    } catch (cacheError) {
      // Log but don't fail - cache clearing is best effort
      logger.warn("Failed to clear cache after clearing container data", {
        module: "containerController",
        operation: "clearContainerData",
        userId,
        error: cacheError,
      });
    }

    logger.info("User container data and cache cleared", {
      module: "containerController",
      operation: "clearContainerData",
      userId,
    });
    return res.json({
      success: true,
      message: "Container data and cache cleared successfully",
    });
  } catch (error) {
    logger.error("Error clearing container data", {
      module: "containerController",
      operation: "clearContainerData",
      error,
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
