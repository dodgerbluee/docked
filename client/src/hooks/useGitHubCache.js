import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * useGitHubCache Hook
 * Manages GitHub cache clearing functionality
 */
export function useGitHubCache(fetchTrackedApps) {
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  const handleClearGitHubCache = useCallback(async () => {
    try {
      setClearingGitHubCache(true);

      const response = await axios.delete(`${API_BASE_URL}/api/tracked-apps/cache`);

      if (response.data && response.data.success) {
        // Refresh tracked images to show updated data
        await fetchTrackedApps();
      }
    } catch (err) {
      console.error("Error clearing latest version data:", err);
    } finally {
      setClearingGitHubCache(false);
    }
  }, [fetchTrackedApps]);

  return {
    clearingGitHubCache,
    handleClearGitHubCache,
  };
}
