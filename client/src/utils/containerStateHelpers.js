/**
 * Utility functions for container state management
 * Shared logic for updating container state consistently
 */

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
    if (successfullyUpdatedContainersRef?.current?.has(apiContainer.id)) {
      if (!apiContainer.hasUpdate) {
        successfullyUpdatedContainersRef.current.delete(apiContainer.id);
      }
      return { ...apiContainer, hasUpdate: false };
    }
    return apiContainer;
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
    (container) =>
      container.latestDigest || container.latestTag || container.latestVersion
  );
};

/**
 * Updates container state from pull response
 * Handles the complete state update including containers, stacks, unused images count,
 * Portainer instances, and Docker Hub data pulled flag
 * 
 * @param {Object} responseData - Response data from pull API
 * @param {Object} setters - Object containing state setters
 * @param {Function} setters.setContainers - Setter for containers state
 * @param {Function} setters.setStacks - Setter for stacks state
 * @param {Function} setters.setUnusedImagesCount - Setter for unused images count
 * @param {Function} setters.setPortainerInstancesFromAPI - Setter for Portainer instances (optional)
 * @param {Function} setters.setDockerHubDataPulled - Setter for Docker Hub data pulled flag
 * @param {Object} successfullyUpdatedContainersRef - Ref object tracking successfully updated containers
 * 
 * @example
 * updateStateFromPullResponse(
 *   response.data,
 *   { setContainers, setStacks, setUnusedImagesCount, setDockerHubDataPulled },
 *   successfullyUpdatedContainersRef
 * );
 */
export const updateStateFromPullResponse = (
  responseData,
  setters,
  successfullyUpdatedContainersRef
) => {
  const {
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
  } = setters;

  if (responseData && responseData.grouped && responseData.stacks) {
    const apiContainers = responseData.containers || [];
    const updatedContainers = updateContainersWithPreservedState(
      apiContainers,
      successfullyUpdatedContainersRef
    );

    setContainers(updatedContainers);
    setStacks(responseData.stacks || []);
    setUnusedImagesCount(responseData.unusedImagesCount || 0);

    // Update portainerInstances from response
    if (responseData.portainerInstances && setPortainerInstancesFromAPI) {
      setPortainerInstancesFromAPI(responseData.portainerInstances);
    }

    // Check if Docker Hub data is present
    if (hasDockerHubData(apiContainers)) {
      setDockerHubDataPulled(true);
      localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
    }
  }
};

