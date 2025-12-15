/**
 * Dependent Container Restart Service
 *
 * Handles finding and restarting containers that depend on an upgraded container
 * after the upgrade is complete. This includes:
 * - Finding dependent containers (network_mode and stack relationships)
 * - Waiting for upgraded container to be healthy
 * - Recreating containers that use network_mode (they need new network references)
 * - Restarting other dependent containers (stack-based)
 * Extracted from containerUpgradeService to improve modularity.
 */
/* eslint-disable max-lines -- Large service file with comprehensive dependent container management */

const logger = require("../../utils/logger");
const portainerService = require("../portainerService");

/**
 * Check if network mode matches container
 * @param {string} networkMode - Network mode string
 * @param {string} cleanContainerName - Clean container name
 * @param {string} originalContainerId - Original container ID
 * @param {string} newContainerId - New container ID
 * @returns {Object} - { matches: boolean, reason: string }
 */
// eslint-disable-next-line complexity -- Network mode matching requires multiple conditional checks
function checkNetworkModeMatch(
  networkMode,
  cleanContainerName,
  originalContainerId,
  newContainerId
) {
  if (!networkMode) {
    return { matches: false, reason: "" };
  }

  let targetContainerRef = null;
  if (networkMode.startsWith("service:")) {
    targetContainerRef = networkMode.replace("service:", "");
  } else if (networkMode.startsWith("container:")) {
    targetContainerRef = networkMode.replace("container:", "");
  } else {
    return { matches: false, reason: "" };
  }

  const matchesByName = targetContainerRef === cleanContainerName;
  const matchesByOldId =
    targetContainerRef &&
    targetContainerRef.length === 64 &&
    /^[0-9a-f]{64}$/i.test(targetContainerRef) &&
    targetContainerRef === originalContainerId;
  const matchesByNewId =
    targetContainerRef &&
    targetContainerRef.length === 64 &&
    /^[0-9a-f]{64}$/i.test(targetContainerRef) &&
    targetContainerRef === newContainerId;

  if (matchesByName || matchesByOldId || matchesByNewId) {
    const matchType = matchesByName ? "name" : matchesByNewId ? "new ID" : "old ID";
    return { matches: true, reason: "network_mode", matchType };
  }

  return { matches: false, reason: "" };
}

/**
 * Check if container is in same stack
 * @param {Object} details - Container details
 * @param {string} stackName - Stack name
 * @param {boolean} isRunning - Whether container is running
 * @param {boolean} isStopped - Whether container is stopped
 * @returns {boolean} - True if in same stack and should be restarted
 */
function checkStackDependency(details, stackName, isRunning, isStopped) {
  if (!stackName) {
    return false;
  }

  const containerStackName =
    details.Config.Labels?.["com.docker.compose.project"] ||
    details.Config.Labels?.["com.docker.stack.namespace"] ||
    null;

  return containerStackName === stackName && (isRunning || isStopped);
}

