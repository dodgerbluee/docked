import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { DEFAULT_RUN_LIMIT, REFRESH_INTERVAL_MS } from "../constants/batch";
// DEFAULT_POLLING_INTERVAL_MS is not currently used but kept for potential future use
import { getErrorMessage } from "../utils/errorMessages";

/**
 * Custom hook for fetching batch runs
 * Separated from useBatchLogs for better modularity
 */
export function useBatchRuns(pollingInterval = REFRESH_INTERVAL_MS) {
  const [latestRun, setLatestRun] = useState(null);
  const [latestRunsByJobType, setLatestRunsByJobType] = useState({});
  const [recentRuns, setRecentRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch all batch run data in parallel
  const fetchBatchRuns = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) {
      setLoading(true);
    }
    setError("");

    try {
      // Fetch all data in parallel for better performance
      const [latestResponse, byJobTypeResponse, recentResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/batch/runs/latest`),
        axios.get(`${API_BASE_URL}/api/batch/runs/latest?byJobType=true`),
        axios.get(`${API_BASE_URL}/api/batch/runs?limit=${DEFAULT_RUN_LIMIT}`),
      ]);

      // Process latest run
      if (latestResponse.data.success) {
        const latest = latestResponse.data.run || null;
        setLatestRun(latest);
        // Auto-select latest run only on initial load if none selected
        // Use functional update to avoid race conditions
        if (isInitialLoad && latest) {
          setSelectedRun((prev) => prev || latest);
        }
      }

      // Process latest runs by job type
      if (byJobTypeResponse.data.success) {
        setLatestRunsByJobType(byJobTypeResponse.data.runs || {});
      }

      // Process recent runs
      if (recentResponse.data.success) {
        setRecentRuns(recentResponse.data.runs || []);
      }
    } catch (err) {
      console.error("Error fetching batch runs:", err);
      const errorMessage = getErrorMessage("BATCH", "FETCH_RUNS");
      setError(errorMessage);
      // Only clear data if this is the initial load
      if (isInitialLoad) {
        setLatestRun(null);
        setLatestRunsByJobType({});
        setRecentRuns([]);
      }
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch and refresh interval
  useEffect(() => {
    // Initial load
    fetchBatchRuns(true);

    // Set up refresh interval (only refresh data, don't show loading state)
    const interval = setInterval(() => {
      fetchBatchRuns(false);
    }, pollingInterval);

    return () => clearInterval(interval);
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
