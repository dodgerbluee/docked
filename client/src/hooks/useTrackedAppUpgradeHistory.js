/**
 * useTrackedAppUpgradeHistory Hook
 * Manages tracked app upgrade history data and operations
 */

import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of firing API calls again.
let cachedHistory = null;
let cachedStats = null;

export function useTrackedAppUpgradeHistory() {
  const [history, setHistory] = useState(cachedHistory || []);
  const [stats, setStats] = useState(cachedStats);
  const [loading, setLoading] = useState(cachedHistory === null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async (options = {}) => {
    try {
      if (cachedHistory === null) {
        setLoading(true);
      }
      setError(null);

      const params = new URLSearchParams();
      if (options.limit) params.append("limit", options.limit);
      if (options.offset) params.append("offset", options.offset);
      if (options.appName) params.append("appName", options.appName);
      if (options.provider) params.append("provider", options.provider);
      if (options.status) params.append("status", options.status);

      const response = await axios.get(
        `${API_BASE_URL}/api/tracked-apps/upgrade-history?${params.toString()}`
      );

      if (response.data.success && mountedRef.current) {
        const data = response.data.history || [];
        cachedHistory = data;
        setHistory(data);
      } else if (!response.data.success) {
        throw new Error(response.data.error || "Failed to fetch upgrade history");
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.response?.data?.error || err.message || "Failed to fetch upgrade history");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/tracked-apps/upgrade-history/stats`);

      if (response.data.success && mountedRef.current) {
        const data = response.data.stats || null;
        cachedStats = data;
        setStats(data);
      } else if (!response.data.success) {
        throw new Error(response.data.error || "Failed to fetch statistics");
      }
    } catch (err) {
      // Don't set error for stats failure, it's not critical
      console.error("Failed to fetch upgrade history stats:", err);
    }
  }, []);

  // Fetch history on mount (guard prevents StrictMode double-fetch)
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!fetchDoneRef.current) {
      fetchDoneRef.current = true;
      fetchHistory();
      fetchStats();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchHistory, fetchStats]);

  return {
    history,
    stats,
    loading,
    error,
    fetchHistory,
    fetchStats,
  };
}