/**
 * Process a single container for dependencies
 * @param {Object} params - Parameters object
 * @param {Object} params.container - Container object
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.newContainerId - New container ID
 * @param {string} params.cleanContainerName - Clean container name
 * @param {string} params.originalContainerId - Original container ID
 * @param {string|null} params.stackName - Stack name
 * @returns {Promise<Object|null>} - Dependent container info or null
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container dependency processing requires comprehensive validation
async function processContainerForDependencies({
  container,
  portainerUrl,
  endpointId,
  newContainerId,
  cleanContainerName,
  originalContainerId,
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
    const networkMatch = checkNetworkModeMatch(
      networkMode,
      cleanContainerName,
      originalContainerId,
      newContainerId
    );

    if (networkMatch.matches) {
      logger.info(
        `    Found network_mode dependency: ${container.Names[0]?.replace("/", "")} -> ${cleanContainerName} (NetworkMode: ${networkMode.substring(0, 50)}..., matched by ${networkMatch.matchType})`
      );
      return {
        id: container.Id,
        name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
        isRunning,
        isStopped,
        dependencyReason: networkMatch.reason,
      };
    }

    if (checkStackDependency(details, stackName, isRunning, isStopped)) {
      return {
        id: container.Id,
        name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
        isRunning,
        isStopped,
        dependencyReason: "stack",
      };
    }

    return null;
  } catch (err) {
    logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
    return null;
  }
}

/**
 * Find containers that depend on the upgraded container after upgrade
 * This is different from finding containers before upgrade - we need to check
 * against the new container ID and find containers that need to be restarted
 * @param {Object} params - Parameters object
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.newContainerId - New container ID (after upgrade)
 * @param {string} params.cleanContainerName - Clean container name (without leading slash)
 * @param {string} params.originalContainerId - Original container ID (before upgrade)
 * @param {string|null} params.stackName - Stack name if container is part of a stack
 * @returns {Promise<Array<Object>>} - Array of dependent containers with id, name, isRunning, isStopped, dependencyReason
 */
async function findDependentContainersAfterUpgrade({
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  newContainerId,
  cleanContainerName,
  originalContainerId,
  stackName,
}) {
  try {
    const allContainers = await portainerService.getContainers(workingPortainerUrl, endpointId);
    const dependentContainers = [];

    for (const container of allContainers) {
      const dependent = await processContainerForDependencies({
        container,
        portainerUrl,
        endpointId,
        newContainerId,
        cleanContainerName,
        originalContainerId,
        stackName,
      });
      if (dependent) {
        dependentContainers.push(dependent);
      }
    }

    return dependentContainers;
  } catch (err) {
    logger.error("Error finding dependent containers:", { error: err });
    throw err;
  }
}

/**
 * Wait for upgraded container to be healthy before restarting dependents
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container health waiting requires comprehensive validation logic
async function waitForUpgradedContainerHealth(workingPortainerUrl, endpointId, newContainerId) {
  try {
    const newContainerDetails = await portainerService.getContainerDetails(
      workingPortainerUrl,
      endpointId,
      newContainerId
    );
    if (newContainerDetails.State?.Health) {
      const healthStatus = newContainerDetails.State.Health.Status;
      if (healthStatus === "starting" || healthStatus === "none") {
        logger.info(
          "Waiting for upgraded container health check to pass before restarting dependents..."
        );
        // Wait up to 30 seconds for health check to pass
        let healthReady = false;
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => {
            setTimeout(() => {
              resolve();
            }, 2000);
          });
          const currentDetails = await portainerService.getContainerDetails(
            workingPortainerUrl,
            endpointId,
            newContainerId
          );
          const currentHealth = currentDetails.State?.Health?.Status;
          const isHealthy = currentHealth === "healthy";
          if (isHealthy) {
            healthReady = true;
            logger.info("Upgraded container is now healthy");
            break;
          }
        }
        if (!healthReady) {
          logger.warn(
            "Upgraded container health check not ready, but proceeding with dependent restarts"
          );
        }
      } else if (healthStatus === "healthy") {
        logger.info("Upgraded container is already healthy");
      }
    } else {
      // No health check, wait a brief moment for container to stabilize
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 2000);
      });
    }
  } catch (err) {
    logger.warn("Could not check upgraded container health, proceeding anyway:", {
      error: err,
    });
    // Wait a brief moment anyway
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 2000);
    });
  }
}

/**
 * Verify the upgraded container is running and accessible
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID
 * @param {string} cleanContainerName - Clean container name
 * @returns {Promise<{verifiedName: string, isRunning: boolean}>}
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container verification requires comprehensive validation logic
async function verifyUpgradedContainer(
  workingPortainerUrl,
  endpointId,
  newContainerId,
  cleanContainerName
) {
  try {
    const verifiedNewContainerDetails = await portainerService.getContainerDetails(
      workingPortainerUrl,
      endpointId,
      newContainerId
    );
    const verifiedName = verifiedNewContainerDetails.Name?.replace("/", "") || cleanContainerName;

    const containerState = verifiedNewContainerDetails.State?.Status || "";
    const tunnelIsRunning = containerState === "running";

    logger.info(
      `    Verified network container: name=${verifiedName}, ID=${newContainerId.substring(0, 12)}..., running=${tunnelIsRunning}`
    );

    // If not running, wait a bit and check again
    if (!tunnelIsRunning) {
      logger.warn(`     Network container ${verifiedName} is not running, waiting...`);
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 3000);
      });

      const recheckDetails = await portainerService.getContainerDetails(
        workingPortainerUrl,
        endpointId,
        newContainerId
      );
      const recheckState = recheckDetails.State?.Status || "";
      const isRunning = recheckState === "running";

      if (isRunning) {
        logger.info(`    Network container ${verifiedName} is now running`);
      } else {
        logger.error(`    Network container ${verifiedName} is still not running!`);
      }

      if (!isRunning) {
        throw new Error(
          `Network container ${verifiedName} is not running. Cannot create dependent containers.`
        );
      }

      return { verifiedName, isRunning: true };
    }

    return { verifiedName, isRunning: tunnelIsRunning };
  } catch (verifyErr) {
    logger.error(`    Could not verify new container: ${verifyErr.message}`);
    throw new Error(
      `Failed to verify network container ${cleanContainerName}: ${verifyErr.message}`
    );
  }
}

/**
 * Build clean HostConfig from original
 * @param {Object} originalHostConfig - Original HostConfig
 * @param {string} networkModePrefix - Network mode prefix
 * @param {string} newContainerId - New container ID
 * @returns {Object} - Clean HostConfig
 */
