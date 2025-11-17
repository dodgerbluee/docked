/**
 * Network Mode Service
 * Handles detection of container network mode relationships
 */

const portainerService = require("./portainerService");
const {
  buildContainerIdentifierMap,
  getContainerName,
  getContainerShortId,
} = require("../utils/containerIdentifiers");
const logger = require("../utils/logger");

/**
 * Detect network mode relationships between containers
 * Identifies which containers provide networks and which containers use network_mode
 * @param {Array} containers - Array of container objects from Portainer API
 * @param {string} portainerUrl - Portainer instance URL
 * @param {number} endpointId - Portainer endpoint ID
 * @returns {Promise<Object>} - Object with containerNetworkModes Map and containerByIdentifier Map
 */
async function detectNetworkModes(containers, portainerUrl, endpointId) {
  // First pass: build a map of all container identifiers (name, full ID, short ID) to container objects
  const containerByIdentifier = buildContainerIdentifierMap(containers);

  // Second pass: collect all container names and network modes to detect network providers
  const containerNetworkModes = new Map();

  for (const container of containers) {
    try {
      const details = await portainerService.getContainerDetails(
        portainerUrl,
        endpointId,
        container.Id
      );
      const networkMode = details.HostConfig?.NetworkMode || "";

      if (networkMode) {
        let targetContainer = null;

        if (networkMode.startsWith("service:")) {
          const targetName = networkMode.replace("service:", "");
          targetContainer = containerByIdentifier.get(targetName);
        } else if (networkMode.startsWith("container:")) {
          const target = networkMode.replace("container:", "");
          // Try to find by name, full ID, or short ID
          targetContainer = containerByIdentifier.get(target);
        }

        if (targetContainer) {
          const targetContainerName = getContainerName(targetContainer);
          const targetContainerId = targetContainer.Id;
          const targetContainerShortId = getContainerShortId(targetContainer);
          const dependentContainerName = getContainerName(container);

          // Store by all possible identifiers
          [targetContainerName, targetContainerId, targetContainerShortId].forEach((key) => {
            if (!containerNetworkModes.has(key)) {
              containerNetworkModes.set(key, []);
            }
            if (!containerNetworkModes.get(key).includes(dependentContainerName)) {
              containerNetworkModes.get(key).push(dependentContainerName);
            }
          });
        }
      }
    } catch (err) {
      // Skip containers we can't inspect
      logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
      continue;
    }
  }

  return {
    containerNetworkModes,
    containerByIdentifier,
  };
}

/**
 * Check if a container provides network (other containers depend on it)
 * @param {Object} container - Container object
 * @param {Map} containerNetworkModes - Map of network mode relationships
 * @returns {boolean} - True if container provides network
 */
function containerProvidesNetwork(container, containerNetworkModes) {
  const containerName = getContainerName(container);
  const containerId = container.Id;
  const containerShortId = getContainerShortId(container);

  // Check if this container is referenced by name, full ID, or short ID
  return (
    (containerNetworkModes.has(containerName) &&
      containerNetworkModes.get(containerName).length > 0) ||
    (containerNetworkModes.has(containerId) && containerNetworkModes.get(containerId).length > 0) ||
    (containerNetworkModes.has(containerShortId) &&
      containerNetworkModes.get(containerShortId).length > 0)
  );
}

/**
 * Check if a container uses network_mode
 * @param {Object} containerDetails - Container details from Portainer API
 * @returns {boolean} - True if container uses network_mode
 */
function containerUsesNetworkMode(containerDetails) {
  const networkMode = containerDetails.HostConfig?.NetworkMode || "";
  return (
    networkMode && (networkMode.startsWith("service:") || networkMode.startsWith("container:"))
  );
}

module.exports = {
  detectNetworkModes,
  containerProvidesNetwork,
  containerUsesNetworkMode,
};
