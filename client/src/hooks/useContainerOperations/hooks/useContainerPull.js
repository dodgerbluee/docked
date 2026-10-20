/**
 * Hook for container pull operations
 */

import { useCallback } from "react";
import { fetchContainersGraphql } from "../../../graphql/containers";
import { runContainerSync } from "../../../graphql/sync";
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
  setDockerHubDataPulled,
  setDataFetched,
  fetchUnusedImages,
  successfullyUpdatedContainersRef,
}) => {
  const handlePull = useCallback(
    async (additionalParams = {}) => {
      const { setLastPullTime } = additionalParams;
      try {
        setPulling(true);
        // Clear any previous errors when starting a new pull
        setError(null);
        setPullError(null);
        setPullSuccess(null);

        // Kick off the container sync in the Go API. The mutation registers a
        // 'running' docker-hub-pull batch run before responding, so the poll
        // inside runContainerSync always observes the new run.
        const syncPromise = runContainerSync();

        // Show the cached container set while the registry scan works.
        try {
          const { containers: apiContainers, stacks: apiStacks } = await fetchContainersGraphql();
          // updateContainersWithPreservedState keeps hasUpdate:false for
          // containers the user just upgraded in this session.
          const updatedContainers = updateContainersWithPreservedState(
            apiContainers,
            successfullyUpdatedContainersRef
          );
          setContainers(updatedContainers);
          setStacks(apiStacks);
          setDataFetched(true);
        } catch {
          // No cached data available yet - this is expected on first run
        }

        await syncPromise;

        // Registry data is fresh now — refetch so hasUpdate reflects the scan
        const { containers: apiContainers, stacks: apiStacks } = await fetchContainersGraphql();
        const updatedContainers = updateContainersWithPreservedState(
          apiContainers,
          successfullyUpdatedContainersRef
        );
        setContainers(updatedContainers);
        setStacks(apiStacks);

        setDockerHubDataPulled(true);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
        if (setLastPullTime) {
          const pullTime = new Date();
          setLastPullTime(pullTime);
          localStorage.setItem("lastPullTime", pullTime.toISOString());
        }

        // Clear any errors on successful pull
        setError(null);
        setPullError(null);
        setDataFetched(true);
        await fetchUnusedImages();
        setPullSuccess("Data pulled successfully!");
      } catch (err) {
        const errorMessage = await handleDockerHubError(err, setError);
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
      setDockerHubDataPulled,
      setDataFetched,
      fetchUnusedImages,
      successfullyUpdatedContainersRef,
    ]
  );

  return handlePull;
};