// eslint-disable-next-line complexity -- Host config building requires multiple conditional checks
function buildCleanHostConfig(originalHostConfig, networkModePrefix, newContainerId) {
  const cleanHostConfig = {
    NetworkMode: `${networkModePrefix}${newContainerId}`,
    RestartPolicy: originalHostConfig.RestartPolicy
      ? typeof originalHostConfig.RestartPolicy === "string"
        ? { Name: originalHostConfig.RestartPolicy }
        : originalHostConfig.RestartPolicy
      : { Name: "unless-stopped" },
    Binds: originalHostConfig.Binds || [],
    Memory: originalHostConfig.Memory || 0,
    MemorySwap: originalHostConfig.MemorySwap || 0,
    CpuShares: originalHostConfig.CpuShares || 0,
    CpuPeriod: originalHostConfig.CpuPeriod || 0,
    CpuQuota: originalHostConfig.CpuQuota || 0,
    CpusetCpus: originalHostConfig.CpusetCpus || "",
    CpusetMems: originalHostConfig.CpusetMems || "",
    Devices: originalHostConfig.Devices || [],
    DeviceRequests: originalHostConfig.DeviceRequests || [],
    CapAdd: originalHostConfig.CapAdd || [],
    CapDrop: originalHostConfig.CapDrop || [],
    SecurityOpt: originalHostConfig.SecurityOpt || [],
    LogConfig: originalHostConfig.LogConfig || {},
    Privileged: originalHostConfig.Privileged || false,
    ReadonlyRootfs: originalHostConfig.ReadonlyRootfs || false,
    ShmSize: originalHostConfig.ShmSize || 67108864,
    Tmpfs: originalHostConfig.Tmpfs || {},
    Ulimits: originalHostConfig.Ulimits || [],
    UsernsMode: originalHostConfig.UsernsMode || "",
    IpcMode: originalHostConfig.IpcMode || "",
    PidMode: originalHostConfig.PidMode || "",
    Isolation: originalHostConfig.Isolation || "",
    AutoRemove: originalHostConfig.AutoRemove || false,
  };

  Object.keys(cleanHostConfig).forEach((key) => {
    const value = cleanHostConfig[key];
    if (Array.isArray(value) && value.length === 0) {
      delete cleanHostConfig[key];
    } else if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
      delete cleanHostConfig[key];
    }
  });

  return cleanHostConfig;
}

