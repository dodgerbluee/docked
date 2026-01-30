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
 * Check if network mode matches container name
 * @param {string} networkMode - Network mode string
 * @param {string} cleanContainerName - Clean container name
 * @returns {boolean} - True if matches
 */
function matchesNetworkMode(networkMode, cleanContainerName) {
  if (!networkMode) {
    return false;
  }

  let targetContainerRef = null;
  if (networkMode.startsWith("service:")) {
    targetContainerRef = networkMode.replace("service:", "");
  } else if (networkMode.startsWith("container:")) {
    targetContainerRef = networkMode.replace("container:", "");
  } else {
    return false;
  }

  return targetContainerRef === cleanContainerName;
}

/**
 * Process a single container for dependencies
 * @param {Object} container - Container object
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} targetContainerId - Target container ID
 * @param {string} cleanContainerName - Clean container name
 * @returns {Promise<Object|null>} - Dependent container info or null
 */
// eslint-disable-next-line complexity -- Container dependency processing requires multiple conditional checks
async function processContainerForDependency(
  container,
  portainerUrl,
  endpointId,
  targetContainerId,
  cleanContainerName
) {
  if (container.Id === targetContainerId) {
    return null;
  }

  try {
    const details = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      container.Id
    );
    const networkMode = details.HostConfig?.NetworkMode || "";

    if (matchesNetworkMode(networkMode, cleanContainerName)) {
      const containerStatus =
        details.State?.Status || (details.State?.Running ? "running" : "exited");
      if (containerStatus === "running") {
        return {
          id: container.Id,
          name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
        };
      }
    }
    return null;
  } catch (err) {
    logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
    return null;
  }
}

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
  const cleanContainerName = targetContainerName.replace(/^\//, "");

  try {
    logger.debug(" Checking for containers that depend on this container via network_mode...");
    const allContainers = await portainerService.getContainers(portainerUrl, endpointId);
    const dependentContainers = [];

    for (const container of allContainers) {
      const dependent = await processContainerForDependency(
        container,
        portainerUrl,
        endpointId,
        targetContainerId,
        cleanContainerName
      );
      if (dependent) {
        dependentContainers.push(dependent);
      }
    }

    return dependentContainers;
  } catch (err) {
    logger.warn(
      "Could not check for dependent containers before stopping, proceeding anyway:",
      err.message
    );
    return [];
  }
}

/**
 * Stop and remove dependent containers before upgrading the main container
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {Array<Object>} dependentContainers - Array of dependent containers
 * @returns {Promise<void>}
 */
async function stopAndRemoveDependentContainers(portainerUrl, endpointId, dependentContainers) {
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
        logger.debug(`   Container ${container.name} may already be stopped: ${stopErr.message}`);
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
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 3000);
  });
}

/**
 * Check if container is in same stack
 * @param {Object} details - Container details
 * @param {string} stackName - Stack name
 * @returns {boolean} - True if in same stack
 */
function isInSameStack(details, stackName) {
  if (!stackName) {
    return false;
  }

  const containerLabels = details.Config.Labels || {};
  const containerStackName =
    containerLabels["com.docker.compose.project"] ||
    containerLabels["com.docker.stack.namespace"] ||
    null;

  return containerStackName === stackName;
}

/**
 * Process container for restart dependencies
 * @param {Object} params - Parameters object
 * @param {Object} params.container - Container object
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.newContainerId - New container ID
 * @param {string} params.cleanContainerName - Clean container name
 * @param {string} params.stackName - Stack name
 * @returns {Promise<Object|null>} - Container dependency info or null
 */
// eslint-disable-next-line complexity -- Container restart processing requires complex dependency validation
async function processContainerForRestart({
  container,
  portainerUrl,
  endpointId,
  newContainerId,
  cleanContainerName,
  stackName,
}) {
  if (container.Id === newContainerId) {
    return null;
  }

  try {
    const details = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      container.Id
    );
    const containerStatus =
      details.State?.Status || (details.State?.Running ? "running" : "exited");
    const isRunning = containerStatus === "running";
    const isStopped = containerStatus === "exited" || containerStatus === "stopped";

    const networkMode = details.HostConfig?.NetworkMode || "";
    if (matchesNetworkMode(networkMode, cleanContainerName)) {
      return {
        id: container.Id,
        name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
        isRunning,
        isStopped,
        dependencyReason: "network_mode dependency",
        type: "network_mode",
      };
    }

    if (isInSameStack(details, stackName)) {
      return {
        id: container.Id,
        name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
        isRunning,
        isStopped,
        dependencyReason: "stack dependency",
        type: "stack",
      };
    }

    return null;
  } catch (err) {
    logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
    return null;
  }
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
  const cleanContainerName = targetContainerName.replace(/^\//, "");

  try {
    logger.info(` Checking for dependent containers...`);
    const allContainers = await portainerService.getContainers(portainerUrl, endpointId);
    const networkModeContainers = [];
    const otherContainers = [];

    for (const container of allContainers) {
      const dependency = await processContainerForRestart({
        container,
        portainerUrl,
        endpointId,
        newContainerId,
        cleanContainerName,
        stackName,
      });

      if (dependency) {
        if (dependency.type === "network_mode") {
          networkModeContainers.push(dependency);
        } else {
          otherContainers.push(dependency);
        }
      }
    }

    return {
      networkModeContainers,
      otherContainers,
    };
  } catch (err) {
    logger.warn("Could not check for dependent containers, proceeding anyway:", err.message);
    return {
      networkModeContainers: [],
      otherContainers: [],
    };
  }
}

module.exports = {
  findDependentContainers,
  stopAndRemoveDependentContainers,
  findContainersToRestart,
};
