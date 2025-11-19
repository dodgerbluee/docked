/**
 * Custom hook for fetching and managing batch runs
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";

/**
 * Hook to fetch and manage batch runs
 * @param {boolean} loading - Initial loading state
 * @returns {Object} Batch runs state and fetch functions
 */
export const useBatchRuns = (loading = true) => {
  const [latestRun, setLatestRun] = useState(null);
  const [latestRunsByJobType, setLatestRunsByJobType] = useState({});
  const [recentRuns, setRecentRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(loading);
  const [error, setError] = useState("");

  const fetchLatestRun = useCallback(async () => {
    try {
      // Fetch latest run overall (for backward compatibility)
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs/latest`);
      if (response.data.success) {
        setLatestRun(response.data.run || null);
      }

      // Fetch latest runs by job type
      const byJobTypeResponse = await axios.get(
        `${API_BASE_URL}/api/batch/runs/latest?byJobType=true`
      );
      if (byJobTypeResponse.data.success) {
        setLatestRunsByJobType(byJobTypeResponse.data.runs || {});
      }
    } catch (err) {
      console.error("Error fetching latest batch run:", err);
      setLatestRun(null);
      setLatestRunsByJobType({});
      if (isLoading) {
        setError("Failed to load batch run information");
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const fetchRecentRuns = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs?limit=20`);
      if (response.data.success) {
        setRecentRuns(response.data.runs || []);
      }
    } catch (err) {
      console.error("Error fetching recent batch runs:", err);
    }
  }, []);

  // Auto-refresh runs
  useEffect(() => {
    fetchLatestRun();
    fetchRecentRuns();
    // Refresh every 10 seconds to show updates
    const interval = setInterval(() => {
      fetchLatestRun();
      fetchRecentRuns();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchLatestRun, fetchRecentRuns]);

  return {
    latestRun,
    latestRunsByJobType,
    recentRuns,
    loading: isLoading,
    error,
    fetchLatestRun,
    fetchRecentRuns,
  };
};