/**
 * Build networking config
 * @param {Object} containerDetails - Container details
 * @param {boolean} isSharedNetworkMode - Whether shared network mode
 * @returns {Object|null} - Networking config or null
 */
// eslint-disable-next-line complexity -- Networking config building requires multiple conditional checks
function buildNetworkingConfig(containerDetails, isSharedNetworkMode) {
  if (isSharedNetworkMode || !containerDetails.NetworkSettings?.Networks) {
    return null;
  }

  const networks = containerDetails.NetworkSettings.Networks;
  const networkingConfig = { EndpointsConfig: {} };

  for (const [networkName, networkData] of Object.entries(networks)) {
    networkingConfig.EndpointsConfig[networkName] = {
      IPAMConfig: networkData.IPAMConfig || {},
      Links: networkData.Links || [],
      Aliases: networkData.Aliases || [],
    };

    const endpoint = networkingConfig.EndpointsConfig[networkName];
    if (Object.keys(endpoint.IPAMConfig).length === 0) {
      delete endpoint.IPAMConfig;
    }
    if (endpoint.Links.length === 0) {
      delete endpoint.Links;
    }
    if (endpoint.Aliases.length === 0) {
      delete endpoint.Aliases;
    }
    if (Object.keys(endpoint).length === 0) {
      delete networkingConfig.EndpointsConfig[networkName];
    }
  }

  if (Object.keys(networkingConfig.EndpointsConfig).length === 0) {
    return null;
  }

  return networkingConfig;
}

/**
 * Build container config
 * @param {Object} containerDetails - Container details
 * @param {Object} cleanHostConfig - Clean HostConfig
 * @param {Object} networkingConfig - Networking config
 * @param {boolean} isSharedNetworkMode - Whether shared network mode
 * @returns {Object} - Container config
 */
function buildContainerConfig(
  containerDetails,
  cleanHostConfig,
  networkingConfig,
  isSharedNetworkMode
) {
  const containerConfig = {
    Image: containerDetails.Config.Image,
    Cmd: containerDetails.Config.Cmd,
    Env: containerDetails.Config.Env,
    HostConfig: cleanHostConfig,
    Labels: containerDetails.Config.Labels,
    WorkingDir: containerDetails.Config.WorkingDir,
  };

  if (
    !isSharedNetworkMode &&
    containerDetails.Config.ExposedPorts &&
    Object.keys(containerDetails.Config.ExposedPorts).length > 0
  ) {
    containerConfig.ExposedPorts = containerDetails.Config.ExposedPorts;
  }

  if (containerDetails.Config.Entrypoint) {
    containerConfig.Entrypoint = containerDetails.Config.Entrypoint;
  }
  if (networkingConfig) {
    containerConfig.NetworkingConfig = networkingConfig;
  }

  return containerConfig;
}

/**
 * Remove existing container if it exists
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerName - Container name
 * @returns {Promise<void>}
 */
async function removeExistingContainer(portainerUrl, endpointId, containerName) {
  try {
    const existingContainers = await portainerService.getContainers(portainerUrl, endpointId);
    const existingContainer = existingContainers.find(
      (c) => c.Names && c.Names.some((name) => name.replace("/", "") === containerName)
    );

    if (existingContainer) {
      logger.warn(`     Container ${containerName} already exists, removing it first...`);
      try {
        await portainerService.stopContainer(portainerUrl, endpointId, existingContainer.Id);
      } catch (_stopErr) {
        // May already be stopped
      }
      await portainerService.removeContainer(portainerUrl, endpointId, existingContainer.Id);
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 2000);
      });
    }
  } catch (checkErr) {
    logger.warn(`     Could not check for existing container: ${checkErr.message}`);
  }
}

