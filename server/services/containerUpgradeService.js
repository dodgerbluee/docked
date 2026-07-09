/**
 * Container Upgrade Service
 * Handles container upgrade operations
 */

const dockerRegistryService = require("./dockerRegistryService");
const logger = require("../utils/logger");
const nginxProxyManagerService = require("./containerUpgrade/nginxProxyManagerService");
const containerDetailsService = require("./containerUpgrade/containerDetailsService");
const upgradePlanner = require("./containerUpgrade/upgradePlanner");
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

    // ── Plan-then-execute upgrade (PLAN-2 §0.1) ────────────────────────────────
    // A single correlation id ties every log line of this run together.
    const upgradeId = upgradePlanner.makeUpgradeId();

    // Uniform backend adapter. Read calls pass backend.apiKey; mutating calls
    // pass `backend.apiKey ?? userId` (runner uses the api key, Portainer the
    // user id in that slot). For nginx-proxy-manager we route through the IP URL.
    const opsUrl = isNginxProxyManager ? workingPortainerUrl : backend.url;
    const opsApiKey = backend.apiKey;
    const opsAuthArg = backend.apiKey ?? userId;
    const pullOriginalUrl = isNginxProxyManager ? portainerUrl : null;
    const ops = {
      listContainers: () => backend.service.getContainers(opsUrl, effectiveEndpointId, opsApiKey),
      inspect: (id) =>
        backend.service.getContainerDetails(opsUrl, effectiveEndpointId, id, opsApiKey),
      stop: (id) => backend.service.stopContainer(opsUrl, effectiveEndpointId, id, opsAuthArg),
      start: (id) => backend.service.startContainer(opsUrl, effectiveEndpointId, id, opsAuthArg),
      remove: (id) => backend.service.removeContainer(opsUrl, effectiveEndpointId, id, opsAuthArg),
      create: (config, name) =>
        backend.service.createContainer(opsUrl, effectiveEndpointId, config, name, opsAuthArg),
      pull: (image) =>
        backend.service.pullImage(opsUrl, effectiveEndpointId, image, pullOriginalUrl, opsAuthArg),
    };

    // Plan phase (read-only): capture the target + every network_mode dependent.
    const plan = await upgradePlanner.buildUpgradePlan({
      ops,
      upgradeId,
      targetInspect: containerDetails,
      targetId: workingContainerId,
      targetName: cleanContainerName,
    });

    logger.info(
      `[upgrade ${upgradeId}] Upgrading ${originalContainerName} ${imageName} -> ${newImageName} (${plan.dependents.length} dependent(s))`
    );

    // Execute phase: stop dependents -> upgrade target -> recreate dependents,
    // with rollback on any failure after the dependents are stopped.
    let newContainer;
    try {
      ({ newContainer } = await upgradePlanner.executeUpgradePlan({
        ops,
        plan,
        newImage: newImageName,
        upgradeId,
      }));
    } catch (error) {
      if (error.response?.status === 400) {
        const errorMessage =
          error.response?.data?.message || error.message || "Invalid container configuration";
        logger.error("Failed to create container - invalid configuration", {
          module: "containerService",
          operation: "upgradeSingleContainer",
          upgradeId,
          containerName: originalContainerName,
          error: errorMessage,
          errorDetails: error.response?.data,
        });
        throw new Error(
          `Failed to create container: ${errorMessage}. ` +
            `This may be due to invalid network configuration, port conflicts, or other container settings. ` +
            `Please check the container configuration.`
        );
      }
      throw error;
    }

    logger.info(`[upgrade ${upgradeId}] Container upgrade completed and container is ready`, {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      newContainerId: newContainer.Id.substring(0, 12),
    });

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
        if (versionInfo && versionInfo.latest_digest) {
          // Update upgrade history data with new version info
          upgradeHistoryData.newDigest = versionInfo.latest_digest;
          upgradeHistoryData.newVersion = versionInfo.latest_version || null;
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
            versionInfo.latest_version || null,
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

            // Build repoDigests for the new deployed_images record.
            // Include both the container digest and the registry manifest digest so that
            // computeHasUpdate can find latestDigest in repoDigests and return false (up-to-date).
            // This is critical for multi-arch images where the container digest (arch-specific)
            // differs from the manifest digest stored in registry_image_versions.latest_digest.
            const upgradeRepoDigests = Array.from(
              new Set([newContainerDigest, versionInfo.latest_digest].filter(Boolean))
            );

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
                repoDigests: upgradeRepoDigests,
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
