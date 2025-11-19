/**
 * Hook for container data clearing operations
 */

import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";

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
        console.log("🗑️ Clearing all container data...");

        const response = await axios.delete(`${API_BASE_URL}/api/containers/data`);

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

        if (response.data && response.data.success) {
          clearFrontendState();
          console.log("✅ Cache cleared successfully");
          console.log("🔄 Fetching fresh data from Portainer...");
          try {
            await fetchContainers(true, null, true);
            console.log("✅ Portainer data fetched successfully");
          } catch (fetchError) {
            console.error("❌ Error fetching Portainer data:", fetchError);
            setError(
              fetchError.response?.data?.error ||
                "Failed to fetch Portainer data after clearing cache"
            );
          } finally {
            setClearingState(false);
          }
        } else {
          clearFrontendState();
          console.log("✅ Cache cleared (assuming success)");
          console.log("🔄 Fetching fresh data from Portainer...");
          try {
            await fetchContainers(true, null, true);
            console.log("✅ Portainer data fetched successfully");
          } catch (fetchError) {
            console.error("❌ Error fetching Portainer data:", fetchError);
            setError(
              fetchError.response?.data?.error ||
                "Failed to fetch Portainer data after clearing cache"
            );
          } finally {
            setClearingState(false);
          }
        }
      } catch (err) {
        if (err.response && err.response.status === 404) {
          console.warn("⚠️ Clear cache endpoint not found (404), clearing frontend state anyway");
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
          console.log("✅ Frontend state cleared. Backend cache may need manual clearing.");
        } else {
          console.error("Error clearing cache:", err);
          setError(err.response?.data?.error || err.message || "Failed to clear cache");
        }
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