/**
 * Verify and retry container creation if NetworkMode is incorrect
 * @param {Object} params - Parameters object
 * @param {Object} params.newContainer - New container
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.containerName - Container name
 * @param {string} params.expectedNetworkMode - Expected NetworkMode
 * @param {Object} params.containerConfig - Container config
 * @param {Object} params.cleanHostConfig - Clean HostConfig
 * @returns {Promise<Object>} - Verified container
 */
// eslint-disable-next-line max-lines-per-function -- Container verification requires comprehensive retry logic
async function verifyAndRetryContainer({
  newContainer,
  portainerUrl,
  endpointId,
  containerName,
  expectedNetworkMode,
  containerConfig,
  cleanHostConfig,
}) {
  try {
    const createdContainerDetails = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      newContainer.Id
    );
    const actualNetworkMode = createdContainerDetails.HostConfig?.NetworkMode || "";

    if (actualNetworkMode === expectedNetworkMode) {
      logger.info(`    Verified: Created container has correct NetworkMode="${actualNetworkMode}"`);
      return newContainer;
    }

    logger.error(
      `    MISMATCH: Created container has NetworkMode="${actualNetworkMode}" but expected "${expectedNetworkMode}"`
    );
    await portainerService.removeContainer(portainerUrl, endpointId, newContainer.Id);
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 2000);
    });

    const retryConfig = {
      ...containerConfig,
      HostConfig: { ...cleanHostConfig, NetworkMode: expectedNetworkMode },
    };

    const retryContainer = await portainerService.createContainer(
      portainerUrl,
      endpointId,
      retryConfig,
      containerName
    );

    const retryDetails = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      retryContainer.Id
    );
    const retryNetworkMode = retryDetails.HostConfig?.NetworkMode || "";
    if (retryNetworkMode === expectedNetworkMode) {
      logger.info(`    Retry successful: NetworkMode is now correct`);
      return retryContainer;
    }
    throw new Error(
      `Failed to create container with correct NetworkMode. Got "${retryNetworkMode}" instead of "${expectedNetworkMode}"`
    );
  } catch (verifyErr) {
    logger.warn(`     Could not verify created container NetworkMode: ${verifyErr.message}`);
    return newContainer;
  }
}

