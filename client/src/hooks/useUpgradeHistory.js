/**
 * Hook for fetching and managing upgrade history
 * Uses GraphQL for the main list, REST for stats and detail
 */

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { graphqlClient } from "../graphql/client";
import { UPGRADE_HISTORY_QUERY } from "../graphql/queries";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of firing API calls again.
let cachedHistory = null;
let cachedStats = null;

/** Maps GraphQL camelCase UpgradeRecord to the snake_case shape UI components expect. */
function mapUpgradeRecord(r) {
  return {
    id: r.id,
    docker_container_id: r.dockerContainerId,
    container_name: r.containerName,
    endpoint_id: r.endpointId,
    old_image: r.oldImage,
    new_image: r.newImage,
    old_digest: r.oldDigest,
    new_digest: r.newDigest,
    old_version: r.oldVersion,
    new_version: r.newVersion,
    image_repo: r.imageRepo,
    registry: r.registry,
    namespace: r.namespace,
    repository: r.repository,
    status: r.status?.toLowerCase(),
    error_message: r.errorMessage,
    upgrade_duration_ms: r.upgradeDurationMs,
    intent_id: r.intentId,
    performed_by: r.performedBy?.username ?? null,
    created_at: r.createdAt,
    // Fields from source relation (if available)
    portainer_instance_name: r.source?.name,
    portainer_url: r.source?.url,
    runner_name: r.source?.name,
    provider: r.registry?.toLowerCase(),
  };
}

/**
 * Hook to fetch and manage upgrade history
 * @param {Object} options - Options
 * @param {number} [options.limit] - Maximum number of records
 * @param {number} [options.offset] - Offset for pagination (unused, GraphQL uses cursors)
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

      const filter = {};
      if (options.containerName) filter.containerName = options.containerName;
      if (options.status) filter.status = options.status;

      const result = await graphqlClient
        .query(UPGRADE_HISTORY_QUERY, {
          first: options.limit || 100,
          filter: Object.keys(filter).length ? filter : null,
        })
        .toPromise();

      if (result.data?.upgradeHistory && mountedRef.current) {
        const data = (result.data.upgradeHistory.items || []).map(mapUpgradeRecord);
        cachedHistory = data;
        setHistory(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || "Failed to fetch upgrade history");
        console.error("Error fetching upgrade history:", err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [options.limit, options.containerName, options.status]);

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
