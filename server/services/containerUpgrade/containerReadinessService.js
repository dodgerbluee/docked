/**
 * Container Readiness Service
 *
 * Handles checking if a container is ready after creation/upgrade,
 * including health checks and stability checks.
 * Extracted from containerUpgradeService to improve modularity.
 */

const logger = require("../../utils/logger");
const portainerService = require("../portainerService");

/**
 * Check if container is running
 * @param {Object} details - Container details
 * @returns {boolean}
 */
function isContainerRunning(details) {
  const containerStatus =
    details.State?.Status || (details.State?.Running ? "running" : "unknown");
  return containerStatus === "running" || details.State?.Running === true;
}

/**
 * Handle container exit error
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {Object} details - Container details
 * @returns {Promise<never>}
 */
async function handleContainerExit(portainerUrl, endpointId, containerId, details) {
  try {
    const logs = await portainerService.getContainerLogs(
      portainerUrl,
      endpointId,
      containerId,
      50,
    );
    const exitCode = details.State?.ExitCode || 0;
    throw new Error(
      `Container exited with code ${exitCode}. Last 50 lines of logs:\n${logs}`,
    );
  } catch (_logErr) {
    const exitCode = details.State?.ExitCode || 0;
    throw new Error(`Container exited with code ${exitCode}. Could not retrieve logs.`);
  }
}

/**
 * Handle unhealthy container
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<never>}
 */
async function handleUnhealthyContainer(portainerUrl, endpointId, containerId) {
  try {
    const logs = await portainerService.getContainerLogs(
      portainerUrl,
      endpointId,
      containerId,
      50,
    );
    throw new Error(`Container health check failed. Last 50 lines of logs:\n${logs}`);
  } catch (_logErr) {
    throw new Error("Container health check failed. Could not retrieve logs.");
  }
}

/**
 * Check if container should be considered ready based on health check
 * @param {Object} details - Container details
 * @param {number} waitTime - Time waited so far
 * @param {number} consecutiveRunningChecks - Consecutive running checks
 * @returns {boolean}
 */
function shouldConsiderReadyWithHealthCheck(details, waitTime, consecutiveRunningChecks) {
  const healthStatus = details.State?.Health?.Status;
  if (healthStatus === "healthy") {
    return true;
  }
  if (healthStatus === "unhealthy") {
    return false;
  }
  // Status is 'starting' or 'none'
  return waitTime >= 30000 && consecutiveRunningChecks >= 5;
}

/**
 * Check if container should be considered ready without health check
 * @param {string} imageName - Image name
 * @param {number} waitTime - Time waited so far
 * @param {number} consecutiveRunningChecks - Consecutive running checks
 * @param {number} requiredStableChecks - Required stable checks
 * @param {number} minInitTime - Minimum initialization time
 * @returns {boolean}
 */
function shouldConsiderReadyWithoutHealthCheck(
  imageName,
  waitTime,
  consecutiveRunningChecks,
  requiredStableChecks,
  minInitTime,
) {
  if (waitTime >= minInitTime && consecutiveRunningChecks >= requiredStableChecks) {
    return true;
  }
  if (waitTime >= 5000 && consecutiveRunningChecks >= 2) {
    const isLikelyDatabase =
      /postgres|mysql|mariadb|redis|mongodb|couchdb|influxdb|elasticsearch/i.test(imageName);
    return !isLikelyDatabase;
  }
  return false;
}

/**
 * Check if container is running from details
 * @param {Object} details - Container details
 * @returns {boolean} - True if running
 */
function checkRunningFromDetails(details) {
  const containerStatus =
    details.State?.Status || (details.State?.Running ? "running" : "unknown");
  return containerStatus === "running" || details.State?.Running === true;
}

/**
 * Perform final readiness check
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} containerName - Container name
 * @param {number} maxWaitTime - Maximum wait time
 * @returns {Promise<boolean>}
 */
async function performFinalReadinessCheck(
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  maxWaitTime,
) {
  try {
    const details = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      containerId,
    );
    const isRunning = checkRunningFromDetails(details);
    if (isRunning) {
      logger.warn("Timeout reached but container is running, considering it ready", {
        module: "containerUpgradeService",
        operation: "waitForContainerReady",
        containerName,
        waitTime: `${maxWaitTime / 1000}s`,
      });
      return true;
    }
    const stateInfo =
      details.State?.Status || (details.State ? JSON.stringify(details.State) : "unknown");
    throw new Error(
      `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Current state: ${stateInfo}`,
    );
  } catch (err) {
    if (err.message.includes("Current state")) {
      throw err;
    }
    throw new Error(
      `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Container may have failed to start.`,
    );
  }
}

