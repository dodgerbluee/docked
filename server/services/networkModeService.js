/**
 * Network Mode Service
 * Handles detection of container network mode relationships
 */

const {
  buildContainerIdentifierMap,
  getContainerName,
  getContainerShortId,
} = require("../utils/containerIdentifiers");

/**
 * Detect network mode relationships between containers
 * Uses data already available in the container list response (HostConfig.NetworkMode)
 * instead of making per-container API calls.
 *
 * @param {Array} containers - Array of container objects from Portainer API (/containers/json)
 * @param {string} _portainerUrl - (unused, kept for backward compat)
 * @param {number} _endpointId - (unused, kept for backward compat)
 * @param {Map} [detailsMap] - (unused, kept for backward compat) Pre-fetched container details
 * @returns {Promise<Object>} - Object with containerNetworkModes Map and containerByIdentifier Map
 */
async function detectNetworkModes(containers, _portainerUrl, _endpointId, _detailsMap) {
  // First pass: build a map of all container identifiers (name, full ID, short ID) to container objects
  const containerByIdentifier = buildContainerIdentifierMap(containers);

  // Second pass: read NetworkMode directly from list data (no API calls needed)
  // Docker's /containers/json response includes HostConfig.NetworkMode for each container
  const containerNetworkModes = new Map();

  for (const container of containers) {
    const networkMode = container.HostConfig?.NetworkMode || "";

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
 * Works with both container list objects and detail objects (both have HostConfig.NetworkMode)
 * @param {Object} containerOrDetails - Container object from list API or details API
 * @returns {boolean} - True if container uses network_mode
 */
function containerUsesNetworkMode(containerOrDetails) {
  const networkMode = containerOrDetails.HostConfig?.NetworkMode || "";
  return (
    networkMode && (networkMode.startsWith("service:") || networkMode.startsWith("container:"))
  );
}

module.exports = {
  detectNetworkModes,
  containerProvidesNetwork,
  containerUsesNetworkMode,
};
