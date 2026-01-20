/**
 * useTrackedAppUpgradeHistory Hook
 * Manages tracked app upgrade history data and operations
 */

import { useState, useCallback, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

export function useTrackedAppUpgradeHistory() {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async (options = {}) => {
    try {
      setLoading(true);
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

      if (response.data.success) {
        setHistory(response.data.history || []);
      } else {
        throw new Error(response.data.error || "Failed to fetch upgrade history");
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to fetch upgrade history");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/tracked-apps/upgrade-history/stats`);

      if (response.data.success) {
        setStats(response.data.stats || null);
      } else {
        throw new Error(response.data.error || "Failed to fetch statistics");
      }
    } catch (err) {
      // Don't set error for stats failure, it's not critical
      console.error("Failed to fetch upgrade history stats:", err);
    }
  }, []);

  // Fetch history on mount
  useEffect(() => {
    fetchHistory();
    fetchStats();
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

