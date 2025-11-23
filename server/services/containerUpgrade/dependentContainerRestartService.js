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

const logger = require("../../utils/logger");
const portainerService = require("../portainerService");
const containerConfigService = require("./containerConfigService");

/**
 * Find containers that depend on the upgraded container after upgrade
 * This is different from finding containers before upgrade - we need to check
 * against the new container ID and find containers that need to be restarted
 * @param {string} portainerUrl - Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID (after upgrade)
 * @param {string} cleanContainerName - Clean container name (without leading slash)
 * @param {string} originalContainerId - Original container ID (before upgrade)
 * @param {string|null} stackName - Stack name if container is part of a stack
 * @returns {Promise<Array<Object>>} - Array of dependent containers with id, name, isRunning, isStopped, dependencyReason
 */
async function findDependentContainersAfterUpgrade(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  newContainerId,
  cleanContainerName,
  originalContainerId,
  stackName
) {
  const dependentContainers = [];
  try {
    const allContainers = await portainerService.getContainers(workingPortainerUrl, endpointId);

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

        // Check if this container depends on the upgraded container
        let dependsOnUpgraded = false;
        let dependencyReason = "";

        // Check 1: network_mode: service:containerName or container:containerName
        // OR network_mode: service:containerId or container:containerId (64 hex chars)
        const networkMode = details.HostConfig?.NetworkMode || "";
        if (networkMode) {
          let targetContainerRef = null;
          if (networkMode.startsWith("service:")) {
            targetContainerRef = networkMode.replace("service:", "");
          } else if (networkMode.startsWith("container:")) {
            targetContainerRef = networkMode.replace("container:", "");
          }

          // Check if it matches by name OR by container ID (old or new)
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
            dependsOnUpgraded = true;
            dependencyReason = "network_mode";
            logger.info(
              `    Found network_mode dependency: ${container.Names[0]?.replace("/", "")} -> ${cleanContainerName} (NetworkMode: ${networkMode.substring(0, 50)}..., matched by ${matchesByName ? "name" : matchesByNewId ? "new ID" : "old ID"})`
            );
          } else if (targetContainerRef && targetContainerRef.length === 64) {
            // Log when we find a container ID but it doesn't match (for debugging)
            logger.debug(
              `     Container ${container.Names[0]?.replace("/", "")} has NetworkMode with container ID ${targetContainerRef.substring(0, 12)}... but it doesn't match ${cleanContainerName}`
            );
          }
        }

        // Check 2: Same stack (compose project or stack namespace)
        if (!dependsOnUpgraded && stackName) {
          const containerStackName =
            details.Config.Labels?.["com.docker.compose.project"] ||
            details.Config.Labels?.["com.docker.stack.namespace"] ||
            null;
          if (containerStackName === stackName) {
            // If in same stack and was running or stopped, it might depend on us
            // We'll restart it to ensure it reconnects
            if (isRunning || isStopped) {
              dependsOnUpgraded = true;
              dependencyReason = "stack";
            }
          }
        }

        if (dependsOnUpgraded) {
          dependentContainers.push({
            id: container.Id,
            name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
            isRunning,
            isStopped,
            dependencyReason,
          });
        }
      } catch (err) {
        // Skip containers we can't inspect
        logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
        continue;
      }
    }
  } catch (err) {
    logger.error("Error finding dependent containers:", { error: err });
    throw err;
  }

  return dependentContainers;
}

