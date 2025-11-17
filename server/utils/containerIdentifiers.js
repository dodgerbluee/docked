/**
 * Container Identifier Utilities
 * Helper functions for mapping container identifiers (name, ID, short ID)
 */

/**
 * Build a map of container identifiers to container objects
 * Maps: name -> container, fullId -> container, shortId -> container
 * @param {Array} containers - Array of container objects from Portainer API
 * @returns {Map} - Map of identifier -> container
 */
function buildContainerIdentifierMap(containers) {
  const map = new Map();
  for (const container of containers) {
    const containerName = container.Names[0]?.replace("/", "") || container.Id.substring(0, 12);
    const containerId = container.Id;
    const containerShortId = container.Id.substring(0, 12);
    map.set(containerName, container);
    map.set(containerId, container);
    map.set(containerShortId, container);
  }
  return map;
}

/**
 * Get container name from container object
 * @param {Object} container - Container object from Portainer API
 * @returns {string} - Container name
 */
function getContainerName(container) {
  return container.Names[0]?.replace("/", "") || container.Id.substring(0, 12);
}

/**
 * Get container short ID (first 12 characters)
 * @param {Object} container - Container object from Portainer API
 * @returns {string} - Short container ID
 */
function getContainerShortId(container) {
  return container.Id.substring(0, 12);
}

module.exports = {
  buildContainerIdentifierMap,
  getContainerName,
  getContainerShortId,
};
