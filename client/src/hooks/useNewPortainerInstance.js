import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { API_TIMEOUTS, TAB_NAMES, CONTENT_TABS } from "../constants/apiConstants";
import { updateStateFromPullResponse } from "../utils/containerStateHelpers";

/**
 * Custom hook for handling new Portainer instance creation
 * Extracts the complex logic for fetching data after adding a new instance
 * Handles Docker Hub pull, error handling, and navigation after instance creation
 * 
 * @param {Object} params - Hook parameters
 * @param {Function} params.setPortainerInstancesFromAPI - Setter for Portainer instances
 * @param {Function} params.setContainers - Setter for containers state
 * @param {Function} params.setStacks - Setter for stacks state
 * @param {Function} params.setUnusedImagesCount - Setter for unused images count
 * @param {Function} params.setDockerHubDataPulled - Setter for Docker Hub data pulled flag
 * @param {Function} params.setLoading - Setter for loading state
 * @param {Function} params.setActiveTab - Setter for active tab
 * @param {Function} params.setContentTab - Setter for content tab
 * @param {Function} params.fetchContainers - Function to fetch containers
 * @param {Function} params.fetchUnusedImages - Function to fetch unused images
 * @param {Object} params.successfullyUpdatedContainersRef - Ref tracking successfully updated containers
 * @returns {Object} Hook return value
 * @returns {Function} return.handleNewInstanceDataFetch - Handler for new instance data fetching
 * 
 * @example
 * const { handleNewInstanceDataFetch } = useNewPortainerInstance({
 *   setPortainerInstancesFromAPI,
 *   setContainers,
 *   // ... other setters
 * });
 */
export const useNewPortainerInstance = ({
  setPortainerInstancesFromAPI,
  setContainers,
  setStacks,
  setUnusedImagesCount,
  setDockerHubDataPulled,
  setLoading,
  setActiveTab,
  setContentTab,
  fetchContainers,
  fetchUnusedImages,
  successfullyUpdatedContainersRef,
}) => {
  const handleNewInstanceDataFetch = useCallback(
    async (newInstanceData) => {
      if (!newInstanceData) return;

      // Ensure the instance is in state before setting active tab to prevent safety check redirect
      if (newInstanceData.id && newInstanceData.url) {
        // Set loading state to show spinner while fetching data
        setLoading(true);

        // Trigger Docker Hub pull for the new instance
        // This will automatically fetch from Portainer and Docker Hub for this instance
        // and merge the data with existing cache, preserving other instances' containers
        try {
          const pullResponse = await axios.post(
            `${API_BASE_URL}/api/containers/pull`,
            { portainerUrl: newInstanceData.url },
            { timeout: API_TIMEOUTS.PULL_OPERATION }
          );

          // Use the response data directly to update state (preserves existing containers)
          // This ensures we have the latest data without waiting for cache
          if (pullResponse.data && pullResponse.data.grouped && pullResponse.data.stacks) {
            updateStateFromPullResponse(
              pullResponse.data,
              {
                setContainers,
                setStacks,
                setUnusedImagesCount,
                setPortainerInstancesFromAPI,
                setDockerHubDataPulled,
              },
              successfullyUpdatedContainersRef
            );

            // Fetch unused images to complete the update
            await fetchUnusedImages();
          } else {
            // Fallback to fetching from cache if response format is unexpected
            await fetchContainers(false);
          }

          // After data is loaded, redirect to Summary page
          setActiveTab(TAB_NAMES.SUMMARY);
          setContentTab(CONTENT_TABS.CURRENT);
        } catch (pullErr) {
          // If Docker Hub pull fails, still try to fetch from Portainer to get basic data
          console.error("Error pulling Docker Hub data for new instance:", pullErr);
          try {
            // Fetch from Portainer only to get basic container data
            // This will include the new instance and merge with existing cache
            await fetchContainers(false, null, true);
            // After data is loaded, redirect to Summary page
            setActiveTab(TAB_NAMES.SUMMARY);
            setContentTab(CONTENT_TABS.CURRENT);
          } catch (fetchErr) {
            console.error("Error fetching Portainer data for new instance:", fetchErr);
            // Even if fetch fails, redirect to Summary page
            setActiveTab(TAB_NAMES.SUMMARY);
            setContentTab(CONTENT_TABS.CURRENT);
          }
        } finally {
          // Clear loading state
          setLoading(false);
        }
      }
    },
    [
      setPortainerInstancesFromAPI,
      setContainers,
      setStacks,
      setUnusedImagesCount,
      setDockerHubDataPulled,
      setLoading,
      setActiveTab,
      setContentTab,
      fetchContainers,
      fetchUnusedImages,
      successfullyUpdatedContainersRef,
    ]
  );

  return {
    handleNewInstanceDataFetch,
  };
};

