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
 * Wait for container to be ready after creation
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} containerName - Container name
 * @param {string} imageName - Image name (for database detection)
 * @param {number} maxWaitTime - Maximum wait time in milliseconds (default: 120000 = 2 minutes)
 * @param {number} checkInterval - Check interval in milliseconds (default: 2000 = 2 seconds)
 * @param {number} requiredStableChecks - Required consecutive stable checks (default: 3)
 * @returns {Promise<void>}
 * @throws {Error} If container doesn't become ready within timeout
 */
async function waitForContainerReady(
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  imageName,
  maxWaitTime = 120000,
  checkInterval = 2000,
  requiredStableChecks = 3
) {
  const startTime = Date.now();
  let isReady = false;
  let consecutiveRunningChecks = 0;

  logger.info("Waiting for container to be ready", {
    module: "containerUpgradeService",
    operation: "waitForContainerReady",
    containerName: containerName,
    containerId: containerId.substring(0, 12),
    maxWaitTime: `${maxWaitTime / 1000}s`,
  });

  while (Date.now() - startTime < maxWaitTime && !isReady) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));

    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        containerId
      );

      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running ? "running" : "unknown");
      const isRunning = containerStatus === "running" || details.State?.Running === true;

      if (!isRunning) {
        consecutiveRunningChecks = 0; // Reset counter if not running

        if (containerStatus === "exited") {
          // Container exited - get logs for debugging
          try {
            const logs = await portainerService.getContainerLogs(
              portainerUrl,
              endpointId,
              containerId,
              50
            );
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(
              `Container exited with code ${exitCode}. Last 50 lines of logs:\n${logs}`
            );
          } catch (logErr) {
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(`Container exited with code ${exitCode}. Could not retrieve logs.`);
          }
        }
        continue; // Still starting up
      }

      // Container is running - increment counter
      consecutiveRunningChecks++;

      // Check health status if health check is configured
      if (details.State?.Health) {
        const healthStatus = details.State.Health.Status;
        if (healthStatus === "healthy") {
          isReady = true;
          logger.info("Container health check passed", {
            module: "containerUpgradeService",
            operation: "waitForContainerReady",
            containerName: containerName,
            waitTime: `${(Date.now() - startTime) / 1000}s`,
          });
          break;
        } else if (healthStatus === "unhealthy") {
          try {
            const logs = await portainerService.getContainerLogs(
              portainerUrl,
              endpointId,
              containerId,
              50
            );
            throw new Error(`Container health check failed. Last 50 lines of logs:\n${logs}`);
          } catch (logErr) {
            throw new Error("Container health check failed. Could not retrieve logs.");
          }
        }
        // Status is 'starting' or 'none', continue waiting
        // However, if container has been running for a while and health check is still starting,
        // consider it ready (some containers never report healthy but work fine)
        const waitTime = Date.now() - startTime;
        if (waitTime >= 30000 && consecutiveRunningChecks >= 5) {
          // Container has been running for 30+ seconds with 5+ stable checks
          // and health check is still starting - likely a container that doesn't properly report health
          logger.info(
            "Health check still starting but container is running stably, considering ready",
            {
              module: "containerUpgradeService",
              operation: "waitForContainerReady",
              containerName: containerName,
              waitTime: `${waitTime / 1000}s`,
              consecutiveChecks: consecutiveRunningChecks,
            }
          );
          isReady = true;
          break;
        }
        // For health checks, we'll wait up to maxWaitTime
      } else {
        // No health check configured - use stability check instead
        // For databases and services, wait a minimum time for initialization
        const waitTime = Date.now() - startTime;
        const minInitTime = 15000; // Wait at least 15 seconds for initialization (databases need this)

        if (waitTime >= minInitTime && consecutiveRunningChecks >= requiredStableChecks) {
          // Container has been running stably for required checks
          isReady = true;
          logger.info("Container is running and stable", {
            module: "containerUpgradeService",
            operation: "waitForContainerReady",
            containerName: containerName,
            stableTime: `${(consecutiveRunningChecks * checkInterval) / 1000}s`,
            waitTime: `${waitTime / 1000}s`,
          });
          break;
        }

        // If we've waited a reasonable time and container is running, consider it ready
        // This handles containers that start quickly (non-databases)
        if (waitTime >= 5000 && consecutiveRunningChecks >= 2) {
          // Check if this looks like a database container (common database image names)
          const isLikelyDatabase =
            /postgres|mysql|mariadb|redis|mongodb|couchdb|influxdb|elasticsearch/i.test(imageName);
          if (!isLikelyDatabase) {
            // Not a database, and it's been running stably - consider it ready
            isReady = true;
            logger.info("Container is running and stable (non-database service)", {
              module: "containerUpgradeService",
              operation: "waitForContainerReady",
              containerName: containerName,
              waitTime: `${waitTime / 1000}s`,
            });
            break;
          }
          // For databases, continue waiting for minInitTime
        }
      }
    } catch (err) {
      if (err.message.includes("exited") || err.message.includes("health check")) {
        throw err;
      }
      // Continue waiting on other errors
      consecutiveRunningChecks = 0; // Reset on error
    }
  }

  if (!isReady) {
    // Final check - if container is running, consider it ready even if we hit timeout
    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        containerId
      );
      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running ? "running" : "unknown");
      const isRunning = containerStatus === "running" || details.State?.Running === true;
      if (isRunning) {
        logger.warn("Timeout reached but container is running, considering it ready", {
          module: "containerUpgradeService",
          operation: "waitForContainerReady",
          containerName: containerName,
          waitTime: `${maxWaitTime / 1000}s`,
        });
        isReady = true;
      } else {
        // Format state info for error message
        const stateInfo =
          containerStatus || (details.State ? JSON.stringify(details.State) : "unknown");
        throw new Error(
          `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Current state: ${stateInfo}`
        );
      }
    } catch (err) {
      if (err.message.includes("Current state")) {
        throw err;
      }
      // If we can't check, throw the timeout error
      throw new Error(
        `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Container may have failed to start.`
      );
    }
  }

  if (!isReady) {
    throw new Error(
      `Container did not become ready within timeout period (${maxWaitTime / 1000}s). Container may have failed to start.`
    );
  }
}

/**
 * Wait for container to stop
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} containerName - Container name
 * @param {number} maxWaitTime - Maximum wait time in milliseconds (default: 10000 = 10 seconds)
 * @param {number} checkInterval - Check interval in milliseconds (default: 500 = 0.5 seconds)
 * @returns {Promise<boolean>} - True if stopped, false if timeout
 */
async function waitForContainerStop(
  portainerUrl,
  endpointId,
  containerId,
  containerName,
  maxWaitTime = 10000,
  checkInterval = 500
) {
  logger.debug("Waiting for container to stop", {
    module: "containerUpgradeService",
    operation: "waitForContainerStop",
    containerName: containerName,
    usingUrl: portainerUrl,
  });

  let stopped = false;
  for (let i = 0; i < maxWaitTime / checkInterval; i++) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        containerId
      );
      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running === false ? "exited" : "unknown");
      if (containerStatus === "exited" || containerStatus === "stopped") {
        stopped = true;
        break;
      }
    } catch (err) {
      // Container might be removed already
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
      containerName: containerName,
      containerId: containerId.substring(0, 12),
    });
  }

  return stopped;
}

module.exports = {
  waitForContainerReady,
  waitForContainerStop,
};

