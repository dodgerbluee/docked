/**
 * Dependent Container Service
 * 
 * Handles finding, stopping, and restarting containers that depend on
 * the container being upgraded (via network_mode or stack relationships).
 * Extracted from containerUpgradeService to improve modularity.
 */

const logger = require("../../utils/logger");
const portainerService = require("../portainerService");

/**
 * Find containers that depend on the target container via network_mode
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} targetContainerId - Container ID being upgraded
 * @param {string} targetContainerName - Container name being upgraded
 * @returns {Promise<Array<Object>>} - Array of dependent containers with id and name
 */
async function findDependentContainers(
  portainerUrl,
  endpointId,
  targetContainerId,
  targetContainerName
) {
  const dependentContainers = [];
  const cleanContainerName = targetContainerName.replace(/^\//, "");

  try {
    logger.info(" Checking for containers that depend on this container via network_mode...");
    const allContainers = await portainerService.getContainers(portainerUrl, endpointId);

    for (const container of allContainers) {
      if (container.Id === targetContainerId) {
        continue; // Skip the one we're upgrading
      }

      try {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );

        // Check if this container uses network_mode: service:containerName or container:containerName
        const networkMode = details.HostConfig?.NetworkMode || "";
        if (networkMode) {
          let targetContainerName = null;
          if (networkMode.startsWith("service:")) {
            targetContainerName = networkMode.replace("service:", "");
          } else if (networkMode.startsWith("container:")) {
            targetContainerName = networkMode.replace("container:", "");
          }
          if (targetContainerName === cleanContainerName) {
            const containerStatus =
              details.State?.Status || (details.State?.Running ? "running" : "exited");
            if (containerStatus === "running") {
              dependentContainers.push({
                id: container.Id,
                name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              });
            }
          }
        }
      } catch (err) {
        // Skip containers we can't inspect
        logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
        continue;
      }
    }
  } catch (err) {
    logger.warn(
      "Could not check for dependent containers before stopping, proceeding anyway:",
      err.message
    );
  }

  return dependentContainers;
}

/**
 * Stop and remove dependent containers before upgrading the main container
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {Array<Object>} dependentContainers - Array of dependent containers
 * @returns {Promise<void>}
 */
async function stopAndRemoveDependentContainers(
  portainerUrl,
  endpointId,
  dependentContainers
) {
  if (dependentContainers.length === 0) {
    return;
  }

  // CRITICAL: Remove dependent containers BEFORE removing the main container
  // We must REMOVE them (not just stop) to prevent Docker Compose from auto-recreating them
  // with the old tunnel container ID from docker-compose.yml
  logger.info(
    `Removing ${dependentContainers.length} dependent container(s) before upgrading main container...`
  );
  logger.info(
    `     Removing (not just stopping) to prevent Docker Compose auto-recreation with old config`
  );

  for (const container of dependentContainers) {
    try {
      logger.info(
        `   Removing ${container.name} (uses network_mode pointing to main container)...`
      );
      // Stop first, then remove
      try {
        await portainerService.stopContainer(portainerUrl, endpointId, container.id);
        logger.info(`    ${container.name} stopped`);
      } catch (stopErr) {
        logger.debug(
          `   Container ${container.name} may already be stopped: ${stopErr.message}`
        );
      }

      // Now remove it completely
      await portainerService.removeContainer(portainerUrl, endpointId, container.id);
      logger.info(`    ${container.name} removed`);
    } catch (err) {
      logger.warn(`     Failed to remove ${container.name}:`, { error: err });
      // Continue anyway - we'll try to recreate them later
    }
  }

  // Wait a moment for containers to be fully removed and Docker to clean up
  logger.info("Waiting for dependent containers to be fully removed...");
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

/**
 * Find containers that should be restarted after upgrade
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID
 * @param {string} targetContainerName - Container name
 * @param {string} stackName - Stack name (if part of stack)
 * @returns {Promise<{networkModeContainers: Array, otherContainers: Array}>} - Dependent containers grouped by type
 */
async function findContainersToRestart(
  portainerUrl,
  endpointId,
  newContainerId,
  targetContainerName,
  stackName
) {
  const networkModeContainers = [];
  const otherContainers = [];
  const cleanContainerName = targetContainerName.replace(/^\//, "");

  try {
    logger.info(` Checking for dependent containers...`);
    const allContainers = await portainerService.getContainers(portainerUrl, endpointId);

    for (const container of allContainers) {
      if (container.Id === newContainerId) {
        continue; // Skip the one we just upgraded
      }

      try {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );

        // Check if container is running or stopped (we'll restart stopped ones too if they depend on us)
        const containerStatus =
          details.State?.Status || (details.State?.Running ? "running" : "exited");
        const isRunning = containerStatus === "running";
        const isStopped = containerStatus === "exited" || containerStatus === "stopped";

        // Check if this container uses network_mode: service:containerName or container:containerName
        const networkMode = details.HostConfig?.NetworkMode || "";
        if (networkMode) {
          let targetContainerName = null;
          if (networkMode.startsWith("service:")) {
            targetContainerName = networkMode.replace("service:", "");
          } else if (networkMode.startsWith("container:")) {
            targetContainerName = networkMode.replace("container:", "");
          }
          if (targetContainerName === cleanContainerName) {
            networkModeContainers.push({
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              isRunning: isRunning,
              isStopped: isStopped,
              dependencyReason: "network_mode dependency",
            });
          }
        }

        // Check if container is in the same stack (depends_on relationship)
        const containerLabels = details.Config.Labels || {};
        const containerStackName =
          containerLabels["com.docker.compose.project"] ||
          containerLabels["com.docker.stack.namespace"] ||
          null;
        if (stackName && containerStackName === stackName) {
          otherContainers.push({
            id: container.Id,
            name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
            isRunning: isRunning,
            isStopped: isStopped,
            dependencyReason: "stack dependency",
          });
        }
      } catch (err) {
        logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
        continue;
      }
    }
  } catch (err) {
    logger.warn("Could not check for dependent containers, proceeding anyway:", err.message);
  }

  return {
    networkModeContainers,
    otherContainers,
  };
}

module.exports = {
  findDependentContainers,
  stopAndRemoveDependentContainers,
  findContainersToRestart,
};

