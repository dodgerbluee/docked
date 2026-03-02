/**
 * Hook for fetching and managing upgrade history
 */

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of firing API calls again.
let cachedHistory = null;
let cachedStats = null;

/**
 * Hook to fetch and manage upgrade history
 * @param {Object} options - Options
 * @param {number} [options.limit] - Maximum number of records
 * @param {number} [options.offset] - Offset for pagination
 * @param {string} [options.containerName] - Filter by container name
 * @param {string} [options.status] - Filter by status
 * @returns {Object} Upgrade history state and functions
 */
export const useUpgradeHistory = (options = {}) => {
  const [history, setHistory] = useState(cachedHistory || []);
  const [loading, setLoading] = useState(cachedHistory === null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(cachedStats);
  const [statsLoading, setStatsLoading] = useState(cachedStats === null);
  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    try {
      // Only show loading if we have no cached data
      if (cachedHistory === null) {
        setLoading(true);
      }
      setError(null);
      const params = new URLSearchParams();
      if (options.limit) params.append("limit", options.limit);
      if (options.offset) params.append("offset", options.offset);
      if (options.containerName) params.append("containerName", options.containerName);
      if (options.status) params.append("status", options.status);

      const response = await axios.get(
        `${API_BASE_URL}/api/containers/upgrade-history?${params.toString()}`
      );
      if (response.data.success && mountedRef.current) {
        const data = response.data.history || [];
        cachedHistory = data;
        setHistory(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.response?.data?.error || err.message || "Failed to fetch upgrade history");
        console.error("Error fetching upgrade history:", err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [options.limit, options.offset, options.containerName, options.status]);

  const fetchStats = useCallback(async () => {
    try {
      if (cachedStats === null) {
        setStatsLoading(true);
      }
      const response = await axios.get(`${API_BASE_URL}/api/containers/upgrade-history/stats`);
      if (response.data.success && mountedRef.current) {
        const data = response.data.stats || {};
        cachedStats = data;
        setStats(data);
      }
    } catch (err) {
      console.error("Error fetching upgrade history stats:", err);
    } finally {
      if (mountedRef.current) {
        setStatsLoading(false);
      }
    }
  }, []);

  const fetchUpgradeById = useCallback(async (id) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/containers/upgrade-history/${id}`);
      if (response.data.success) {
        return response.data.upgrade;
      }
      return null;
    } catch (err) {
      console.error("Error fetching upgrade by ID:", err);
      throw err;
    }
  }, []);

  // Guard prevents StrictMode double-fetch
  const historyFetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!historyFetchDoneRef.current) {
      historyFetchDoneRef.current = true;
      fetchHistory();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchHistory]);

  const statsFetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!statsFetchDoneRef.current) {
      statsFetchDoneRef.current = true;
      fetchStats();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchStats]);

  return {
    history,
    loading,
    error,
    stats,
    statsLoading,
    refetch: fetchHistory,
    fetchUpgradeById,
  };
};
