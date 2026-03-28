/**
 * Container Upgrade Service
 * Handles container upgrade operations
 */

const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const logger = require("../utils/logger");
const nginxProxyManagerService = require("./containerUpgrade/nginxProxyManagerService");
const dependentContainerService = require("./containerUpgrade/dependentContainerService");
const containerReadinessService = require("./containerUpgrade/containerReadinessService");
const containerDetailsService = require("./containerUpgrade/containerDetailsService");
const containerConfigService = require("./containerUpgrade/containerConfigService");
const dependentContainerRestartService = require("./containerUpgrade/dependentContainerRestartService");
const { resolveBackend } = require("./dockerBackendFactory");

const {
  DEFAULT_BLOCKED_PATTERNS: DEFAULT_BLOCKED_IMAGE_PATTERNS,
} = require("../constants/blocklistDefaults");

async function isContainerDisallowed(containerName, imageName, userId) {
  try {
    const { getSetting } = require("../db/settings");
    const raw = await getSetting("disallowed_containers", userId);
    if (raw === null) {
      // No explicit list saved — use image-name default patterns
      const lower = (imageName || "").toLowerCase();
      return DEFAULT_BLOCKED_IMAGE_PATTERNS.some((p) => lower.includes(p));
    }
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) {
      logger.warn("disallowed_containers is not an array", { userId });
      return false;
    }
    return list.map((n) => n.toLowerCase()).includes((containerName || "").toLowerCase());
  } catch (err) {
    logger.warn("Failed to parse disallowed_containers", { error: err?.message, userId });
    return false;
  }
}