/**
 * Recreate a dependent container that uses network_mode
 * This is complex because Docker caches container IDs, so we must recreate from scratch
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {Object} container - Container info (id, name)
 * @param {Object} containerDetails - Full container details from Docker API
 * @param {string} newContainerId - New upgraded container ID
 * @returns {Promise<Object>} - New container object
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Network mode container recreation requires comprehensive orchestration
async function recreateNetworkModeContainer(
  portainerUrl,
  endpointId,
  container,
  containerDetails,
  newContainerId
) {
  const containerNetworkMode = containerDetails.HostConfig?.NetworkMode || "";
  logger.info(`    Recreating ${container.name} (original network_mode: ${containerNetworkMode})`);

  const networkModeType = containerNetworkMode.startsWith("service:") ? "service" : "container";
  logger.info(
    `   Setting network_mode to: ${networkModeType}:<new-container-id> (${newContainerId.substring(0, 12)}...)`
  );

  const networkModePrefix = containerNetworkMode.startsWith("service:") ? "service:" : "container:";

  const originalHostConfig = containerDetails.HostConfig || {};
  const originalNetworkMode = originalHostConfig.NetworkMode || "";

  const cleanHostConfig = buildCleanHostConfig(
    originalHostConfig,
    networkModePrefix,
    newContainerId
  );

  logger.info(
    `    Rebuilt HostConfig from scratch. NetworkMode set to: "${cleanHostConfig.NetworkMode}"`
  );
  logger.info(`    Original NetworkMode was: "${originalNetworkMode}"`);

  const updatedNetworkMode = cleanHostConfig.NetworkMode || "";
  const updatedIsSharedNetworkMode =
    updatedNetworkMode &&
    (updatedNetworkMode.startsWith("service:") || updatedNetworkMode.startsWith("container:"));

  if (!updatedIsSharedNetworkMode && originalHostConfig.PortBindings) {
    cleanHostConfig.PortBindings = originalHostConfig.PortBindings;
  }
  if (!updatedIsSharedNetworkMode && originalHostConfig.PublishAllPorts !== undefined) {
    cleanHostConfig.PublishAllPorts = originalHostConfig.PublishAllPorts;
  }

  const networkingConfig = buildNetworkingConfig(containerDetails, updatedIsSharedNetworkMode);
  const containerConfig = buildContainerConfig(
    containerDetails,
    cleanHostConfig,
    networkingConfig,
    updatedIsSharedNetworkMode
  );

  const containerName = containerDetails.Name?.replace("/", "") || container.name;
  const expectedNetworkMode = `${networkModePrefix}${newContainerId}`;

  const finalNetworkMode = containerConfig.HostConfig?.NetworkMode || "";
  if (finalNetworkMode !== expectedNetworkMode) {
    logger.warn(
      `    NetworkMode mismatch: got "${finalNetworkMode}" but expected "${expectedNetworkMode}"`
    );
    cleanHostConfig.NetworkMode = expectedNetworkMode;
    containerConfig.HostConfig.NetworkMode = expectedNetworkMode;
  }

  await removeExistingContainer(portainerUrl, endpointId, containerName);

  const newDependentContainer = await portainerService.createContainer(
    portainerUrl,
    endpointId,
    containerConfig,
    containerName
  );

  const verifiedContainer = await verifyAndRetryContainer({
    newContainer: newDependentContainer,
    portainerUrl,
    endpointId,
    containerName,
    expectedNetworkMode,
    containerConfig,
    cleanHostConfig,
  });

  await portainerService.startContainer(portainerUrl, endpointId, verifiedContainer.Id);
  logger.info(`    ${container.name} recreated and started successfully`);

  return verifiedContainer;
}

/**
 * Handle network mode containers
 * @param {Array<Object>} networkModeContainers - Network mode containers
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-lines-per-function -- Network mode container handling requires comprehensive processing
async function handleNetworkModeContainers(
  networkModeContainers,
  portainerUrl,
  endpointId,
  newContainerId
) {
  logger.info(
    `    Getting container details for ${networkModeContainers.length} dependent container(s)...`
  );
  const containerDetailsMap = new Map();
  for (const container of networkModeContainers) {
    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        container.id
      );
      containerDetailsMap.set(container.id, details);
    } catch (err) {
      logger.error(`    Failed to get details for ${container.name}: ${err.message}`);
    }
  }

  logger.info(
    `     Removing ${networkModeContainers.length} dependent container(s) to clear Docker references...`
  );
  for (const container of networkModeContainers) {
    try {
      await portainerService.removeContainer(portainerUrl, endpointId, container.id);
    } catch (removeErr) {
      logger.debug(`   Could not remove ${container.name}: ${removeErr.message}`);
    }
  }

  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 5000);
  });

  logger.info(
    `    Recreating ${networkModeContainers.length} dependent container(s) with new network reference...`
  );
  for (const container of networkModeContainers) {
    try {
      const containerDetails = containerDetailsMap.get(container.id);
      if (!containerDetails) {
        logger.warn(`     No details stored for ${container.name}, skipping recreation`);
        continue;
      }
      await recreateNetworkModeContainer(
        portainerUrl,
        endpointId,
        container,
        containerDetails,
        newContainerId
      );
    } catch (err) {
      logger.error(`     Failed to recreate ${container.name}:`, { error: err });
    }
  }
}

/**
 * Restart a single dependent container
 * @param {Object} container - Container info
 * @param {string} portainerUrl - Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @returns {Promise<void>}
 */
