import { useState, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import { CLEAR_TRACKED_APP_CACHE_MUTATION } from "../graphql/queries";

/**
 * useGitHubCache Hook
 * Manages GitHub cache clearing functionality
 */
export function useGitHubCache(fetchTrackedApps) {
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  const handleClearGitHubCache = useCallback(async () => {
    try {
      setClearingGitHubCache(true);

      const result = await graphqlClient.mutation(CLEAR_TRACKED_APP_CACHE_MUTATION).toPromise();

      if (!result.error && result.data?.clearTrackedAppCache?.success) {
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
