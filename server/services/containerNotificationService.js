/**
 * Container Notification Service
 * 
 * Handles Discord notifications for newly detected container updates.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const { getAllPortainerInstances } = require("../db/index");

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
 * Check if a container update should trigger a notification
 * @param {Object} container - Current container data
 * @param {Object} previousContainer - Previous container data (from database)
 * @returns {Object} - Object with shouldNotify and isNewlyIdentified flags
 */
function shouldNotifyContainerUpdate(container, previousContainer) {
  let shouldNotify = false;
  let isNewlyIdentified = false;

  if (!previousContainer) {
    // New container with update - always notify
    shouldNotify = true;
    isNewlyIdentified = true;
  } else if (!previousContainer.hasUpdate && container.hasUpdate) {
    // Container previously had no update, now has update - new update detected
    shouldNotify = true;
    isNewlyIdentified = true;
  } else if (previousContainer.hasUpdate && container.hasUpdate) {
    // Both had updates - check if the latest version/digest changed
    const previousLatestDigest = previousContainer.latestDigest || null;
    const currentLatestDigest =
      container.latestDigest || container.latestDigestFull || null;
    const previousLatestVersion = previousContainer.latestVersion || null;
    const currentLatestVersion =
      container.latestVersion || container.newVersion || container.latestTag || null;

    const normalizedPreviousDigest = normalizeDigest(previousLatestDigest);
    const normalizedCurrentDigest = normalizeDigest(currentLatestDigest);

    // Notify if digest or version changed (newer update available)
    // Only notify if both values exist and are different
    if (
      normalizedCurrentDigest &&
      normalizedPreviousDigest &&
      normalizedCurrentDigest !== normalizedPreviousDigest
    ) {
      shouldNotify = true;
      isNewlyIdentified = true;
    } else if (
      currentLatestVersion &&
      previousLatestVersion &&
      currentLatestVersion !== previousLatestVersion
    ) {
      shouldNotify = true;
      isNewlyIdentified = true;
    }
    // If neither changed, don't notify (same update still available)
    // Also don't notify if one is null and the other isn't (data inconsistency, not a new update)
  }

  return { shouldNotify, isNewlyIdentified };
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

    // Create a map of previous containers by unique identifier
    // Use combination of name, portainerUrl, and endpointId for uniqueness
    // (Name is more stable than ID, which changes after upgrades)
    const previousContainersMap = new Map();
    const userInstances = await getAllPortainerInstances(userId);
    const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

    previousContainers.forEach((container) => {
      // Get portainerUrl from instance
      const instance = instanceMap.get(container.portainerInstanceId);
      const portainerUrl = instance ? instance.url : null;
      // Use name as primary key since container IDs change after upgrades
      const key = `${container.containerName}-${portainerUrl}-${container.endpointId}`;

      previousContainersMap.set(key, {
        name: container.containerName,
        portainerUrl: portainerUrl,
        endpointId: container.endpointId,
        hasUpdate: container.hasUpdate || false,
        latestDigest: normalizeDigest(container.latestDigest),
        latestVersion: container.latestVersion || container.latestTag || null,
        currentDigest: normalizeDigest(container.currentDigest),
      });
    });

    // Check each new container for newly detected updates
    for (const container of allContainers) {
      if (container.hasUpdate) {
        // Match by name (more stable than ID which changes after upgrades)
        const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
        const previousContainer = previousContainersMap.get(key);

        const { shouldNotify, isNewlyIdentified } = shouldNotifyContainerUpdate(
          container,
          previousContainer
        );

        // Log all newly identified upgrades (regardless of Discord notification)
        if (isNewlyIdentified) {
          const imageName = container.image || "Unknown";
          const currentVersion = container.currentVersion || container.currentTag || "Unknown";
          const latestVersion =
            container.newVersion || container.latestTag || container.latestVersion || "Unknown";
          const currentDigest = container.currentDigest || container.currentDigestFull || "N/A";
          const latestDigest = container.latestDigest || container.latestDigestFull || "N/A";

          const logData = {
            module: "containerQueryService",
            operation: "getAllContainersWithUpdates",
            containerName: container.name,
            imageName: imageName,
            currentDigest:
              currentDigest.length > 12 ? currentDigest.substring(0, 12) + "..." : currentDigest,
            latestDigest:
              latestDigest.length > 12 ? latestDigest.substring(0, 12) + "..." : latestDigest,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            portainerUrl: container.portainerUrl || "Unknown",
            endpointId: container.endpointId || "Unknown",
            userId: userId || "batch",
          };

          // Use batch logger if available (for batch job logs), otherwise use regular logger
          const logMessage = `Newly identified upgrade: ${container.name} (${imageName}) - ${currentVersion} → ${latestVersion}`;
          if (batchLogger) {
            batchLogger.info(logMessage, logData);
          } else {
            logger.info("Newly identified upgrade detected", logData);
          }
        }

        if (shouldNotify) {
          // Format container data for notification
          const imageName = container.image || "Unknown";
          const currentVersion = container.currentVersion || container.currentTag || "Unknown";
          const latestVersion =
            container.newVersion || container.latestTag || container.latestVersion || "Unknown";

          await discord.queueNotification({
            id: container.id,
            name: container.name,
            imageName: imageName,
            githubRepo: null,
            sourceType: "docker",
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            latestDigest: container.latestDigest || container.latestDigestFull || null,
            latestVersionPublishDate: container.latestPublishDate || null,
            releaseUrl: null, // Containers don't have release URLs
            notificationType: "portainer-container",
            userId: userId,
          });
        }
      }
    }
  } catch (error) {
    // Don't fail the update check if notification fails
    logger.error("Error sending Discord notifications for container updates:", error);
  }
}

module.exports = {
  sendContainerUpdateNotifications,
  shouldNotifyContainerUpdate,
  normalizeDigest,
};

