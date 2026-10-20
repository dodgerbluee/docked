/**
 * Hook for container data clearing operations
 */

import { useCallback } from "react";
import { graphqlClient } from "../../../graphql/client";
import { CLEAR_CONTAINER_DATA_MUTATION } from "../../../graphql/queries";

/**
 * Hook for container data clearing operations
 * @param {Object} params - Parameters
 * @param {Function} params.setClearingState - Set clearing state function
 * @param {Function} params.setError - Set error function
 * @param {Function} params.setContainers - Set containers function
 * @param {Function} params.setStacks - Set stacks function
 * @param {Function} params.setUnusedImagesCount - Set unused images count function
 * @param {Function} params.setUnusedImages - Set unused images function
 * @param {Function} params.setSelectedContainers - Set selected containers function
 * @param {Function} params.setSelectedImages - Set selected images function
 * @param {Function} params.setDockerHubDataPulled - Set Docker Hub data pulled function
 * @param {Function} params.setDataFetched - Set data fetched function
 * @param {Function} params.fetchContainers - Fetch containers function
 * @returns {Function} Clear handler
 */
export const useContainerClear = ({
  setClearingState,
  setError,
  setContainers,
  setStacks,
  setUnusedImagesCount,
  setUnusedImages,
  setSelectedContainers,
  setSelectedImages,
  setDockerHubDataPulled,
  setDataFetched,
  fetchContainers,
}) => {
  const handleClear = useCallback(
    async (skipConfirmation = false) => {
      try {
        setClearingState(true);
        setError(null);

        const result = await graphqlClient.mutation(CLEAR_CONTAINER_DATA_MUTATION, {}).toPromise();
        if (result.error) throw result.error;

        const clearFrontendState = () => {
          setContainers([]);
          setStacks([]);
          setUnusedImagesCount(0);
          setUnusedImages([]);
          setSelectedContainers(new Set());
          setSelectedImages(new Set());
          setDockerHubDataPulled(false);
          localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
          setDataFetched(false);
          setError(null);
        };

        clearFrontendState();
        try {
          await fetchContainers(true, null, true);
        } catch (fetchError) {
          console.error("Error fetching container data:", fetchError);
          setError(fetchError?.message || "Failed to fetch container data after clearing cache");
        } finally {
          setClearingState(false);
        }
      } catch (err) {
        console.error("Error clearing cache:", err);
        setError(err?.message || "Failed to clear cache");
      } finally {
        setClearingState(false);
      }
    },
    [
      setClearingState,
      setContainers,
      setStacks,
      setUnusedImages,
      setUnusedImagesCount,
      setSelectedContainers,
      setSelectedImages,
      setDockerHubDataPulled,
      setDataFetched,
      setError,
      fetchContainers,
    ]
  );

  return handleClear;
};
