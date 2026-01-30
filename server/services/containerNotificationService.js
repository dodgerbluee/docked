/**
 * Container Notification Service
 *
 * Handles Discord notifications for newly detected container updates.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const { getAllPortainerInstances } = require("../db/index");
const { computeHasUpdate } = require("../utils/containerUpdateHelpers");

// Lazy load discordService to avoid loading issues during module initialization
let discordService = null;
function getDiscordService() {
  if (!discordService) {
    try {
      discordService = require("./discordService");
    } catch (error) {
      logger.error("Error loading discordService:", error);
      return null;
    }
  }
  return discordService;
}

/**
 * Normalize digest for consistent comparison
 * @param {string|null} digest - Digest string
 * @returns {string|null} - Normalized digest
 */
function normalizeDigest(digest) {
  if (!digest) return null;
  return digest.replace(/^sha256:/i, "").toLowerCase();
}

/**
 * Check if update details changed between previous and current container
 * @param {Object} previousContainer - Previous container data
 * @param {Object} container - Current container data
 * @returns {boolean} - True if update details changed
 */
function hasUpdateDetailsChanged(previousContainer, container) {
  const previousLatestDigest = previousContainer.latestDigest || null;
  const currentLatestDigest = container.latestDigest || container.latestDigestFull || null;
  const previousLatestVersion = previousContainer.latestVersion || null;
  const currentLatestVersion =
    container.latestVersion || container.newVersion || container.latestTag || null;

  const normalizedPreviousDigest = normalizeDigest(previousLatestDigest);
  const normalizedCurrentDigest = normalizeDigest(currentLatestDigest);

  // Check if digest changed
  const digestChanged =
    normalizedCurrentDigest &&
    normalizedPreviousDigest &&
    normalizedCurrentDigest !== normalizedPreviousDigest;

  // Check if version changed
  const versionChanged =
    currentLatestVersion && previousLatestVersion && currentLatestVersion !== previousLatestVersion;

  return digestChanged || versionChanged;
}

/**
 * Check if a container update should trigger a notification
 * @param {Object} container - Current container data
 * @param {Object} previousContainer - Previous container data (from database)
 * @returns {Object} - Object with shouldNotify and isNewlyIdentified flags
 */
function shouldNotifyContainerUpdate(container, previousContainer) {
  // Compute hasUpdate for both containers to ensure accuracy
  const currentHasUpdate = computeHasUpdate(container);
  const previousHasUpdate = previousContainer ? computeHasUpdate(previousContainer) : false;

  // New container with update - always notify
  if (!previousContainer) {
    return { shouldNotify: currentHasUpdate, isNewlyIdentified: currentHasUpdate };
  }

  // Container previously had no update, now has update - new update detected
  if (!previousHasUpdate && currentHasUpdate) {
    return { shouldNotify: true, isNewlyIdentified: true };
  }

  // Both had updates - check if the latest version/digest changed
  if (previousHasUpdate && currentHasUpdate) {
    const detailsChanged = hasUpdateDetailsChanged(previousContainer, container);
    if (detailsChanged) {
      return { shouldNotify: true, isNewlyIdentified: true };
    }
    // If neither changed, don't notify (same update still available)
    // Also don't notify if one is null and the other isn't (data inconsistency, not a new update)
  }

  return { shouldNotify: false, isNewlyIdentified: false };
}

/**
 * Build a map of previous containers by unique identifier
 * @param {Array<Object>} previousContainers - Previous containers from database
 * @param {number} userId - User ID
 * @returns {Promise<Map<string, Object>>} - Map of previous containers
 */
async function buildPreviousContainersMap(previousContainers, userId) {
  const previousContainersMap = new Map();
  const userInstances = await getAllPortainerInstances(userId);
  const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

  previousContainers.forEach((container) => {
    const instance = instanceMap.get(container.portainerInstanceId);
    const portainerUrl = instance ? instance.url : null;
    const key = `${container.containerName}-${portainerUrl}-${container.endpointId}`;

    previousContainersMap.set(key, {
      name: container.containerName,
      portainerUrl,
      endpointId: container.endpointId,
      hasUpdate: computeHasUpdate(container), // Compute on-the-fly
      latestDigest: normalizeDigest(container.latestDigest),
      latestVersion: container.latestVersion || container.latestTag || null,
      currentDigest: normalizeDigest(container.currentDigest),
    });
  });

  return previousContainersMap;
}

/**
 * Extract container version and digest information
 * @param {Object} container - Container object
 * @returns {Object} - Extracted version and digest info
 */
