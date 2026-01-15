/**
 * Hook for fetching and managing upgrade history
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

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
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (options.limit) params.append("limit", options.limit);
      if (options.offset) params.append("offset", options.offset);
      if (options.containerName) params.append("containerName", options.containerName);
      if (options.status) params.append("status", options.status);

      const response = await axios.get(
        `${API_BASE_URL}/api/containers/upgrade-history?${params.toString()}`
      );
      if (response.data.success) {
        setHistory(response.data.history || []);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to fetch upgrade history");
      console.error("Error fetching upgrade history:", err);
    } finally {
      setLoading(false);
    }
  }, [options.limit, options.offset, options.containerName, options.status]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/containers/upgrade-history/stats`);
      if (response.data.success) {
        setStats(response.data.stats || {});
      }
    } catch (err) {
      console.error("Error fetching upgrade history stats:", err);
    } finally {
      setStatsLoading(false);
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

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    fetchStats();
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