/**
 * Upgrade a single container to the latest image version.
 * Works with both Portainer-backed and runner-backed containers.
 *
 * @param {string} portainerUrl - Portainer instance URL (pass null when using runnerId)
 * @param {string|number} endpointId - Docker endpoint ID (pass null when using runnerId)
 * @param {string} containerId - Container ID
 * @param {string} imageName - Full image name (e.g., "nginx:latest")
 * @param {number|null} [userId=null] - User ID for logging and permissions
 * @param {number|null} [runnerId=null] - Runner ID (mutually exclusive with portainerUrl)
 * @returns {Promise<Object>} Upgrade result with success status and details
 * @throws {Error} If upgrade fails
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container upgrade requires comprehensive orchestration logic
async function upgradeSingleContainer(
  portainerUrl,
  endpointId,
  containerId,
  imageName,
  userId = null,
  runnerId = null
) {
  const upgradeStartTime = Date.now();
  let upgradeHistoryData = {
    userId,
    containerId,
    endpointId,
    portainerUrl,
    oldImage: imageName,
    status: "success",
  };

  try {
    // Resolve the Docker backend (Portainer or runner).
    const backend = await resolveBackend(userId, { portainerUrl, endpointId, runnerId });
    const isRunnerBackend = backend.type === "runner";

    // Populate upgrade history with backend context.
    if (isRunnerBackend) {
      upgradeHistoryData.runnerId = backend.runnerId;
      upgradeHistoryData.runnerName = backend.instanceName;
      upgradeHistoryData.portainerUrl = null;
      upgradeHistoryData.endpointId = null;
    }

    // nginx-proxy-manager IP fallback is only relevant for Portainer backends.
    const isNginxProxyManager =
      !isRunnerBackend && nginxProxyManagerService.isNginxProxyManager(imageName);

    let workingPortainerUrl = portainerUrl;
    if (isNginxProxyManager) {
      const { workingUrl } = await nginxProxyManagerService.getIpBasedPortainerUrl(portainerUrl);
      workingPortainerUrl = workingUrl;
      logger.info(
        "Skipping pre-authentication for nginx upgrade - will authenticate on first API call",
        { ipUrl: workingPortainerUrl, originalUrl: portainerUrl }
      );
    }

    // Fetch container details.
    let containerDetails, workingContainerId;
    if (isRunnerBackend) {
      // Runner: call the full-inspect endpoint directly — no Portainer auth or IP fallback needed.
      containerDetails = await backend.service.getContainerDetails(
        backend.url,
        null,
        containerId,
        backend.apiKey
      );
      workingContainerId = containerId;
    } else {
      // Portainer: existing path with auth retry, IP fallback, and ID normalization.
      ({ containerDetails, workingContainerId } =
        await containerDetailsService.getContainerDetailsWithNormalization(
          portainerUrl,
          workingPortainerUrl,
          endpointId,
          containerId,
          isNginxProxyManager,
          userId
        ));
    }

    // Preserve the original container name (important for stacks)
    const originalContainerName = containerDetails.Name;
    const cleanContainerName = originalContainerName.replace(/^\//, "");

    // Check if container is in the upgrade blocklist
    if (await isContainerDisallowed(cleanContainerName, imageName, userId)) {
      throw new Error(
        `Container "${cleanContainerName}" is in the upgrade blocklist and cannot be upgraded`
      );
    }

    // Record backend instance info for upgrade history.
    if (!isRunnerBackend && userId) {
      upgradeHistoryData.sourceInstanceId = backend.instanceId;
      upgradeHistoryData.sourceInstanceName = backend.instanceName;
    }

    // Resolve effective URLs for Portainer nginx-fallback cases.
    // For runner backends these are just the backend URL (no IP fallback needed).
    const effectiveUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl || backend.url;
    const effectiveEndpointId = isRunnerBackend ? null : endpointId;

    // Get old digest from container details
    let oldDigest = null;
    try {
      oldDigest = await dockerRegistryService.getCurrentImageDigest(
        containerDetails,
        imageName,
        effectiveUrl,
        effectiveEndpointId,
        userId // Pass userId for database-assisted digest matching
      );
    } catch (err) {
      logger.debug("Could not get old digest for upgrade history:", err);
    }

    // Extract current and new image info
    // Remove @sha256 digest suffix if present before parsing
    let cleanImageName = imageName;
    if (cleanImageName.includes("@sha256")) {
      cleanImageName = cleanImageName.split("@sha256")[0];
    }
    const imageParts = cleanImageName.includes(":")
      ? cleanImageName.split(":")
      : [cleanImageName, "latest"];
    const imageRepo = imageParts[0];
    const currentTag = imageParts[1];

    // Use the current tag for upgrades (to get the latest version of that tag)
    const newTag = currentTag;
    const newImageName = `${imageRepo}:${newTag}`;

    // Update upgrade history data
    upgradeHistoryData.containerName = cleanContainerName;
    upgradeHistoryData.oldDigest = oldDigest;
    upgradeHistoryData.imageRepo = imageRepo;

    logger.info("Starting container upgrade", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      containerId: containerId.substring(0, 12),
      portainerUrl: workingPortainerUrl,
      endpointId,
      currentImage: imageName,
      newImage: newImageName,
      usingIpFallback: isNginxProxyManager,
    });

    // CRITICAL: Find and stop dependent containers BEFORE removing the main container
    // Containers using network_mode: service:containerName will break if we remove
    // the main container while they're still running (they reference the old container ID)
    const dependentContainersToStop = await dependentContainerService.findDependentContainers(
      effectiveUrl,
      effectiveEndpointId,
      workingContainerId,
      cleanContainerName,
      backend
    );

    if (dependentContainersToStop.length > 0) {
      await dependentContainerService.stopAndRemoveDependentContainers(
        backend.url,
        effectiveEndpointId,
        dependentContainersToStop,
        backend
      );
    }

    // Stop the container
    logger.info("Stopping container", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      containerId: workingContainerId.substring(0, 12),
    });
    await backend.service.stopContainer(
      backend.url,
      effectiveEndpointId,
      workingContainerId,
      backend.apiKey ?? userId
    );

    // Wait for container to fully stop (important for databases and services)
    const checkStatusUrl = isNginxProxyManager ? workingPortainerUrl : backend.url;
    await containerReadinessService.waitForContainerStop({
      portainerUrl: checkStatusUrl,
      endpointId: effectiveEndpointId,
      containerId: workingContainerId,
      containerName: originalContainerName,
      backend,
    });

    // Pull the latest image
    const pullImageUrl = isNginxProxyManager ? workingPortainerUrl : backend.url;
    const pullImageOriginalUrl = isNginxProxyManager ? portainerUrl : null;
    logger.info("Pulling latest image", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      image: newImageName,
      usingUrl: pullImageUrl,
    });
    await backend.service.pullImage(
      pullImageUrl,
      effectiveEndpointId,
      newImageName,
      pullImageOriginalUrl,
      backend.apiKey ?? userId
    );

    // Remove old container
    logger.info("Removing old container", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      containerId: workingContainerId.substring(0, 12),
    });
    await backend.service.removeContainer(
      isNginxProxyManager ? workingPortainerUrl : backend.url,
      effectiveEndpointId,
      workingContainerId,
      backend.apiKey ?? userId
    );

    // Prepare container configuration using the service
    logger.info("Creating new container", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      image: newImageName,
    });

    const { containerConfig, isSharedNetworkMode, stackName } =
      containerConfigService.prepareContainerConfig(
        containerDetails,
        newImageName,
        originalContainerName
      );

    const createContainerUrl = isNginxProxyManager ? workingPortainerUrl : backend.url;
    let newContainer;
    try {
      newContainer = await backend.service.createContainer(
        createContainerUrl,
        effectiveEndpointId,
        containerConfig,
        originalContainerName,
        backend.apiKey ?? userId
      );
    } catch (error) {
      // Provide more detailed error information
      if (error.response?.status === 400) {
        const errorMessage =
          error.response?.data?.message || error.message || "Invalid container configuration";
        logger.error("Failed to create container - invalid configuration", {
          module: "containerService",
          operation: "upgradeSingleContainer",
          containerName: originalContainerName,
          error: errorMessage,
          errorDetails: error.response?.data,
        });
        throw new Error(
          `Failed to create container: ${errorMessage}. ` +
            `This may be due to invalid network configuration, port conflicts, or other container settings. ` +
            `Please check the container configuration in Portainer.`
        );
      }
      throw error;
    }

    // If using network_mode, don't start yet - wait for tunnel and start with other containers
    let startTime; // Declare outside the if block so it's accessible later
    if (!isSharedNetworkMode) {
      // Start the new container
      const startContainerUrl = isNginxProxyManager ? workingPortainerUrl : backend.url;
      logger.info("Starting new container", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        containerName: originalContainerName,
        newContainerId: newContainer.Id.substring(0, 12),
        usingUrl: startContainerUrl,
      });
      await backend.service.startContainer(
        startContainerUrl,
        effectiveEndpointId,
        newContainer.Id,
        backend.apiKey ?? userId
      );

      // Wait for container to be healthy/ready (CRITICAL for databases)
      startTime = Date.now();
      await containerReadinessService.waitForContainerReady({
        portainerUrl: isNginxProxyManager ? workingPortainerUrl : backend.url,
        endpointId: effectiveEndpointId,
        containerId: newContainer.Id,
        containerName: originalContainerName,
        imageName,
        backend,
      });
    }

    if (!isSharedNetworkMode) {
      logger.info("Container upgrade completed and container is ready", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        containerName: originalContainerName,
        totalWaitTime: `${(Date.now() - startTime) / 1000}s`,
      });
    } else {
      logger.info("Container created (using network_mode - will start after tunnel is ready)", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        containerName: originalContainerName,
        newContainerId: newContainer.Id.substring(0, 12),
      });
    }

    // Find and restart dependent containers
    // This handles containers that depend on the upgraded container via:
    // 1. network_mode: service:containerName
    // 2. depends_on relationships (containers in the same stack)
    try {
      await dependentContainerRestartService.restartDependentContainers({
        portainerUrl: backend.url,
        workingPortainerUrl: isNginxProxyManager ? workingPortainerUrl : backend.url,
        endpointId: effectiveEndpointId,
        newContainer,
        cleanContainerName,
        originalContainerId: containerDetails.Id,
        stackName,
        backend,
      });
    } catch (err) {
      logger.error("  Error restarting dependent containers:", { error: err });
      // Don't fail the upgrade if dependent restart fails
    }

    // If this container uses network_mode (service:* or container:*), restart all containers
    // that use the same network container (including itself). This ensures they all reconnect properly.
    if (isSharedNetworkMode) {
      const networkMode = containerDetails.HostConfig?.NetworkMode || "";
      const networkContainerName = networkMode.startsWith("service:")
        ? networkMode.replace("service:", "")
        : networkMode.replace("container:", "");

      logger.info(
        ` Container uses shared network mode (${networkMode}), restarting all containers using the same network...`,
        {
          module: "containerService",
          operation: "upgradeSingleContainer",
          containerName: originalContainerName,
          networkContainerName,
        }
      );

      try {
        // Wait a moment for the network container to be fully ready
        await new Promise((resolve) => {
          setTimeout(resolve, 3000);
        });

        // Get all containers that use the same network container (including the upgraded container)
        const allContainers = await backend.service.getContainers(
          isNginxProxyManager ? workingPortainerUrl : backend.url,
          effectiveEndpointId,
          backend.apiKey
        );
        const containersToStart = [];

        for (const container of allContainers) {
          try {
            const details = await backend.service.getContainerDetails(
              backend.url,
              effectiveEndpointId,
              container.Id,
              backend.apiKey
            );
            const containerNetworkMode = details.HostConfig?.NetworkMode || "";
            if (!containerNetworkMode) {
              continue;
            }

            let targetContainerName = null;
            if (containerNetworkMode.startsWith("service:")) {
              targetContainerName = containerNetworkMode.replace("service:", "");
            } else if (containerNetworkMode.startsWith("container:")) {
              targetContainerName = containerNetworkMode.replace("container:", "");
            }

            // Check if this container uses the same network container
            if (targetContainerName !== networkContainerName) {
              continue;
            }

            const containerStatus =
              details.State?.Status || (details.State?.Running ? "running" : "exited");
            // Include the new container (which is created but not started) and running containers (to restart)
            const shouldIncludeContainer =
              container.Id === newContainer.Id || containerStatus === "running";
            if (shouldIncludeContainer) {
              containersToStart.push({
                id: container.Id,
                name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
                isNewContainer: container.Id === newContainer.Id,
              });
            }
          } catch (err) {
            logger.warn(`Error getting container details for ${container.Id}:`, err);
          }
        }

        // Start all containers that use the same network (including the newly created one)
        if (containersToStart.length > 0) {
          logger.info(
            `   Found ${containersToStart.length} container(s) using the same network, starting...`
          );
          for (const container of containersToStart) {
            try {
              const isNewContainer = container.isNewContainer;
              if (isNewContainer) {
                logger.info(
                  `   Starting ${container.name} (newly created) to connect to network container...`
                );
                await backend.service.startContainer(
                  backend.url,
                  effectiveEndpointId,
                  container.id,
                  backend.apiKey ?? userId
                );
              } else {
                logger.info(`   Restarting ${container.name} to reconnect to network container...`);
                await backend.service.stopContainer(
                  backend.url,
                  effectiveEndpointId,
                  container.id,
                  backend.apiKey ?? userId
                );
                await new Promise((resolve) => {
                  setTimeout(resolve, 1000);
                }); // Brief wait
                await backend.service.startContainer(
                  backend.url,
                  effectiveEndpointId,
                  container.id,
                  backend.apiKey ?? userId
                );
              }
              logger.info(`    ${container.name} started successfully`);
            } catch (err) {
              logger.error(`     Failed to start ${container.name}: ${err.message}`);
              // Continue with other containers
            }
          }
          logger.info(` All network-dependent containers started`);
        } else {
          // Even if no other containers found, start the upgraded container itself
          logger.info(
            `   No other containers found, starting ${originalContainerName} to connect to network container...`
          );
          try {
            await backend.service.startContainer(
              backend.url,
              effectiveEndpointId,
              newContainer.Id,
              backend.apiKey ?? userId
            );
            logger.info(`    ${originalContainerName} started successfully`);
          } catch (err) {
            logger.error(`     Failed to start ${originalContainerName}: ${err.message}`);
          }
        }
      } catch (err) {
        logger.error(`  Error restarting containers that use network: ${err.message}`);
        // Don't fail the upgrade if this fails
      }
    }

    // Invalidate cache for this image so next check gets fresh data
    dockerRegistryService.clearDigestCache(imageRepo, currentTag);

    // Update normalized tables to mark this container as no longer having an update
    // This ensures the update status persists across app restarts
    try {
      if (userId && imageRepo) {
        const { markRegistryImageUpToDate, getRegistryImageVersion } = require("../db/index");
        // Get the latest digest/version from database (which was the target of the upgrade)
        // Use getRegistryImageVersion instead of deprecated getDockerHubImageVersion
        const versionInfo = await getRegistryImageVersion(userId, imageRepo, currentTag);
        if (versionInfo && versionInfo.latest_digest && versionInfo.latest_version) {
          // Update upgrade history data with new version info
          upgradeHistoryData.newDigest = versionInfo.latest_digest;
          upgradeHistoryData.newVersion = versionInfo.latest_version;
          upgradeHistoryData.oldVersion = currentTag; // We don't have currentVersion in registry_image_versions
          upgradeHistoryData.registry = versionInfo.registry || "docker.io";
          upgradeHistoryData.namespace = versionInfo.namespace || null;
          upgradeHistoryData.repository = versionInfo.repository || imageRepo;

          // Container now has the latest image, so current = latest
          // Pass currentTag to update the correct record in registry_image_versions table
          // This is critical for multi-arch images (like postgres) so the next sync
          // can find the correct "preferred digest" and not show false updates
          await markRegistryImageUpToDate(
            userId,
            imageRepo,
            versionInfo.latest_digest,
            versionInfo.latest_version,
            currentTag
          );

          // Update the container cache with the new digest after upgrade.
          // For Portainer backends: look up the instance ID from the URL.
          // For runner backends: use the runner ID directly.
          const cacheInstanceId = isRunnerBackend ? null : backend.instanceId;
          const cacheRunnerId = isRunnerBackend ? backend.runnerId : null;
          const hasBackendId = isRunnerBackend ? !!cacheRunnerId : !!cacheInstanceId;

          if (hasBackendId) {
            let newContainerDigest = versionInfo.latest_digest;
            try {
              const newContainerDetails = await backend.service.getContainerDetails(
                backend.url,
                effectiveEndpointId,
                newContainer.Id,
                backend.apiKey
              );
              const registryDigest = await dockerRegistryService.getCurrentImageDigest(
                newContainerDetails,
                newImageName,
                backend.url,
                effectiveEndpointId,
                userId
              );
              if (registryDigest) {
                newContainerDigest = registryDigest;
                upgradeHistoryData.newDigest = newContainerDigest;
                logger.debug("Got registry digest from new container after upgrade:", {
                  containerName: originalContainerName,
                  digest: newContainerDigest.substring(0, 12),
                });
              }
            } catch (digestError) {
              logger.debug("Could not get digest from new container, using versionInfo digest:", {
                error: digestError,
              });
            }

            const containerCacheUpdateService = require("./cache/containerCacheUpdateService");
            await containerCacheUpdateService.updateCacheAfterUpgrade(
              userId,
              isRunnerBackend ? null : backend.url,
              newContainer.Id,
              originalContainerName,
              newContainerDigest,
              {
                endpointId: effectiveEndpointId,
                imageName: newImageName,
                imageRepo,
                status: newContainer.State?.Status || containerDetails.State?.Status || null,
                state: newContainer.State?.Status || containerDetails.State?.Status || null,
                stackName:
                  containerDetails.Config?.Labels?.["com.docker.compose.project"] ||
                  containerDetails.Config?.Labels?.["com.docker.stack.namespace"] ||
                  null,
                imageCreatedDate: null,
                usesNetworkMode: false,
                providesNetwork: false,
                runnerId: cacheRunnerId,
              }
            );
          }

          logger.info("Updated normalized tables to mark upgraded container as up-to-date", {
            module: "containerService",
            operation: "upgradeSingleContainer",
            containerName: originalContainerName,
            containerId: containerId.substring(0, 12),
            newContainerId: newContainer.Id.substring(0, 12),
            imageRepo,
            newDigest: versionInfo.latest_digest.substring(0, 12),
            newVersion: versionInfo.latest_version,
          });
        } else {
          logger.warn(
            "Could not find latest version info in database to update normalized tables",
            {
              imageRepo,
            }
          );
        }
      }
    } catch (dbError) {
      // Don't fail the upgrade if database update fails
      logger.warn("Failed to update normalized tables after upgrade:", { error: dbError });
    }

    logger.info(` Upgrade completed successfully for ${originalContainerName}`);

    // Log upgrade to history
    const upgradeDurationMs = Date.now() - upgradeStartTime;
    upgradeHistoryData.newImage = newImageName;
    upgradeHistoryData.upgradeDurationMs = upgradeDurationMs;
    upgradeHistoryData.status = "success";

    if (userId) {
      try {
        logger.debug("Attempting to log upgrade to history:", {
          userId,
          containerName: upgradeHistoryData.containerName,
          oldImage: upgradeHistoryData.oldImage,
          newImage: upgradeHistoryData.newImage,
          hasRequiredFields: !!(
            upgradeHistoryData.userId &&
            upgradeHistoryData.containerId &&
            upgradeHistoryData.containerName &&
            upgradeHistoryData.oldImage &&
            upgradeHistoryData.newImage
          ),
        });
        const { createUpgradeHistory } = require("../db/index");
        const historyId = await createUpgradeHistory(upgradeHistoryData);
        logger.info("Successfully logged upgrade to history:", {
          historyId,
          containerName: upgradeHistoryData.containerName,
        });
      } catch (historyError) {
        // Don't fail the upgrade if history logging fails
        logger.error("Failed to log upgrade to history:", {
          error: historyError,
          errorMessage: historyError.message,
          errorStack: historyError.stack,
          upgradeHistoryData,
        });
      }
    }

    return {
      success: true,
      containerId,
      containerName: originalContainerName.replace("/", ""),
      newContainerId: newContainer.Id,
      oldImage: imageName,
      newImage: newImageName,
    };
  } catch (error) {
    // Log failed upgrade to history
    const upgradeDurationMs = Date.now() - upgradeStartTime;
    upgradeHistoryData.status = "failed";
    upgradeHistoryData.errorMessage = error.message || String(error);
    upgradeHistoryData.upgradeDurationMs = upgradeDurationMs;
    upgradeHistoryData.newImage = upgradeHistoryData.newImage || imageName;

    if (userId) {
      try {
        logger.debug("Attempting to log failed upgrade to history:", {
          userId,
          containerName: upgradeHistoryData.containerName,
          status: upgradeHistoryData.status,
        });
        const { createUpgradeHistory } = require("../db/index");
        const historyId = await createUpgradeHistory(upgradeHistoryData);
        logger.info("Successfully logged failed upgrade to history:", {
          historyId,
          containerName: upgradeHistoryData.containerName,
        });
      } catch (historyError) {
        logger.error("Failed to log failed upgrade to history:", {
          error: historyError,
          errorMessage: historyError.message,
          upgradeHistoryData,
        });
      }
    }

    // Re-throw the error
    throw error;
  }
}

// Legacy function for batch upgrades - kept for backward compatibility

async function upgradeContainers(
  portainerUrl,
  endpointId,
  containerIds,
  imageName,
  userId = null,
  runnerId = null
) {
  const results = [];
  const errors = [];

  for (const containerId of containerIds) {
    try {
      const result = await upgradeSingleContainer(
        portainerUrl,
        endpointId,
        containerId,
        imageName,
        userId,
        runnerId
      );
      results.push(result);
    } catch (error) {
      errors.push({
        containerId,
        error: error.message,
      });
    }
  }

  return {
    results,
    errors,
  };
}

module.exports = {
  upgradeSingleContainer,
  upgradeContainers,
};
