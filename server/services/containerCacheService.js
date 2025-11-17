/**
 * Container Cache Service
 * Handles container cache operations
 */

const portainerService = require("./portainerService");
const { getContainerCache, setContainerCache } = require("../db/database");
const logger = require("../utils/logger");

/**
 * Refetch container information from Portainer and update cache
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string[]} containerIds - Array of container IDs to refetch
 * @returns {Promise<void>}
 */
async function refetchAndUpdateContainerCache(portainerUrl, endpointId, containerIds) {
  try {
    const cached = await getContainerCache("containers");
    if (!cached || !cached.containers || !Array.isArray(cached.containers)) {
      logger.debug("No cache found or invalid cache structure, skipping update");
      return;
    }

    const updatedContainers = [...cached.containers];
    let cacheUpdated = false;

    for (const containerId of containerIds) {
      try {
        // Get fresh container details from Portainer
        const containerDetails = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          containerId
        );

        const containerName = containerDetails.Name?.replace("/", "") || "";
        const imageName = containerDetails.Config.Image || "";
        const containerStatus =
          containerDetails.State?.Status ||
          (containerDetails.State?.Running ? "running" : "exited");
        const isRunning = containerStatus === "running";

        // Find and update the container in cache
        const containerIndex = updatedContainers.findIndex((cachedContainer) => {
          // Match by ID (full or shortened)
          const matchesId =
            cachedContainer.id === containerId ||
            cachedContainer.id?.substring(0, 12) === containerId.substring(0, 12) ||
            containerId.substring(0, 12) === cachedContainer.id?.substring(0, 12);

          // Also match by name as fallback
          const matchesName = cachedContainer.name === containerName;

          return matchesId || matchesName;
        });

        if (containerIndex !== -1) {
          // Update existing cache entry
          updatedContainers[containerIndex] = {
            ...updatedContainers[containerIndex],
            id: containerId, // Update with full container ID
            name: containerName,
            image: imageName,
            status: containerStatus,
            isRunning: isRunning,
            // Preserve other fields like hasUpdate, portainerUrl, etc.
          };
          cacheUpdated = true;
          logger.debug(
            `Updated cache for container ${containerName} (${containerId.substring(0, 12)})`
          );
        } else {
          logger.debug(
            `Container ${containerName} (${containerId.substring(0, 12)}) not found in cache, skipping update`
          );
        }
      } catch (err) {
        logger.warn(
          `Failed to refetch details for container ${containerId.substring(0, 12)}: ${err.message}`
        );
        // Continue with other containers
      }
    }

    if (cacheUpdated) {
      const updatedCache = {
        ...cached,
        containers: updatedContainers,
      };
      await setContainerCache("containers", updatedCache);
      logger.debug(`Cache updated for ${containerIds.length} container(s)`);
    }
  } catch (err) {
    logger.error(`Error refetching and updating container cache: ${err.message}`);
    throw err;
  }
}

module.exports = {
  refetchAndUpdateContainerCache,
};
