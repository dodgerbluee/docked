/**
 * Container Cache Update Service
 * 
 * Handles updating the cache after container upgrades and other events.
 * Ensures cache is always in sync with reality.
 */

const logger = require("../../utils/logger");
const { upsertContainerWithVersion } = require("../../db/containers");
const { getAllPortainerInstances } = require("../../db/portainerInstances");
const containerCacheService = require("./containerCacheService");

/**
 * Update cache after container upgrade
 * 
 * This is called immediately after a container upgrade completes.
 * Updates the database cache with the new container digest.
 * 
 * @param {number} userId - User ID
 * @param {string} portainerUrl - Portainer URL
 * @param {string} containerId - New container ID (after upgrade)
 * @param {string} containerName - Container name
 * @param {string} newDigest - New container digest
 * @param {Object} containerData - Additional container data
 * @returns {Promise<void>}
 */
async function updateCacheAfterUpgrade(
  userId,
  portainerUrl,
  containerId,
  containerName,
  newDigest,
  containerData = {},
) {
  try {
    // Get Portainer instance
    const instances = await getAllPortainerInstances(userId);
    const instance = instances.find(inst => inst.url === portainerUrl);

    if (!instance) {
      logger.warn("Portainer instance not found for cache update", { portainerUrl, containerId });
      return;
    }

    // Update database cache
    await upsertContainerWithVersion(
      userId,
      instance.id,
      {
        containerId,
        containerName: containerName.replace("/", ""),
        endpointId: containerData.endpointId,
        imageName: containerData.imageName,
        imageRepo: containerData.imageRepo,
        status: containerData.status,
        state: containerData.state,
        stackName: containerData.stackName,
        currentDigest: newDigest,
        imageCreatedDate: containerData.imageCreatedDate,
        usesNetworkMode: containerData.usesNetworkMode || false,
        providesNetwork: containerData.providesNetwork || false,
      },
      null, // No version data update needed
    );

    // Invalidate memory cache for this user/instance
    containerCacheService.invalidateCache(userId, null, portainerUrl);

    logger.info("Updated cache after container upgrade", {
      userId,
      containerId: containerId.substring(0, 12),
      containerName,
      portainerUrl,
    });
  } catch (error) {
    logger.error("Error updating cache after upgrade:", error);
    // Don't throw - cache update failure shouldn't break upgrade flow
  }
}

/**
 * Batch update cache after multiple upgrades
 * 
 * @param {number} userId - User ID
 * @param {Array} upgrades - Array of upgrade results
 * @returns {Promise<void>}
 */
async function batchUpdateCacheAfterUpgrades(userId, upgrades) {
  const updates = upgrades.map(upgrade =>
    updateCacheAfterUpgrade(
      userId,
      upgrade.portainerUrl,
      upgrade.newContainerId || upgrade.containerId,
      upgrade.containerName,
      upgrade.newDigest,
      upgrade.containerData,
    ),
  );

  await Promise.allSettled(updates);

  // Invalidate all memory cache for user
  containerCacheService.invalidateCache(userId);
}

module.exports = {
  updateCacheAfterUpgrade,
  batchUpdateCacheAfterUpgrades,
};

