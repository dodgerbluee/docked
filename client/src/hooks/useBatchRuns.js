import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_RUN_LIMIT, REFRESH_INTERVAL_MS } from "../constants/batch";
// DEFAULT_POLLING_INTERVAL_MS is not currently used but kept for potential future use
import { getErrorMessage } from "../utils/errorMessages";
import { graphqlClient } from "../graphql/client";
import { BATCH_RUNS_QUERY } from "../graphql/queries";
import {
  getCachedLatestRunsByJobType,
  setCachedLatestRunsByJobType,
  fetchLatestRunsByJobType,
  mapGraphRunToRow,
} from "./batchRunsCache";
import { isBackendUp } from "../utils/backendStatus";
import { registerCacheClear } from "../utils/cacheRegistry";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of showing a loading spinner and re-firing 3 API calls.
let cachedLatestRun = null;
let cachedRecentRuns = null;

// Must not survive logout into the next session in the same tab.
export function clearBatchRunsHookCache() {
  cachedLatestRun = null;
  cachedRecentRuns = null;
}
registerCacheClear(clearBatchRunsHookCache);

/**
 * Custom hook for fetching batch runs
 * Separated from useBatchLogs for better modularity
 */
export function useBatchRuns(pollingInterval = REFRESH_INTERVAL_MS) {
  const [latestRun, setLatestRun] = useState(cachedLatestRun);
  const [latestRunsByJobType, setLatestRunsByJobType] = useState(
    () => getCachedLatestRunsByJobType() || {}
  );
  const [recentRuns, setRecentRuns] = useState(cachedRecentRuns || []);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(cachedLatestRun === null);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  // Fetch all batch run data in parallel
  const fetchBatchRuns = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad && cachedLatestRun === null) {
      setLoading(true);
    }
    setError("");

    try {
      // On initial load, check if byJobType data was already fetched by
      // useBatchPolling (which populates the shared cache). If so, use
      // the cached data directly instead of making another network request.
      const existingCache = isInitialLoad ? getCachedLatestRunsByJobType() : null;

      // Build the list of requests – for byJobType we use the shared
      // fetchLatestRunsByJobType() which deduplicates concurrent calls
      // (useBatchPolling may already have an in-flight request for the
      // same endpoint). If we already have cached data, skip the call entirely.
      const requests = [
        graphqlClient.query(BATCH_RUNS_QUERY, { first: DEFAULT_RUN_LIMIT }).toPromise(),
        existingCache ? Promise.resolve(existingCache) : fetchLatestRunsByJobType(),
      ];

      // Fetch all data in parallel for better performance
      const [runsResult, byJobTypeRuns] = await Promise.all(requests);

      if (!mountedRef.current) return;

      // urql reports query errors on the result instead of throwing, so a
      // failed runs query used to fall through as "no runs" with no message.
      if (runsResult.error) {
        setError(getErrorMessage("BATCH", "FETCH_RUNS"));
      }

      // Items come back newest-first; the first item is the latest run
      const items =
        !runsResult.error && runsResult.data?.batchRuns?.items
          ? runsResult.data.batchRuns.items.map(mapGraphRunToRow)
          : null;

      if (items) {
        // Process latest run
        const latest = items[0] || null;
        cachedLatestRun = latest;
        setLatestRun(latest);
        // Auto-select latest run only on initial load if none selected
        // Use functional update to avoid race conditions
        if (isInitialLoad && latest) {
          setSelectedRun((prev) => prev || latest);
        }

        // Process recent runs
        cachedRecentRuns = items;
        setRecentRuns(items);
      }

      // Process latest runs by job type
      // byJobTypeRuns comes from the shared fetchLatestRunsByJobType() which
      // returns the runs object directly (already unwrapped).
      if (byJobTypeRuns) {
        setCachedLatestRunsByJobType(byJobTypeRuns);
        setLatestRunsByJobType(byJobTypeRuns);
      }
    } catch (err) {
      console.error("Error fetching batch runs:", err);
      if (mountedRef.current) {
        const errorMessage = getErrorMessage("BATCH", "FETCH_RUNS");
        setError(errorMessage);
        // Only clear data if this is the initial load
        if (isInitialLoad) {
          setLatestRun(null);
          setLatestRunsByJobType({});
          setRecentRuns([]);
        }
      }
    } finally {
      if (mountedRef.current) {
        if (isInitialLoad) {
          setLoading(false);
        }
      }
    }
  }, []);

  // Initial fetch and refresh interval
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;

    // Initial load (guard prevents StrictMode double-fetch)
    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      fetchBatchRuns(true);
    }

    // Set up refresh interval (only refresh data, don't show loading state)
    // Skip when the backend is unreachable or the tab is hidden to avoid
    // hammering a dead server with ERR_CONNECTION_REFUSED errors.
    const interval = setInterval(() => {
      if (isBackendUp() && document.visibilityState === "visible") {
        fetchBatchRuns(false);
      }
    }, pollingInterval);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchBatchRuns, pollingInterval]);

  const refetch = useCallback(() => {
    fetchBatchRuns(false);
  }, [fetchBatchRuns]);

  return {
    latestRun,
    latestRunsByJobType,
    recentRuns,
    selectedRun,
    setSelectedRun,
    loading,
    error,
    refetch,
  };
}
