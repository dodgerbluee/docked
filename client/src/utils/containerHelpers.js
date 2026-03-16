/**
 * Utility functions for container operations
 */

import { computeHasUpdate } from "./containerUpdateHelpers";

/**
 * Check if a container is the Portainer application itself.
 * This is a functional check (detects the actual Portainer Docker image),
 * NOT a branding reference.
 * @param {Object} container - Container object
 * @returns {boolean} - True if container is Portainer
 */
export const isPortainerContainer = (container) => {
  const imageName = container.image?.toLowerCase() || "";
  const containerName = container.name?.toLowerCase() || "";
  return imageName.includes("portainer") || containerName.includes("portainer");
};

/**
 * Build containersBySource map for rendering
 * @param {Array} containers - Array of container objects
 * @returns {Object} - Map of containers grouped by source (instance URL or runner ID)
 */
export const buildContainersBySource = (containers) => {
  return containers.reduce((acc, container) => {
    let key, name;
    if (container.source === "runner") {
      key = `runner:${container.runnerId}`;
      name = container.runnerName || "Runner";
    } else {
      key = container.sourceUrl || container.portainerUrl || "Unknown";
      name = container.sourceName || container.portainerName || key;
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
