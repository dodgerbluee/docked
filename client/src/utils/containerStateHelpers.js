/**
 * Utility functions for container state management
 * Shared logic for updating container state consistently
 */

import { computeHasUpdate } from "./containerUpdateHelpers";

/**
 * Updates containers while preserving hasUpdate:false for successfully updated containers
 * This ensures that containers that were just upgraded don't immediately show as having updates again
 *
 * @param {Array} apiContainers - Containers from API response
 * @param {Object} successfullyUpdatedContainersRef - Ref object with current property (Set) tracking successfully updated containers
 * @returns {Array} Updated containers with preserved hasUpdate state
 *
 * @example
 * const updated = updateContainersWithPreservedState(apiContainers, successfullyUpdatedContainersRef);
 */
export const updateContainersWithPreservedState = (
  apiContainers,
  successfullyUpdatedContainersRef
) => {
  return apiContainers.map((apiContainer) => {
    // Compute hasUpdate on-the-fly first
    const computedHasUpdate = computeHasUpdate(apiContainer);

    if (successfullyUpdatedContainersRef?.current?.has(apiContainer.id)) {
      // If container was successfully updated, force hasUpdate to false
      // (even if digests don't match yet, we know it was just upgraded)
      if (!computedHasUpdate) {
        // If no update available, remove from tracking
        successfullyUpdatedContainersRef.current.delete(apiContainer.id);
      }
      return { ...apiContainer, hasUpdate: false };
    }

    // Return container with computed hasUpdate
    return { ...apiContainer, hasUpdate: computedHasUpdate };
  });
};

/**
 * Checks if Docker Hub data is present in containers
 * Looks for latestDigest, latestTag, or latestVersion properties
 *
 * @param {Array} containers - Array of containers to check
 * @returns {boolean} True if any container has Docker Hub data
 *
 * @example
 * if (hasDockerHubData(containers)) {
 *   setDockerHubDataPulled(true);
 * }
 */
export const hasDockerHubData = (containers) => {
  return containers.some(
    (container) => container.latestDigest || container.latestTag || container.latestVersion
  );
};
