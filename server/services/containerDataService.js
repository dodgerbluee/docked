/**
 * Container Data Service
 *
 * Handles container data operations like counting unused images and merging container data.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const portainerService = require("./portainerService");
const containerFormattingService = require("./containerFormattingService");
const { getAllSourceInstances } = require("../db/index");

/**
 * Count unused images from a Portainer instance
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @returns {Promise<number>} - Count of unused images
 */
async function countUnusedImages(portainerUrl, endpointId) {
  try {
    // Fetch images and containers in parallel (already authenticated)
    const [images, containers] = await Promise.all([
      portainerService.getImages(portainerUrl, endpointId),
      portainerService.getContainers(portainerUrl, endpointId),
    ]);

    // OPTIMIZED: Use ImageID from container list response instead of calling
    // getContainerDetails per container. The list API already includes ImageID.
    const usedIds = new Set();
    const normalizeImageId = (id) => {
      const cleanId = id.replace(/^sha256:/, "");
      return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
    };

    for (const container of containers) {
      if (container.ImageID) {
        usedIds.add(container.ImageID);
        usedIds.add(normalizeImageId(container.ImageID));
      }
    }

    // Count unused images
    let unusedCount = 0;
    for (const image of images) {
      const imageIdNormalized = normalizeImageId(image.Id);
      const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);
      if (!isUsed) {
        unusedCount++;
      }
    }

    return unusedCount;
  } catch (error) {
    logger.error(`Error counting unused images from ${portainerUrl}:`, { error });
    return 0;
  }
}

/**
 * Merge existing container data with new container data when filtering by Portainer URL
 * @param {Array<Object>} allContainers - New containers from filtered instance
 * @param {Array<Object>} existingContainers - Existing containers from database
 * @param {number} userId - User ID
 * @param {string} filterSourceUrl - Source URL being filtered
 * @param {Map<string, Object>} trackedAppsMap - Map of tracked apps (optional)
 * @returns {Promise<Array<Object>>} - Merged container array
 */
async function mergeContainerData(
  allContainers,
  existingContainers,
  userId,
  filterSourceUrl,
  trackedAppsMap = null
) {
  if (!filterSourceUrl || !existingContainers) {
    return allContainers;
  }

  // Get user instances to map sourceInstanceId to URL
  const userInstances = await getAllSourceInstances(userId);
  const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));
  const instanceUrlMap = new Map(userInstances.map((inst) => [inst.url, inst.id]));
  const filteredInstanceId = instanceUrlMap.get(filterSourceUrl);

  // Remove containers from the filtered instance from existing data
  // Format existing containers to match allContainers structure
  const otherContainers = existingContainers
    .filter((c) => c.sourceInstanceId !== filteredInstanceId)
    .map((c) => {
      const instance = instanceMap.get(c.sourceInstanceId);
      return containerFormattingService.formatContainerFromDatabase(c, instance, trackedAppsMap);
    });

  // Combine with new containers from the filtered instance
  return [...allContainers, ...otherContainers];
}

/**
 * Build source instances array with container counts
 * @param {Array<Object>} allContainers - All containers
 * @param {Array<Object>} sourceInstances - Source instances
 * @returns {Array<Object>} - Source instances with container data
 */
function buildSourceInstancesArray(allContainers, sourceInstances) {
  return sourceInstances.map((instance) => {
    const sourceUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(sourceUrl).hostname);

    // Get containers for this instance
    const instanceContainers = allContainers.filter((c) => c.sourceUrl === sourceUrl);
    const withUpdates = instanceContainers.filter((c) => c.hasUpdate);
    const upToDate = instanceContainers.filter((c) => !c.hasUpdate);

    return {
      id: instance.id,
      name: instanceName,
      url: sourceUrl,
      containers: instanceContainers,
      withUpdates,
      upToDate,
      totalContainers: instanceContainers.length,
    };
  });
}

module.exports = {
  countUnusedImages,
  mergeContainerData,
  buildSourceInstancesArray,
};
