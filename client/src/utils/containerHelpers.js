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
    let key, name;
    if (container.source === "runner") {
      key = `runner:${container.runnerId}`;
      name = container.runnerName || "Runner";
    } else {
      key = container.portainerUrl || "Unknown";
      name = container.portainerName || key;
    }

    if (!acc[key]) {
      acc[key] = {
        name,
        url: key,
        isRunner: container.source === "runner",
        runnerId: container.runnerId || null,
        containers: [],
        withUpdates: [],
        upToDate: [],
      };
    }
    acc[key].containers.push(container);
    // Compute hasUpdate on-the-fly
    if (computeHasUpdate(container)) {
      acc[key].withUpdates.push(container);
    } else {
      acc[key].upToDate.push(container);
    }
    return acc;
  }, {});
};
