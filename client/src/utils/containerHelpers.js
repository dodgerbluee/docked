/**
 * Utility functions for container operations
 */

import { computeHasUpdate } from "./containerUpdateHelpers";

/**
 * Check if a container is a Portainer instance
 * @param {Object} container - Container object
 * @returns {boolean} - True if container is Portainer
 */
export const isPortainerContainer = (container) => {
  const imageName = container.image?.toLowerCase() || "";
  const containerName = container.name?.toLowerCase() || "";
  return imageName.includes("portainer") || containerName.includes("portainer");
};

/**
 * Build containersByPortainer map for rendering
 * @param {Array} containers - Array of container objects
 * @returns {Object} - Map of containers grouped by Portainer URL
 */
export const buildContainersByPortainer = (containers) => {
  return containers.reduce((acc, container) => {
    const portainerUrl = container.portainerUrl || "Unknown";
    const portainerName = container.portainerName || portainerUrl || "Unknown";

    if (!acc[portainerUrl]) {
      acc[portainerUrl] = {
        name: portainerName,
        url: portainerUrl,
        containers: [],
        withUpdates: [],
        upToDate: [],
      };
    }
    acc[portainerUrl].containers.push(container);
    // Compute hasUpdate on-the-fly
    if (computeHasUpdate(container)) {
      acc[portainerUrl].withUpdates.push(container);
    } else {
      acc[portainerUrl].upToDate.push(container);
    }
    return acc;
  }, {});
};
