import { useState, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import { CLEAR_TRACKED_APP_CACHE_MUTATION } from "../graphql/queries";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

/**
 * useGitHubCache Hook
 * Manages GitHub cache clearing functionality
 */
export function useGitHubCache(fetchTrackedApps) {
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  const handleClearGitHubCache = useCallback(async () => {
    // Session guard: a completion landing after login/logout must not
    // refresh the replacement session's tracked apps.
    const gen = getSessionGeneration();
    try {
      setClearingGitHubCache(true);

      const result = await graphqlClient.mutation(CLEAR_TRACKED_APP_CACHE_MUTATION).toPromise();
      if (isSessionStale(gen)) return;

      if (!result.error && result.data?.clearTrackedAppCache?.success) {
        // Refresh tracked images to show updated data
        await fetchTrackedApps();
      }
    } catch (err) {
      if (isSessionStale(gen)) return;
      console.error("Error clearing latest version data:", err);
    } finally {
      if (!isSessionStale(gen)) setClearingGitHubCache(false);
    }
  }, [fetchTrackedApps]);

  return {
    clearingGitHubCache,
    handleClearGitHubCache,
  };
}
