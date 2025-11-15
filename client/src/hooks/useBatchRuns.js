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

  // Fetch latest run
  const fetchLatestRun = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs/latest`);
      if (response.data.success) {
        setLatestRun(response.data.run || null);
        // Auto-select latest run if none selected
        setSelectedRun((prev) => (!prev && response.data.run ? response.data.run : prev));
      }

      const byJobTypeResponse = await axios.get(
        `${API_BASE_URL}/api/batch/runs/latest?byJobType=true`
      );
      if (byJobTypeResponse.data.success) {
        setLatestRunsByJobType(byJobTypeResponse.data.runs || {});
      }
      setError(""); // Clear error on success
    } catch (err) {
      console.error("Error fetching latest batch run:", err);
      setLatestRun(null);
      setLatestRunsByJobType({});
      const errorMessage = getErrorMessage("BATCH", "FETCH_RUNS");
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch recent runs
  const fetchRecentRuns = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs?limit=${DEFAULT_RUN_LIMIT}`);
      if (response.data.success) {
        setRecentRuns(response.data.runs || []);
      }
    } catch (err) {
      console.error("Error fetching recent batch runs:", err);
      const errorMessage = getErrorMessage("BATCH", "FETCH_RECENT");
      // Only set error if we don't have any data
      if (recentRuns.length === 0) {
        setError(errorMessage);
      }
    }
  }, [recentRuns.length]);

  // Initial fetch and refresh interval
  useEffect(() => {
    fetchLatestRun();
    fetchRecentRuns();
    const interval = setInterval(() => {
      fetchLatestRun();
      fetchRecentRuns();
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [fetchLatestRun, fetchRecentRuns, pollingInterval]);

  return {
    latestRun,
    latestRunsByJobType,
    recentRuns,
    selectedRun,
    setSelectedRun,
    loading,
    error,
    refetch: useCallback(() => {
      fetchLatestRun();
      fetchRecentRuns();
    }, [fetchLatestRun, fetchRecentRuns]),
  };
}
