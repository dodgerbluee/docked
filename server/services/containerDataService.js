/**
 * Container Data Service
 *
 * Handles container data operations like counting unused images and merging container data.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const portainerService = require("./portainerService");
const containerFormattingService = require("./containerFormattingService");
const { getAllPortainerInstances } = require("../db/index");

/**
 * Count unused images from a Portainer instance
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @returns {Promise<number>} - Count of unused images
 */
async function countUnusedImages(portainerUrl, endpointId) {
  try {
    const images = await portainerService.getImages(portainerUrl, endpointId);
    const containers = await portainerService.getContainers(portainerUrl, endpointId);

    // Get all used image IDs (normalize to handle both full and shortened IDs)
    const usedIds = new Set();
    const normalizeImageId = id => {
      const cleanId = id.replace(/^sha256:/, "");
      return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
    };

    for (const container of containers) {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        container.Id,
      );
      if (details.Image) {
        usedIds.add(details.Image);
        usedIds.add(normalizeImageId(details.Image));
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
 * @param {string} filterPortainerUrl - Portainer URL being filtered
 * @param {Map<string, Object>} trackedAppsMap - Map of tracked apps (optional)
 * @returns {Promise<Array<Object>>} - Merged container array
 */
async function mergeContainerData(
  allContainers,
  existingContainers,
  userId,
  filterPortainerUrl,
  trackedAppsMap = null,
) {
  if (!filterPortainerUrl || !existingContainers) {
    return allContainers;
  }

  // Get user instances to map portainerInstanceId to URL
  const userInstances = await getAllPortainerInstances(userId);
  const instanceMap = new Map(userInstances.map(inst => [inst.id, inst]));
  const instanceUrlMap = new Map(userInstances.map(inst => [inst.url, inst.id]));
  const filteredInstanceId = instanceUrlMap.get(filterPortainerUrl);

  // Remove containers from the filtered instance from existing data
  // Format existing containers to match allContainers structure
  const otherContainers = existingContainers
    .filter(c => c.portainerInstanceId !== filteredInstanceId)
    .map(c => {
      const instance = instanceMap.get(c.portainerInstanceId);
      return containerFormattingService.formatContainerFromDatabase(c, instance, trackedAppsMap);
    });

  // Combine with new containers from the filtered instance
  return [...allContainers, ...otherContainers];
}

/**
 * Build Portainer instances array with container counts
 * @param {Array<Object>} allContainers - All containers
 * @param {Array<Object>} portainerInstances - Portainer instances
 * @returns {Array<Object>} - Portainer instances with container data
 */
function buildPortainerInstancesArray(allContainers, portainerInstances) {
  return portainerInstances.map(instance => {
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);

    // Get containers for this instance
    const instanceContainers = allContainers.filter(c => c.portainerUrl === portainerUrl);
    const withUpdates = instanceContainers.filter(c => c.hasUpdate);
    const upToDate = instanceContainers.filter(c => !c.hasUpdate);

    return {
      id: instance.id,
      name: instanceName,
      url: portainerUrl,
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
  buildPortainerInstancesArray,
};