async function restartSingleContainer(container, portainerUrl, workingPortainerUrl, endpointId) {
  if (container.isRunning) {
    logger.info(`   Restarting ${container.name} (${container.dependencyReason})...`);
    await portainerService.stopContainer(portainerUrl, endpointId, container.id);
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });
    await portainerService.startContainer(portainerUrl, endpointId, container.id);
    logger.info(`    ${container.name} restarted successfully`);
  } else if (container.isStopped) {
    logger.info(`   Starting ${container.name} (was stopped, ${container.dependencyReason})...`);
    try {
      await portainerService.startContainer(portainerUrl, endpointId, container.id);
      logger.info(`    ${container.name} started successfully`);
    } catch (_startErr) {
      logger.info(`   Attempting full restart of ${container.name}...`);
      await portainerService
        .stopContainer(workingPortainerUrl, endpointId, container.id)
        .catch(() => {
          // Ignore stop errors
        });
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 1000);
      });
      await portainerService.startContainer(portainerUrl, endpointId, container.id);
      logger.info(`    ${container.name} restarted successfully`);
    }
  }
}

/**
 * Restart dependent containers after upgrade
 * Main entry point that orchestrates the entire dependent container restart process
 * @param {Object} options - Options object
 * @param {string} options.portainerUrl - Portainer URL
 * @param {string} options.workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string} options.endpointId - Endpoint ID
 * @param {Object} options.newContainer - New container object (after upgrade)
 * @param {string} options.cleanContainerName - Clean container name
 * @param {string} options.originalContainerId - Original container ID (before upgrade)
 * @param {string|null} options.stackName - Stack name if container is part of a stack
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-lines-per-function -- Dependent container restart requires comprehensive orchestration
async function restartDependentContainers(options) {
  const {
    portainerUrl,
    workingPortainerUrl,
    endpointId,
    newContainer,
    cleanContainerName,
    originalContainerId,
    stackName,
  } = options;
  try {
    logger.info(` Checking for dependent containers...`);
    const dependentContainers = await findDependentContainersAfterUpgrade({
      portainerUrl,
      workingPortainerUrl,
      endpointId,
      newContainerId: newContainer.Id,
      cleanContainerName,
      originalContainerId,
      stackName,
    });

    if (dependentContainers.length === 0) {
      logger.info(`  No dependent containers found`);
      return;
    }

    logger.info(
      ` Found ${dependentContainers.length} dependent container(s) (${dependentContainers.filter((c) => c.isRunning).length} running, ${dependentContainers.filter((c) => c.isStopped).length} stopped)`
    );

    await waitForUpgradedContainerHealth(workingPortainerUrl, endpointId, newContainer.Id);

    const networkModeContainers = dependentContainers.filter(
      (c) => c.dependencyReason === "network_mode"
    );
    const otherContainers = dependentContainers.filter(
      (c) => c.dependencyReason !== "network_mode"
    );

    await verifyUpgradedContainer(
      workingPortainerUrl,
      endpointId,
      newContainer.Id,
      cleanContainerName
    );

    if (networkModeContainers.length > 0) {
      await handleNetworkModeContainers(
        networkModeContainers,
        portainerUrl,
        endpointId,
        newContainer.Id
      );
    }

    for (const container of otherContainers) {
      try {
        await restartSingleContainer(container, portainerUrl, workingPortainerUrl, endpointId);
      } catch (err) {
        logger.error(`     Failed to restart ${container.name}:`, { error: err });
      }
    }

    logger.info(` Dependent container restart process completed`);
  } catch (err) {
    logger.error("  Error restarting dependent containers:", { error: err });
    throw err;
  }
}

module.exports = {
  findDependentContainersAfterUpgrade,
  waitForUpgradedContainerHealth,
  verifyUpgradedContainer,
  recreateNetworkModeContainer,
  restartDependentContainers,
};
