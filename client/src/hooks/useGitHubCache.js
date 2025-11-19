import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * useGitHubCache Hook
 * Manages GitHub cache clearing functionality
 */
export function useGitHubCache(fetchTrackedImages) {
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  const handleClearGitHubCache = useCallback(async () => {
    try {
      setClearingGitHubCache(true);
      console.log("🗑️ Clearing latest version data for tracked apps...");

      const response = await axios.delete(`${API_BASE_URL}/api/tracked-images/cache`);

      if (response.data && response.data.success) {
        console.log("✅ Latest version data cleared successfully");
        const message = response.data.message || "Latest version data cleared successfully";
        console.log(message);

        // Refresh tracked images to show updated data
        await fetchTrackedImages();
      } else {
        console.error("Failed to clear latest version data");
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to clear latest version data";
      console.error("Error clearing latest version data:", err);
      console.error(errorMessage);
    } finally {
      setClearingGitHubCache(false);
    }
  }, [fetchTrackedImages]);

  return {
    clearingGitHubCache,
    handleClearGitHubCache,
  };
}