/**
 * Wait for upgraded container to be healthy before restarting dependents
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} newContainerId - New container ID
 * @returns {Promise<void>}
 */
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
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const currentDetails = await portainerService.getContainerDetails(
            workingPortainerUrl,
            endpointId,
            newContainerId
          );
          const currentHealth = currentDetails.State?.Health?.Status;
          if (currentHealth === "healthy") {
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (err) {
    logger.warn("Could not check upgraded container health, proceeding anyway:", {
      error: err,
    });
    // Wait a brief moment anyway
    await new Promise((resolve) => setTimeout(resolve, 2000));
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
      await new Promise((resolve) => setTimeout(resolve, 3000));

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
 * Recreate a dependent container that uses network_mode
 * This is complex because Docker caches container IDs, so we must recreate from scratch
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {Object} container - Container info (id, name)
 * @param {Object} containerDetails - Full container details from Docker API
 * @param {string} newContainerId - New upgraded container ID
 * @returns {Promise<Object>} - New container object
 */
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

  // Determine the correct prefix (service: or container:) based on original format
  let networkModePrefix = "container:"; // Default to container: (matches user's setup)
  if (containerNetworkMode.startsWith("service:")) {
    networkModePrefix = "service:";
  } else if (containerNetworkMode.startsWith("container:")) {
    networkModePrefix = "container:";
  }

  // Build clean HostConfig from scratch - only include fields needed for container creation
  const originalHostConfig = containerDetails.HostConfig || {};
  const originalNetworkMode = originalHostConfig.NetworkMode || "";

  const cleanHostConfig = {
    // NetworkMode MUST be set to the new container's ID (not name) to avoid Docker name resolution cache issues
    NetworkMode: `${networkModePrefix}${newContainerId}`,

    // Restart policy
    RestartPolicy: originalHostConfig.RestartPolicy
      ? typeof originalHostConfig.RestartPolicy === "string"
        ? { Name: originalHostConfig.RestartPolicy }
        : originalHostConfig.RestartPolicy
      : { Name: "unless-stopped" },

    // Binds/volumes
    Binds: originalHostConfig.Binds || [],

    // Memory and CPU limits
    Memory: originalHostConfig.Memory || 0,
    MemorySwap: originalHostConfig.MemorySwap || 0,
    CpuShares: originalHostConfig.CpuShares || 0,
    CpuPeriod: originalHostConfig.CpuPeriod || 0,
    CpuQuota: originalHostConfig.CpuQuota || 0,
    CpusetCpus: originalHostConfig.CpusetCpus || "",
    CpusetMems: originalHostConfig.CpusetMems || "",

    // Device mappings
    Devices: originalHostConfig.Devices || [],
    DeviceRequests: originalHostConfig.DeviceRequests || [],

    // Capabilities
    CapAdd: originalHostConfig.CapAdd || [],
    CapDrop: originalHostConfig.CapDrop || [],

    // Security options
    SecurityOpt: originalHostConfig.SecurityOpt || [],

    // Logging
    LogConfig: originalHostConfig.LogConfig || {},

    // Other useful fields
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

  // Remove empty arrays/objects to keep config clean
  Object.keys(cleanHostConfig).forEach((key) => {
    const value = cleanHostConfig[key];
    if (Array.isArray(value) && value.length === 0) {
      delete cleanHostConfig[key];
    } else if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
      delete cleanHostConfig[key];
    }
  });

  logger.info(
    `    Rebuilt HostConfig from scratch. NetworkMode set to: "${cleanHostConfig.NetworkMode}"`
  );
  logger.info(`    Original NetworkMode was: "${originalNetworkMode}"`);

  // CRITICAL: When using shared network mode, DO NOT include PortBindings
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

  // Prepare networking config
  let networkingConfig = null;
  if (!updatedIsSharedNetworkMode && containerDetails.NetworkSettings?.Networks) {
    const networks = containerDetails.NetworkSettings.Networks;
    networkingConfig = { EndpointsConfig: {} };
    for (const [networkName, networkData] of Object.entries(networks)) {
      networkingConfig.EndpointsConfig[networkName] = {
        IPAMConfig: networkData.IPAMConfig || {},
        Links: networkData.Links || [],
        Aliases: networkData.Aliases || [],
      };
      // Remove empty objects
      if (Object.keys(networkingConfig.EndpointsConfig[networkName].IPAMConfig).length === 0) {
        delete networkingConfig.EndpointsConfig[networkName].IPAMConfig;
      }
      if (networkingConfig.EndpointsConfig[networkName].Links.length === 0) {
        delete networkingConfig.EndpointsConfig[networkName].Links;
      }
      if (networkingConfig.EndpointsConfig[networkName].Aliases.length === 0) {
        delete networkingConfig.EndpointsConfig[networkName].Aliases;
      }
      if (Object.keys(networkingConfig.EndpointsConfig[networkName]).length === 0) {
        delete networkingConfig.EndpointsConfig[networkName];
      }
    }
    if (Object.keys(networkingConfig.EndpointsConfig).length === 0) {
      networkingConfig = null;
    }
  }

  // Build container config
  const containerConfig = {
    Image: containerDetails.Config.Image,
    Cmd: containerDetails.Config.Cmd,
    Env: containerDetails.Config.Env,
    HostConfig: cleanHostConfig,
    Labels: containerDetails.Config.Labels,
    WorkingDir: containerDetails.Config.WorkingDir,
  };

  // CRITICAL: ExposedPorts conflict with shared network modes
  if (
    !updatedIsSharedNetworkMode &&
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

  const containerName = containerDetails.Name?.replace("/", "") || container.name;
  const expectedNetworkMode = `${networkModePrefix}${newContainerId}`;

  // Verify NetworkMode before creating
  const finalNetworkMode = containerConfig.HostConfig?.NetworkMode || "";
  if (finalNetworkMode !== expectedNetworkMode) {
    logger.warn(
      `    NetworkMode mismatch: got "${finalNetworkMode}" but expected "${expectedNetworkMode}"`
    );
    cleanHostConfig.NetworkMode = expectedNetworkMode;
    containerConfig.HostConfig.NetworkMode = expectedNetworkMode;
  }

  // Check if container already exists and remove it
  try {
    const existingContainers = await portainerService.getContainers(portainerUrl, endpointId);
    const existingContainer = existingContainers.find(
      (c) => c.Names && c.Names.some((name) => name.replace("/", "") === containerName)
    );

    if (existingContainer) {
      logger.warn(`     Container ${containerName} already exists, removing it first...`);
      try {
        await portainerService.stopContainer(portainerUrl, endpointId, existingContainer.Id);
      } catch (stopErr) {
        // May already be stopped
      }
      await portainerService.removeContainer(portainerUrl, endpointId, existingContainer.Id);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (checkErr) {
    logger.warn(`     Could not check for existing container: ${checkErr.message}`);
  }

  // Create the container
  const newDependentContainer = await portainerService.createContainer(
    portainerUrl,
    endpointId,
    containerConfig,
    containerName
  );

  // Verify the created container has the correct NetworkMode
  try {
    const createdContainerDetails = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      newDependentContainer.Id
    );
    const actualNetworkMode = createdContainerDetails.HostConfig?.NetworkMode || "";

    if (actualNetworkMode !== expectedNetworkMode) {
      logger.error(
        `    MISMATCH: Created container has NetworkMode="${actualNetworkMode}" but expected "${expectedNetworkMode}"`
      );
      // Remove and retry
      await portainerService.removeContainer(portainerUrl, endpointId, newDependentContainer.Id);
      await new Promise((resolve) => setTimeout(resolve, 2000));

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
      } else {
        throw new Error(
          `Failed to create container with correct NetworkMode. Got "${retryNetworkMode}" instead of "${expectedNetworkMode}"`
        );
      }
    } else {
      logger.info(`    Verified: Created container has correct NetworkMode="${actualNetworkMode}"`);
    }
  } catch (verifyErr) {
    logger.warn(`     Could not verify created container NetworkMode: ${verifyErr.message}`);
  }

  // Start the new container
  await portainerService.startContainer(portainerUrl, endpointId, newDependentContainer.Id);
  logger.info(`    ${container.name} recreated and started successfully`);

  return newDependentContainer;
}

/**
 * Restart dependent containers after upgrade
 * Main entry point that orchestrates the entire dependent container restart process
 * @param {string} portainerUrl - Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string} endpointId - Endpoint ID
 * @param {Object} newContainer - New container object (after upgrade)
 * @param {string} cleanContainerName - Clean container name
 * @param {string} originalContainerId - Original container ID (before upgrade)
 * @param {string|null} stackName - Stack name if container is part of a stack
 * @returns {Promise<void>}
 */
async function restartDependentContainers(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  newContainer,
  cleanContainerName,
  originalContainerId,
  stackName
) {
  try {
    // Find dependent containers
    logger.info(` Checking for dependent containers...`);
    const dependentContainers = await findDependentContainersAfterUpgrade(
      portainerUrl,
      workingPortainerUrl,
      endpointId,
      newContainer.Id,
      cleanContainerName,
      originalContainerId,
      stackName
    );

    if (dependentContainers.length === 0) {
      logger.info(`  No dependent containers found`);
      return;
    }

    logger.info(
      ` Found ${dependentContainers.length} dependent container(s) (${dependentContainers.filter((c) => c.isRunning).length} running, ${dependentContainers.filter((c) => c.isStopped).length} stopped)`
    );

    // Wait for upgraded container to be healthy
    await waitForUpgradedContainerHealth(workingPortainerUrl, endpointId, newContainer.Id);

    // Separate network_mode containers from others
    const networkModeContainers = dependentContainers.filter(
      (c) => c.dependencyReason === "network_mode"
    );
    const otherContainers = dependentContainers.filter(
      (c) => c.dependencyReason !== "network_mode"
    );

    // Verify the upgraded container is running
    await verifyUpgradedContainer(
      workingPortainerUrl,
      endpointId,
      newContainer.Id,
      cleanContainerName
    );

    // Handle network_mode containers (need to be recreated)
    if (networkModeContainers.length > 0) {
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
          // Container might already be removed
          logger.debug(`   Could not remove ${container.name}: ${removeErr.message}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for Docker cleanup

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
            newContainer.Id
          );
        } catch (err) {
          logger.error(`     Failed to recreate ${container.name}:`, { error: err });
          // Continue with other containers
        }
      }
    }

    // Handle other dependent containers (stack-based, just restart)
    for (const container of otherContainers) {
      try {
        if (container.isRunning) {
          logger.info(`   Restarting ${container.name} (${container.dependencyReason})...`);
          await portainerService.stopContainer(portainerUrl, endpointId, container.id);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await portainerService.startContainer(portainerUrl, endpointId, container.id);
          logger.info(`    ${container.name} restarted successfully`);
        } else if (container.isStopped) {
          logger.info(
            `   Starting ${container.name} (was stopped, ${container.dependencyReason})...`
          );
          try {
            await portainerService.startContainer(portainerUrl, endpointId, container.id);
            logger.info(`    ${container.name} started successfully`);
          } catch (startErr) {
            // Try full restart
            logger.info(`   Attempting full restart of ${container.name}...`);
            await portainerService
              .stopContainer(workingPortainerUrl, endpointId, container.id)
              .catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await portainerService.startContainer(portainerUrl, endpointId, container.id);
            logger.info(`    ${container.name} restarted successfully`);
          }
        }
      } catch (err) {
        logger.error(`     Failed to restart ${container.name}:`, { error: err });
        // Continue with other containers
      }
    }

    logger.info(` Dependent container restart process completed`);
  } catch (err) {
    logger.error("  Error restarting dependent containers:", { error: err });
    // Don't fail the upgrade if dependent restart fails
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
