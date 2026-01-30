/**
 * Hook for container pull operations
 */

import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";
import { handleDockerHubError } from "../../../utils/apiErrorHandler";
import { updateContainersWithPreservedState } from "../../../utils/containerStateHelpers";

/**
 * Hook for container pull operations
 * @param {Object} params - Parameters
 * @param {Function} params.setPulling - Set pulling state function
 * @param {Function} params.setError - Set error function
 * @param {Function} params.setPullError - Set pull error function
 * @param {Function} params.setPullSuccess - Set pull success function
 * @param {Function} params.setContainers - Set containers function
 * @param {Function} params.setStacks - Set stacks function
 * @param {Function} params.setUnusedImagesCount - Set unused images count function
 * @param {Function} params.setDockerHubDataPulled - Set Docker Hub data pulled function
 * @param {Function} params.setDataFetched - Set data fetched function
 * @param {Function} params.fetchUnusedImages - Fetch unused images function
 * @param {Object} params.successfullyUpdatedContainersRef - Ref for successfully updated containers
 * @returns {Function} Pull handler
 */
export const useContainerPull = ({
  setPulling,
  setError,
  setPullError,
  setPullSuccess,
  setContainers,
  setStacks,
  setUnusedImagesCount,
  setDockerHubDataPulled,
  setDataFetched,
  fetchUnusedImages,
  successfullyUpdatedContainersRef,
}) => {
  const handlePull = useCallback(
    async (additionalParams = {}) => {
      const {
        setPortainerInstancesFromAPI,
        setLastPullTime,
        fetchDockerHubCredentials,
        dockerHubCredentials,
      } = additionalParams;
      try {
        setPulling(true);
        // Clear any previous errors when starting a new pull
        setError(null);
        setPullError(null);
        setPullSuccess(null);

        const pullPromise = axios.post(
          `${API_BASE_URL}/api/containers/pull`,
          {},
          {
            timeout: 300000,
          }
        );

        try {
          // When pulling, fetch cached data WITH refreshUpdates=true to get fresh Portainer data
          // This ensures we show the correct hasUpdate status (detects manual upgrades)
          // instead of showing stale cached hasUpdate values
          // Use new cache service for better experience
          const cachedResponse = await axios.get(
            `${API_BASE_URL}/api/containers?useNewCache=true&portainerOnly=true&refreshUpdates=true`
          );
          if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
            const apiContainers = cachedResponse.data.containers || [];
            // Use updateContainersWithPreservedState to recompute hasUpdate on-the-fly
            const updatedContainers = updateContainersWithPreservedState(
              apiContainers,
              successfullyUpdatedContainersRef
            );
            setContainers(updatedContainers);
            setStacks(cachedResponse.data.stacks || []);
            setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

            if (cachedResponse.data.portainerInstances && setPortainerInstancesFromAPI) {
              setPortainerInstancesFromAPI(cachedResponse.data.portainerInstances);
            }
            setDataFetched(true);
          }
        } catch {
          // No cached data available yet - this is expected on first run
        }

        const response = await pullPromise;

        if (response.data.success === false) {
          throw new Error(
            response.data.error || response.data.message || "Failed to pull container data"
          );
        }

        if (response.data.grouped && response.data.stacks) {
          const apiContainers = response.data.containers || [];
          // Use updateContainersWithPreservedState to recompute hasUpdate on-the-fly
          // This ensures all containers have correct hasUpdate status even after pull
          const updatedContainers = updateContainersWithPreservedState(
            apiContainers,
            successfullyUpdatedContainersRef
          );
          setContainers(updatedContainers);
          setStacks(response.data.stacks || []);
          setUnusedImagesCount(response.data.unusedImagesCount || 0);

          if (response.data.portainerInstances && setPortainerInstancesFromAPI) {
            setPortainerInstancesFromAPI(response.data.portainerInstances);
          }

          setDockerHubDataPulled(true);
          localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
          if (setLastPullTime) {
            const pullTime = new Date();
            setLastPullTime(pullTime);
            localStorage.setItem("lastPullTime", pullTime.toISOString());
          }
        } else {
          const apiContainers = Array.isArray(response.data) ? response.data : [];
          // Use updateContainersWithPreservedState to recompute hasUpdate on-the-fly
          const updatedContainers = updateContainersWithPreservedState(
            apiContainers,
            successfullyUpdatedContainersRef
          );
          setContainers(updatedContainers);
          setStacks([]);
          setUnusedImagesCount(0);
        }

        // Clear any errors on successful pull
        setError(null);
        setPullError(null);
        setDataFetched(true);
        await fetchUnusedImages();
        setPullSuccess("Data pulled successfully!");
      } catch (err) {
        // fetchDockerHubCredentials and dockerHubCredentials come from additionalParams
        // They're optional and may not be provided, so handle gracefully
        const errorMessage = await handleDockerHubError(
          err,
          fetchDockerHubCredentials || null,
          dockerHubCredentials || null,
          setError
        );
        setPullError(errorMessage);
        console.error("Error pulling containers:", err);
      } finally {
        setPulling(false);
      }
    },
    [
      setPulling,
      setError,
      setPullError,
      setPullSuccess,
      setContainers,
      setStacks,
      setUnusedImagesCount,
      setDockerHubDataPulled,
      setDataFetched,
      fetchUnusedImages,
      successfullyUpdatedContainersRef,
    ]
  );

  return handlePull;
};
