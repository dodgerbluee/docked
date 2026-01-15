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

/**
 * Upgrade a single container to the latest image version
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Docker endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} imageName - Full image name (e.g., "nginx:latest")
 * @param {number|null} [userId=null] - User ID for logging and permissions
 * @returns {Promise<Object>} Upgrade result with success status and details
 * @throws {Error} If upgrade fails
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container upgrade requires comprehensive orchestration logic
async function upgradeSingleContainer(
  portainerUrl,
  endpointId,
  containerId,
  imageName,
  userId = null
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
  // Detect if this is nginx-proxy-manager EARLY (before fetching container details)
  // We can detect by image name, which is available before fetching container details
  // If nginx goes down, this app's UI becomes unavailable, so we need to use IP addresses
  // to ensure Portainer API calls still work during the upgrade
  const isNginxProxyManager = nginxProxyManagerService.isNginxProxyManager(imageName);

  // If it's nginx-proxy-manager, get IP address and use it for all Portainer calls
  let workingPortainerUrl = portainerUrl;
  if (isNginxProxyManager) {
    const { workingUrl } = await nginxProxyManagerService.getIpBasedPortainerUrl(portainerUrl);
    workingPortainerUrl = workingUrl;

    // Note: We don't pre-authenticate here because:
    // 1. Nginx is still up at this point, so original URL works
    // 2. Portainer might reject IP-based auth requests even with correct Host header
    // 3. Authentication will happen naturally on first API call when nginx goes down
    // 4. The containerDetailsService will handle authentication retries
    logger.info(
      "Skipping pre-authentication for nginx upgrade - will authenticate on first API call",
      {
        ipUrl: workingPortainerUrl,
        originalUrl: portainerUrl,
      }
    );
  }

  // Fetch container details using the service (handles retry, authentication, ID normalization)
  const { containerDetails, workingContainerId } =
    await containerDetailsService.getContainerDetailsWithNormalization(
      portainerUrl,
      workingPortainerUrl,
      endpointId,
      containerId,
      isNginxProxyManager
    );

  // Preserve the original container name (important for stacks)
  const originalContainerName = containerDetails.Name;
  const cleanContainerName = originalContainerName.replace(/^\//, "");

  // Get Portainer instance info for upgrade history
  let portainerInstanceId = null;
  let portainerInstanceName = null;
  if (userId) {
    try {
      const { getAllPortainerInstances } = require("../db/index");
      const instances = await getAllPortainerInstances(userId);
      const instance = instances.find((inst) => inst.url === portainerUrl);
      if (instance) {
        portainerInstanceId = instance.id;
        portainerInstanceName = instance.name;
        upgradeHistoryData.portainerInstanceId = portainerInstanceId;
        upgradeHistoryData.portainerInstanceName = portainerInstanceName;
      }
    } catch (err) {
      logger.debug("Could not get Portainer instance info for upgrade history:", err);
    }
  }

  // Get old digest from container details
  let oldDigest = null;
  try {
    oldDigest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
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
  const imageParts = cleanImageName.includes(":") ? cleanImageName.split(":") : [cleanImageName, "latest"];
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
    workingPortainerUrl,
    endpointId,
    workingContainerId,
    cleanContainerName
  );

  if (dependentContainersToStop.length > 0) {
    await dependentContainerService.stopAndRemoveDependentContainers(
      portainerUrl,
      endpointId,
      dependentContainersToStop
    );
  }

  // Stop the container
  logger.info("Stopping container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    containerId: workingContainerId.substring(0, 12),
  });
  await portainerService.stopContainer(portainerUrl, endpointId, workingContainerId);

  // Wait for container to fully stop (important for databases and services)
  // For nginx upgrades, use IP URL directly after stop (nginx is down now)
  const checkStatusUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  await containerReadinessService.waitForContainerStop({
    portainerUrl: checkStatusUrl,
    endpointId,
    containerId: workingContainerId,
    containerName: originalContainerName,
  });

  // Pull the latest image
  // For nginx upgrades, use IP URL directly (nginx is down now)
  // Pass original URL for authentication lookup
  const pullImageUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  const pullImageOriginalUrl = isNginxProxyManager ? portainerUrl : null;
  logger.info("Pulling latest image", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    image: newImageName,
    usingUrl: pullImageUrl,
    originalUrl: pullImageOriginalUrl,
  });
  await portainerService.pullImage(pullImageUrl, endpointId, newImageName, pullImageOriginalUrl);

  // Remove old container
  // For nginx upgrades, use IP URL directly (nginx is down now)
  const removeContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  logger.info("Removing old container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    containerId: workingContainerId.substring(0, 12),
    usingUrl: removeContainerUrl,
  });
  await portainerService.removeContainer(removeContainerUrl, endpointId, workingContainerId);

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

  // Pass container name as separate parameter (Docker API uses it as query param)
  // For nginx upgrades, use IP URL directly (nginx is down now)
  const createContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  let newContainer;
  try {
    newContainer = await portainerService.createContainer(
      createContainerUrl,
      endpointId,
      containerConfig,
      originalContainerName
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
    // For nginx upgrades, use IP URL directly (nginx is still down)
    const startContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
    logger.info("Starting new container", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      newContainerId: newContainer.Id.substring(0, 12),
      usingUrl: startContainerUrl,
    });
    await portainerService.startContainer(startContainerUrl, endpointId, newContainer.Id);

    // Wait for container to be healthy/ready (CRITICAL for databases)
    startTime = Date.now();
    await containerReadinessService.waitForContainerReady({
      portainerUrl: workingPortainerUrl,
      endpointId,
      containerId: newContainer.Id,
      containerName: originalContainerName,
      imageName,
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
      portainerUrl,
      workingPortainerUrl,
      endpointId,
      newContainer,
      cleanContainerName,
      originalContainerId: containerDetails.Id,
      stackName,
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
      const allContainers = await portainerService.getContainers(workingPortainerUrl, endpointId);
      const containersToStart = [];

      for (const container of allContainers) {
        try {
          const details = await portainerService.getContainerDetails(
            portainerUrl,
            endpointId,
            container.Id
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
              await portainerService.startContainer(portainerUrl, endpointId, container.id);
            } else {
              logger.info(`   Restarting ${container.name} to reconnect to network container...`);
              await portainerService.stopContainer(portainerUrl, endpointId, container.id);
              await new Promise((resolve) => {
                setTimeout(resolve, 1000);
              }); // Brief wait
              await portainerService.startContainer(portainerUrl, endpointId, container.id);
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
          await portainerService.startContainer(portainerUrl, endpointId, newContainer.Id);
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
      const {
        markDockerHubImageUpToDate,
        getDockerHubImageVersion,
        getAllPortainerInstances,
        upsertContainerWithVersion,
      } = require("../db/index");
      // Get the latest digest/version from database (which was the target of the upgrade)
      // Pass currentTag to get the correct record for this specific tag
      const versionInfo = await getDockerHubImageVersion(userId, imageRepo, currentTag);
      if (versionInfo && versionInfo.latestDigest && versionInfo.latestVersion) {
        // Update upgrade history data with new version info
        upgradeHistoryData.newDigest = versionInfo.latestDigest;
        upgradeHistoryData.newVersion = versionInfo.latestVersion;
        upgradeHistoryData.oldVersion = versionInfo.currentVersion || currentTag;
        upgradeHistoryData.registry = versionInfo.registry || "docker.io";
        upgradeHistoryData.namespace = versionInfo.namespace || null;
        upgradeHistoryData.repository = versionInfo.repository || imageRepo;

        // Container now has the latest image, so current = latest
        // Pass currentTag to update the correct record
        await markDockerHubImageUpToDate(
          userId,
          imageRepo,
          versionInfo.latestDigest,
          versionInfo.latestVersion,
          currentTag
        );

        // Also update portainer_containers table with the new current digest
        // Find the Portainer instance ID for this URL
        const instances = await getAllPortainerInstances(userId);
        const instance = instances.find((inst) => inst.url === portainerUrl);
        if (instance && instance.id) {
          // Get the new container's digest (from the newly created container)
          let newContainerDigest = versionInfo.latestDigest;
          try {
            // Try to get the actual digest from the new container
            const newContainerDetails = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              newContainer.Id
            );
            const imageId = newContainerDetails.Image || "";
            const hasValidDigest = imageId && imageId.startsWith("sha256:");
            if (hasValidDigest) {
              newContainerDigest = imageId;
              upgradeHistoryData.newDigest = newContainerDigest;
            }
          } catch (digestError) {
            // If we can't get the digest from container, use the one from versionInfo
            logger.debug("Could not get digest from new container, using versionInfo digest:", {
              error: digestError,
            });
          }

          // Update the container cache with the new digest after upgrade
          // This ensures subsequent fetches show the correct hasUpdate status
          const containerCacheUpdateService = require("./cache/containerCacheUpdateService");

          await containerCacheUpdateService.updateCacheAfterUpgrade(
            userId,
            portainerUrl,
            newContainer.Id,
            originalContainerName,
            newContainerDigest,
            {
              endpointId,
              imageName: newImageName,
              imageRepo,
              status: newContainer.State?.Status || containerDetails.State?.Status || null,
              state: newContainer.State?.Status || containerDetails.State?.Status || null,
              stackName:
                containerDetails.Config?.Labels?.["com.docker.compose.project"] ||
                containerDetails.Config?.Labels?.["com.docker.stack.namespace"] ||
                null,
              imageCreatedDate: null, // Will be updated on next pull
              usesNetworkMode: false, // Will be updated on next pull
              providesNetwork: false, // Will be updated on next pull
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
          newDigest: versionInfo.latestDigest.substring(0, 12),
          newVersion: versionInfo.latestVersion,
        });
      } else {
        logger.warn("Could not find latest version info in database to update normalized tables", {
          imageRepo,
        });
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
      const { createUpgradeHistory } = require("../db/index");
      await createUpgradeHistory(upgradeHistoryData);
    } catch (historyError) {
      // Don't fail the upgrade if history logging fails
      logger.warn("Failed to log upgrade to history:", { error: historyError });
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
        const { createUpgradeHistory } = require("../db/index");
        await createUpgradeHistory(upgradeHistoryData);
      } catch (historyError) {
        logger.warn("Failed to log failed upgrade to history:", { error: historyError });
      }
    }

    // Re-throw the error
    throw error;
  }
}

// Legacy function for batch upgrades - kept for backward compatibility

async function upgradeContainers(portainerUrl, endpointId, containerIds, imageName, userId = null) {
  const results = [];
  const errors = [];

  for (const containerId of containerIds) {
    try {
      const result = await upgradeSingleContainer(
        portainerUrl,
        endpointId,
        containerId,
        imageName,
        userId
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
