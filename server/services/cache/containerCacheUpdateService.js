/**
 * Container Cache Update Service
 *
 * Handles updating the cache after container upgrades and other events.
 * Ensures cache is always in sync with reality.
 */

const logger = require("../../utils/logger");
const { upsertContainerWithVersion, deleteOldContainersByName } = require("../../db/containers");
const containerCacheService = require("./containerCacheService");

/**
 * Update cache after container upgrade
 *
 * This is called immediately after a container upgrade completes.
 * Updates the database cache with the new container digest.
 *
 * @param {number} userId - User ID
 * @param {string} containerId - New container ID (after upgrade)
 * @param {string} containerName - Container name
 * @param {string} newDigest - New container digest
 * @param {Object} containerData - Additional container data
 * @param {number} [containerData.runnerId] - Runner ID (for runner-backed containers)
 * @returns {Promise<void>}
 */
async function updateCacheAfterUpgrade(
  userId,
  containerId,
  containerName,
  newDigest,
  containerData = {}
) {
  try {
    const { runnerId } = containerData;

    const cleanContainerName = containerName.replace("/", "");

    // Delete old container records with the same name but different ID
    // This is critical after upgrades because the new container has a different ID
    try {
      await deleteOldContainersByName(
        userId,
        null,
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
      null,
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
        // Include repoDigests so computeHasUpdate can find latestDigest in the array.
        // Falls back to [newDigest] so the record always has at least the container's own digest.
        repoDigests: containerData.repoDigests || [newDigest],
      },
      null, // No version data update needed
      runnerId || null
    );

    // Invalidate memory cache for this user
    containerCacheService.invalidateCache(userId);

    logger.info("Updated cache after container upgrade", {
      userId,
      containerId: containerId.substring(0, 12),
      containerName: cleanContainerName,
      ...(runnerId ? { runnerId } : {}),
      newDigest: newDigest ? newDigest.substring(0, 12) : null,
    });
  } catch (error) {
    logger.error("Error updating cache after upgrade:", error);
    // Don't throw - cache update failure shouldn't break upgrade flow
  }
}

module.exports = {
  updateCacheAfterUpgrade,
};
