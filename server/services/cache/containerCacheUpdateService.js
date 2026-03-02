/**
 * Container Cache Update Service
 *
 * Handles updating the cache after container upgrades and other events.
 * Ensures cache is always in sync with reality.
 */

const logger = require("../../utils/logger");
const { upsertContainerWithVersion, deleteOldContainersByName } = require("../../db/containers");
const { getAllPortainerInstances } = require("../../db/portainerInstances");
const containerCacheService = require("./containerCacheService");

/**
 * Update cache after container upgrade
 *
 * This is called immediately after a container upgrade completes.
 * Updates the database cache with the new container digest.
 *
 * @param {number} userId - User ID
 * @param {string|null} portainerUrl - Portainer URL (null for runner backends)
 * @param {string} containerId - New container ID (after upgrade)
 * @param {string} containerName - Container name
 * @param {string} newDigest - New container digest
 * @param {Object} containerData - Additional container data
 * @param {number} [containerData.runnerId] - Runner ID (for runner-backed containers)
 * @returns {Promise<void>}
 */
async function updateCacheAfterUpgrade(
  userId,
  portainerUrl,
  containerId,
  containerName,
  newDigest,
  containerData = {}
) {
  try {
    const { runnerId } = containerData;
    const isRunner = !!runnerId;

    let instanceId = null;
    if (!isRunner) {
      // Get Portainer instance
      const instances = await getAllPortainerInstances(userId);
      const instance = instances.find((inst) => inst.url === portainerUrl);

      if (!instance) {
        logger.warn("Portainer instance not found for cache update", { portainerUrl, containerId });
        return;
      }
      instanceId = instance.id;
    }

    const cleanContainerName = containerName.replace("/", "");

    // Delete old container records with the same name but different ID
    // This is critical after upgrades because the new container has a different ID
    try {
      await deleteOldContainersByName(
        userId,
        instanceId,
        containerData.endpointId,
        cleanContainerName,
        containerId,
        runnerId || null
      );
    } catch (deleteError) {
      logger.warn("Error deleting old container records after upgrade:", deleteError);
      // Continue anyway - the upsert might handle it
    }

    // Update database cache with new container
    await upsertContainerWithVersion(
      userId,
      instanceId,
      {
        containerId,
        containerName: cleanContainerName,
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
      runnerId || null
    );

    // Invalidate memory cache for this user/instance
    containerCacheService.invalidateCache(userId, null, portainerUrl || null);

    logger.info("Updated cache after container upgrade", {
      userId,
      containerId: containerId.substring(0, 12),
      containerName: cleanContainerName,
      ...(isRunner ? { runnerId } : { portainerUrl }),
      newDigest: newDigest ? newDigest.substring(0, 12) : null,
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
  const updates = upgrades.map((upgrade) =>
    updateCacheAfterUpgrade(
      userId,
      upgrade.portainerUrl,
      upgrade.newContainerId || upgrade.containerId,
      upgrade.containerName,
      upgrade.newDigest,
      upgrade.containerData
    )
  );

  await Promise.allSettled(updates);

  // Invalidate all memory cache for user
  containerCacheService.invalidateCache(userId);
}

module.exports = {
  updateCacheAfterUpgrade,
  batchUpdateCacheAfterUpgrades,
};