/**
 * Check container health status
 * @param {Object} params - Parameters object
 * @param {Object} params.details - Container details
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.containerId - Container ID
 * @param {number} params.waitTime - Time waited
 * @param {number} params.consecutiveRunningChecks - Consecutive running checks
 * @returns {Promise<boolean>} - True if ready
 */
async function checkHealthStatus({
  details,
  portainerUrl,
  endpointId,
  containerId,
  waitTime,
  consecutiveRunningChecks,
}) {
  const healthStatus = details.State.Health.Status;
  if (healthStatus === "healthy") {
    return true;
  }
  if (healthStatus === "unhealthy") {
    await handleUnhealthyContainer(portainerUrl, endpointId, containerId);
    return false;
  }
  return shouldConsiderReadyWithHealthCheck(details, waitTime, consecutiveRunningChecks);
}

/**
 * Check container readiness without health check
 * @param {Object} params - Parameters object
 * @param {Object} params.details - Container details
 * @param {string} params.imageName - Image name
 * @param {number} params.waitTime - Time waited
 * @param {number} params.consecutiveRunningChecks - Consecutive running checks
 * @param {number} params.requiredStableChecks - Required stable checks
 * @param {number} params.checkInterval - Check interval
 * @param {string} params.containerName - Container name
 * @returns {boolean} - True if ready
 */
function checkReadinessWithoutHealth({
  details,
  imageName,
  waitTime,
  consecutiveRunningChecks,
  requiredStableChecks,
  checkInterval,
  containerName,
}) {
  const minInitTime = 15000;
  if (
    shouldConsiderReadyWithoutHealthCheck(
      imageName,
      waitTime,
      consecutiveRunningChecks,
      requiredStableChecks,
      minInitTime,
    )
  ) {
    const logMessage =
      waitTime >= minInitTime
        ? "Container is running and stable"
        : "Container is running and stable (non-database service)";
    logger.info(logMessage, {
      module: "containerUpgradeService",
      operation: "waitForContainerReady",
      containerName,
      stableTime: `${(consecutiveRunningChecks * checkInterval) / 1000}s`,
      waitTime: `${waitTime / 1000}s`,
    });
    return true;
  }
  return false;
}

/**
 * Process container details during readiness check
 * @param {Object} params - Parameters object
 * @param {Object} params.details - Container details
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} params.containerId - Container ID
 * @param {string} params.containerName - Container name
 * @param {string} params.imageName - Image name
 * @param {number} params.waitTime - Time waited
 * @param {number} params.consecutiveRunningChecks - Consecutive running checks
 * @param {number} params.requiredStableChecks - Required stable checks
 * @param {number} params.checkInterval - Check interval
 * @returns {Promise<boolean>} - True if ready
 */
// eslint-disable-next-line max-lines-per-function -- Container processing requires comprehensive readiness check
async function processContainerDetails({
  details,
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  imageName,
  waitTime,
  consecutiveRunningChecks,
  requiredStableChecks,
  checkInterval,
}) {
  const isRunning = isContainerRunning(details);
  if (!isRunning) {
    const containerStatus =
      details.State?.Status || (details.State?.Running ? "running" : "unknown");
    if (containerStatus === "exited") {
      await handleContainerExit(portainerUrl, endpointId, containerId, details);
    }
    return false;
  }

  if (details.State?.Health) {
    const ready = await checkHealthStatus({
      details,
      portainerUrl,
      endpointId,
      containerId,
      waitTime,
      consecutiveRunningChecks,
    });
    if (ready) {
      logger.info(
        "Health check still starting but container is running stably, considering ready",
        {
          module: "containerUpgradeService",
          operation: "waitForContainerReady",
          containerName,
          waitTime: `${waitTime / 1000}s`,
          consecutiveChecks: consecutiveRunningChecks,
        },
      );
    }
    return ready;
  }

  return checkReadinessWithoutHealth({
    details,
    imageName,
    waitTime,
    consecutiveRunningChecks,
    requiredStableChecks,
    checkInterval,
    containerName,
  });
}