function extractContainerVersionInfo(container) {
  return {
    imageName: container.image || "Unknown",
    currentVersion: container.currentVersion || container.currentTag || "Unknown",
    latestVersion:
      container.newVersion || container.latestTag || container.latestVersion || "Unknown",
    currentDigest: container.currentDigest || container.currentDigestFull || "N/A",
    latestDigest: container.latestDigest || container.latestDigestFull || "N/A",
  };
}

/**
 * Log a newly identified upgrade
 * @param {Object} container - Container object
 * @param {Object} versionInfo - Version and digest information
 * @param {number} userId - User ID
 * @param {Object} batchLogger - Optional batch logger
 */
function logNewlyIdentifiedUpgrade(container, versionInfo, userId, batchLogger) {
  const { imageName, currentVersion, latestVersion, currentDigest, latestDigest } = versionInfo;
  const logData = {
    module: "containerQueryService",
    operation: "getAllContainersWithUpdates",
    containerName: container.name,
    imageName,
    currentDigest:
      currentDigest.length > 12 ? `${currentDigest.substring(0, 12)}...` : currentDigest,
    latestDigest: latestDigest.length > 12 ? `${latestDigest.substring(0, 12)}...` : latestDigest,
    currentVersion,
    latestVersion,
    portainerUrl: container.portainerUrl || "Unknown",
    endpointId: container.endpointId || "Unknown",
    userId: userId || "batch",
  };

  const logMessage = `Newly identified upgrade: ${container.name} (${imageName}) - ${currentVersion} → ${latestVersion}`;
  if (batchLogger) {
    batchLogger.info(logMessage, logData);
  } else {
    logger.info("Newly identified upgrade detected", logData);
  }
}

/**
 * Queue a Discord notification for a container update
 * @param {Object} discord - Discord service
 * @param {Object} container - Container object
 * @param {Object} versionInfo - Version and digest information
 * @param {number} userId - User ID
 */
async function queueContainerNotification(discord, container, versionInfo, userId) {
  const { imageName, currentVersion, latestVersion, latestDigest } = versionInfo;

  // Prefer latestDigestFull over latestDigest for consistency, but fall back to either
  // Normalize to ensure consistent format for deduplication
  const rawDigest = container.latestDigestFull || container.latestDigest || null;
  const normalizedDigest = rawDigest ? normalizeDigest(rawDigest) : null;

  await discord.queueNotification({
    id: container.id,
    name: container.name,
    imageName,
    githubRepo: null,
    sourceType: "docker",
    currentVersion,
    latestVersion,
    latestDigest: normalizedDigest,
    latestVersionPublishDate: container.latestPublishDate || null,
    releaseUrl: null,
    notificationType: "portainer-container",
    userId,
  });
}

/**
 * Send Discord notifications for newly detected container updates
 * @param {Array<Object>} allContainers - Array of all current containers
 * @param {Array<Object>} previousContainers - Array of previous containers from database
 * @param {number} userId - User ID
 * @param {Object} batchLogger - Optional batch logger for logging
 * @returns {Promise<void>}
 */
async function sendContainerUpdateNotifications(
  allContainers,
  previousContainers,
  userId,
  batchLogger = null
) {
  if (!previousContainers || previousContainers.length === 0) {
    return;
  }

  try {
    const discord = getDiscordService();
    if (!discord || !discord.queueNotification) {
      return;
    }

    const previousContainersMap = await buildPreviousContainersMap(previousContainers, userId);

    for (const container of allContainers) {
      // Compute hasUpdate on-the-fly
      if (!computeHasUpdate(container)) {
        continue;
      }

      // Use consistent key format: normalize container name to match database format
      // The database stores containerName, so ensure we use the same field
      const containerName = container.name || container.containerName || "";
      const key = `${containerName}-${container.portainerUrl}-${container.endpointId}`;
      const previousContainer = previousContainersMap.get(key);

      // Log if previousContainer lookup failed (helps diagnose key mismatch issues)
      if (!previousContainer && previousContainersMap.size > 0) {
        logger.debug(
          `Previous container not found for key "${key}" (container: ${containerName}, portainerUrl: ${container.portainerUrl})`
        );
      }

      const { shouldNotify, isNewlyIdentified } = shouldNotifyContainerUpdate(
        container,
        previousContainer
      );

      if (isNewlyIdentified) {
        const versionInfo = extractContainerVersionInfo(container);
        logNewlyIdentifiedUpgrade(container, versionInfo, userId, batchLogger);
      }

      if (shouldNotify) {
        const versionInfo = extractContainerVersionInfo(container);
        await queueContainerNotification(discord, container, versionInfo, userId);
      }
    }
  } catch (error) {
    logger.error("Error sending Discord notifications for container updates:", error);
  }
}

module.exports = {
  sendContainerUpdateNotifications,
  shouldNotifyContainerUpdate,
  normalizeDigest,
};
