/**
 * Utility functions for container state management
 * Shared logic for updating container state consistently
 */

import { computeHasUpdate } from "./containerUpdateHelpers";
import { getContainerKey } from "./containerHelpers";

/**
 * How long a locally-recorded "this container was just upgraded" verdict is
 * allowed to override the server. The pin exists to cover the window where the
 * runner has not re-reported the container yet, so the server still compares the
 * old digest; kept indefinitely it also hides a genuinely newer image that
 * arrives under the same mutable tag.
 */
export const UPDATED_PIN_TTL_MS = 120000;

/**
 * Updates containers while preserving hasUpdate:false for successfully updated containers
 * This ensures that containers that were just upgraded don't immediately show as having updates again
 *
 * @param {Array} apiContainers - Containers from API response
 * @param {Object} successfullyUpdatedContainersRef - Ref whose `current` is a Map of runner-qualified container key -> pin expiry (ms epoch)
 * @returns {Array} Updated containers with preserved hasUpdate state
 *
 * @example
 * const updated = updateContainersWithPreservedState(apiContainers, successfullyUpdatedContainersRef);
 */
export const updateContainersWithPreservedState = (
  apiContainers,
  successfullyUpdatedContainersRef
) => {
  const now = Date.now();
  return apiContainers.map((apiContainer) => {
    // Compute hasUpdate on-the-fly first
    const computedHasUpdate = computeHasUpdate(apiContainer);

    const pins = successfullyUpdatedContainersRef?.current;
    // Runner-qualified: a bare Docker id is only unique within one source, so
    // upgrading "radarr" on one runner would otherwise pin away the available
    // update of a same-named container on another.
    const key = getContainerKey(apiContainer);
    const pinnedUntil = typeof pins?.get === "function" ? pins.get(key) : undefined;

    if (pinnedUntil !== undefined) {
      if (pinnedUntil <= now) {
        // The grace window has passed. From here the server's verdict wins,
        // otherwise a real update under the same tag would stay hidden.
        pins.delete(key);
      } else {
        // If no update available, stop tracking it.
        if (!computedHasUpdate) pins.delete(key);
        return { ...apiContainer, hasUpdate: false };
      }
    }

    // Return container with computed hasUpdate
    return { ...apiContainer, hasUpdate: computedHasUpdate };
  });
};

/**
 * Records that a container upgrade succeeded, so the transient hasUpdate:true
 * from a not-yet-refreshed runner does not flash back in the UI.
 */
export const pinContainerAsUpdated = (successfullyUpdatedContainersRef, container) => {
  const pins = successfullyUpdatedContainersRef?.current;
  if (typeof pins?.set === "function")
    pins.set(getContainerKey(container), Date.now() + UPDATED_PIN_TTL_MS);
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