/**
 * Wait for container to be ready after creation
 * @param {Object} options - Options object
 * @param {string} options.portainerUrl - Portainer URL
 * @param {string} options.endpointId - Endpoint ID
 * @param {string} options.containerId - Container ID
 * @param {string} options.containerName - Container name
 * @param {string} options.imageName - Image name (for database detection)
 * @param {number} options.maxWaitTime - Maximum wait time in milliseconds (default: 120000 = 2 minutes)
 * @param {number} options.checkInterval - Check interval in milliseconds (default: 2000 = 2 seconds)
 * @param {number} options.requiredStableChecks - Required consecutive stable checks (default: 3)
 * @returns {Promise<void>}
 * @throws {Error} If container doesn't become ready within timeout
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container readiness waiting requires comprehensive health check logic
async function waitForContainerReady({
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  imageName,
  maxWaitTime = 120000,
  checkInterval = 2000,
  requiredStableChecks = 3,
}) {
  const startTime = Date.now();
  let isReady = false;
  let consecutiveRunningChecks = 0;

  logger.info("Waiting for container to be ready", {
    module: "containerUpgradeService",
    operation: "waitForContainerReady",
    containerName,
    containerId: containerId.substring(0, 12),
    maxWaitTime: `${maxWaitTime / 1000}s`,
  });

  while (Date.now() - startTime < maxWaitTime && !isReady) {
    await new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, checkInterval);
    });

    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        containerId,
      );

      const waitTime = Date.now() - startTime;
      const ready = await processContainerDetails({
        details,
        portainerUrl,
        endpointId,
        containerId,
        containerName,
        imageName,
        waitTime,
        consecutiveRunningChecks,
        requiredStableChecks,
        checkInterval,
      });

      if (ready) {
        if (details.State?.Health?.Status === "healthy") {
          logger.info("Container health check passed", {
            module: "containerUpgradeService",
            operation: "waitForContainerReady",
            containerName,
            waitTime: `${waitTime / 1000}s`,
          });
        }
        isReady = true;
        break;
      }

      consecutiveRunningChecks++;
    } catch (err) {
      if (err.message.includes("exited") || err.message.includes("health check")) {
        throw err;
      }
      consecutiveRunningChecks = 0;
    }
  }

  if (!isReady) {
    isReady = await performFinalReadinessCheck(
      portainerUrl,
      endpointId,
      containerId,
      containerName,
      maxWaitTime,
    );
  }

  if (!isReady) {
    throw new Error(
      `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Container may have failed to start.`,
    );
  }
}

/**
 * Check if container is stopped
 * @param {Object} details - Container details
 * @returns {boolean} - True if stopped
 */
function isContainerStopped(details) {
  const containerStatus =
    details.State?.Status || (details.State?.Running === false ? "exited" : "unknown");
  return containerStatus === "exited" || containerStatus === "stopped";
}

/**
 * Wait for container to stop
 * @param {Object} options - Options object
 * @param {string} options.portainerUrl - Portainer URL
 * @param {string} options.endpointId - Endpoint ID
 * @param {string} options.containerId - Container ID
 * @param {string} options.containerName - Container name
 * @param {number} options.maxWaitTime - Maximum wait time in milliseconds (default: 10000 = 10 seconds)
 * @param {number} options.checkInterval - Check interval in milliseconds (default: 500 = 0.5 seconds)
 * @returns {Promise<boolean>} - True if stopped, false if timeout
 */
async function waitForContainerStop({
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  maxWaitTime = 10000,
  checkInterval = 500,
}) {
  logger.debug("Waiting for container to stop", {
    module: "containerUpgradeService",
    operation: "waitForContainerStop",
    containerName,
    usingUrl: portainerUrl,
  });

  let stopped = false;
  const maxIterations = maxWaitTime / checkInterval;
  for (let i = 0; i < maxIterations; i++) {
    await new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, checkInterval);
    });
    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        containerId,
      );
      if (isContainerStopped(details)) {
        stopped = true;
        break;
      }
    } catch (err) {
      if (err.response?.status === 404) {
        stopped = true;
        break;
      }
    }
  }

  if (!stopped) {
    logger.warn("Container did not stop within timeout, proceeding anyway", {
      module: "containerUpgradeService",
      operation: "waitForContainerStop",
      containerName,
      containerId: containerId.substring(0, 12),
    });
  }

  return stopped;
}

module.exports = {
  waitForContainerReady,
  waitForContainerStop,
};
