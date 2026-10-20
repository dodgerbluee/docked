/**
 * Container Controller
 * Handles HTTP requests for container operations
 */
/* eslint-disable max-lines -- Large controller file with comprehensive container operations */

const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const {
  // validateRequiredFields, // Unused
  // isValidContainerId, // Unused
  validateContainerArray,
} = require("../utils/validation");
const { RateLimitExceededError } = require("../utils/errors");
const { getAllSourceInstances } = require("../db/index");
const upgradeLockManager = require("../services/intents/upgradeLockManager");
const { publishGraphEvent } = require("../utils/graphEvents");
const logger = require("../utils/logger");
// const { sendErrorResponse, sendValidationErrorResponse } = require("../utils/responseHelpers"); // Unused

/**
 * Get all containers with update status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

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
        sourceUrl: portainerUrl,
      });

      logger.info("Container data pull completed successfully (using new cache)", {
        module: "containerController",
        operation: "pullContainers",
        containerCount: result.containers?.length || 0,
        portainerUrl: portainerUrl || "all-instances",
      });

      publishGraphEvent("containersUpdated", userId, {
        sourceIds: [],
        containerCount: result.containers?.length || 0,
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

    publishGraphEvent("containersUpdated", userId, {
      sourceIds: [],
      containerCount: result.containers?.length || 0,
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
      const message =
        "Registry rate limit exceeded. Please wait a few minutes before trying again. Tip: Run 'docker login' on your server for higher rate limits.";

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
    const { endpointId, imageName, portainerUrl, runnerId } = req.body;

    if (!portainerUrl && !runnerId) {
      return res.status(400).json({
        success: false,
        error: "Either portainerUrl or runnerId is required",
      });
    }

    // Acquire upgrade lock to prevent conflicts with intent-driven or batch
    // upgrades. Portainer lock identity is the source_instances DB id—not the
    // Portainer endpoint id—so manual and intent-driven paths use one key.
    let sourceInstance = null;
    if (!runnerId) {
      const instances = await getAllSourceInstances(userId);
      sourceInstance = instances.find((instance) => instance.url === portainerUrl);
      if (!sourceInstance) {
        return res.status(404).json({ success: false, error: "Portainer instance not found" });
      }
    }
    const lockOpts = runnerId
      ? { runnerId: Number(runnerId) }
      : { sourceInstanceId: sourceInstance.id };
    const lockToken = await upgradeLockManager.acquire(containerId, {
      ...lockOpts,
      owner: "manual-single",
    });
    if (!lockToken) {
      const lockInfo = upgradeLockManager.isLocked(containerId, lockOpts);
      return res.status(409).json({
        success: false,
        error: `Upgrade already in progress (locked by ${lockInfo.owner || "unknown"})`,
      });
    }

    try {
      // Backend resolution and authentication is handled inside upgradeSingleContainer
      // via dockerBackendFactory.resolveBackend.
      const srcType = runnerId ? "RUNNER" : "PORTAINER";
      const srcName = runnerId ? String(runnerId) : String(portainerUrl);
      const progressEvent = (phase, progress, message) => ({
        operationId: `rest-upgrade-${containerId}`,
        dockerContainerId: containerId,
        containerName: containerId,
        sourceType: srcType,
        sourceName: srcName,
        phase,
        message: message || null,
        progress,
      });
      publishGraphEvent("upgradeProgress", userId, progressEvent("PULLING", 0));

      let result;
      try {
        result = await containerService.upgradeSingleContainer(
          portainerUrl || null,
          endpointId || null,
          containerId,
          imageName,
          userId,
          runnerId ? Number(runnerId) : null
        );
      } catch (upgradeErr) {
        publishGraphEvent(
          "upgradeProgress",
          userId,
          progressEvent("FAILED", 100, upgradeErr.message || "upgrade failed")
        );
        throw upgradeErr;
      }

      publishGraphEvent("upgradeProgress", userId, progressEvent("COMPLETED", 100));
      publishGraphEvent("containersUpdated", userId, { sourceIds: [], containerCount: 0 });

      return res.json({
        success: true,
        message: "Container upgraded successfully",
        ...result,
      });
    } finally {
      await upgradeLockManager.release(containerId, { ...lockOpts, lockToken });
    }
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
    const instances = await getAllSourceInstances(userId);
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

    // Upgrade all containers concurrently (with per-container upgrade locking)
    const upgradePromises = containers.map(async (container) => {
      const instance = instanceMap.get(container.portainerUrl);
      if (!instance) {
        return {
          success: false,
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          error: `Portainer instance not found: ${container.portainerUrl}`,
        };
      }
      // Attempt to acquire upgrade lock to prevent conflicts with intent-driven upgrades
      const lockOpts = { sourceInstanceId: instance.id };
      const lockToken = await upgradeLockManager.acquire(container.containerId, {
        ...lockOpts,
        owner: "manual-batch",
      });

      if (!lockToken) {
        const lockInfo = upgradeLockManager.isLocked(container.containerId, lockOpts);
        logger.info("Batch upgrade skipped — container locked", {
          module: "containerController",
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          lockedBy: lockInfo.owner,
        });
        return {
          success: false,
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          error: `Upgrade already in progress (locked by ${lockInfo.owner || "unknown"})`,
        };
      }

      try {
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
      } finally {
        await upgradeLockManager.release(container.containerId, { ...lockOpts, lockToken });
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

const { resolveBackend } = require("../services/dockerBackendFactory");

module.exports = {
  pullContainers,
  upgradeContainer,
  batchUpgradeContainers,
};
