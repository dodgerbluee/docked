/**
 * Hook for fetching and managing upgrade history
 * Uses GraphQL for the list and stats.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import { UPGRADE_HISTORY_QUERY, UPGRADE_HISTORY_STATS_QUERY } from "../graphql/queries";
import { registerCacheClear, getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of firing API calls again.
// The cache holds the widest window any consumer has asked for, newest first;
// consumers with a smaller limit slice it rather than shrinking the cache, so
// the 10-row activity feed cannot starve the analytics charts of history.
let cachedHistory = null;
let cachedHistoryCap = 0;
let cachedStats = null;
// The server caps one connection page at 500 rows (graph/helpers.go).
const SERVER_MAX_PAGE = 500;

// Must not survive logout into the next session in the same tab.
export function clearUpgradeHistoryCache() {
  cachedHistory = null;
  cachedHistoryCap = 0;
  // The totals and their timestamp are per-user facts too. Leaving them behind
  // showed the previous user's numbers to the next one, and if that user's own
  // stats read failed they kept them indefinitely.
  cachedStats = null;
}
registerCacheClear(clearUpgradeHistoryCache);

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
    source_name: r.source?.name,
    source_url: r.source?.url,
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
  const requestedLimit = options.limit || 100;
  const [history, setHistory] = useState(() =>
    cachedHistory ? cachedHistory.slice(0, requestedLimit) : []
  );
  const [loading, setLoading] = useState(cachedHistory === null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(cachedStats);
  const [statsLoading, setStatsLoading] = useState(cachedStats === null);
  const [statsError, setStatsError] = useState(null);
  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    const gen = getSessionGeneration();
    try {
      // Only show loading if we have no cached data
      if (cachedHistory === null) {
        setLoading(true);
      }
      setError(null);

      const filter = {};
      if (options.containerName) filter.containerName = options.containerName;
      if (options.status) filter.status = options.status;

      // upgradeHistory is a cursor connection and the server caps a page at 500
      // rows. Reading only the first page made "the last N upgrades" silently
      // mean "the newest page", so analytics and the activity feed under-counted
      // (and skewed every chart) once history grew past the limit. Walk the
      // cursor until the cap is reached or the connection is exhausted.
      const totalCap = requestedLimit;
      const pageSize = Math.min(totalCap, SERVER_MAX_PAGE);
      const records = [];
      let after = null;
      for (let page = 0; records.length < totalCap; page += 1) {
        const result = await graphqlClient
          .query(UPGRADE_HISTORY_QUERY, {
            first: Math.min(pageSize, totalCap - records.length),
            after,
            filter: Object.keys(filter).length ? filter : null,
          })
          .toPromise();

        // urql reports errors on the result rather than throwing: without this
        // a failed query fell through and rendered an empty history.
        if (result.error) throw new Error(result.error.message);

        // Discard the response if the session changed while it was in flight
        if (isSessionStale(gen)) return;

        const connection = result.data?.upgradeHistory;
        if (!connection) break;
        records.push(...(connection.items || []));

        const endCursor = connection.pageInfo?.endCursor;
        if (!connection.pageInfo?.hasNextPage || !endCursor || endCursor === after) break;
        after = endCursor;
      }

      if (isSessionStale(gen)) return;
      if (mountedRef.current) {
        const data = records.map(mapUpgradeRecord);
        // Only widen the shared cache: a 10-row consumer must not evict the
        // wider window the analytics charts are reading.
        if (totalCap >= cachedHistoryCap) {
          cachedHistory = data;
          cachedHistoryCap = totalCap;
        }
        setHistory(data);
      }
    } catch (err) {
      if (mountedRef.current && !isSessionStale(gen)) {
        setError(err.message || "Failed to fetch upgrade history");
        console.error("Error fetching upgrade history:", err);
      }
    } finally {
      if (mountedRef.current && !isSessionStale(gen)) {
        setLoading(false);
      }
    }
  }, [requestedLimit, options.containerName, options.status]);

  const fetchStats = useCallback(async () => {
    const gen = getSessionGeneration();
    try {
      if (cachedStats === null) {
        setStatsLoading(true);
      }
      const { data, error } = await graphqlClient.query(UPGRADE_HISTORY_STATS_QUERY).toPromise();
      if (isSessionStale(gen)) return;
      if (error) throw error;
      if (mountedRef.current) {
        const s = data?.upgradeHistoryStats || {};
        const mapped = {
          total_upgrades: s.totalUpgrades ?? 0,
          successful_upgrades: s.successfulUpgrades ?? 0,
          failed_upgrades: s.failedUpgrades ?? 0,
          avg_duration_ms: s.avgDurationMs ?? null,
          first_upgrade: s.firstUpgrade ?? null,
          last_upgrade: s.lastUpgrade ?? null,
        };
        cachedStats = mapped;
        setStats(mapped);
        setStatsError(null);
      }
    } catch (err) {
      if (!isSessionStale(gen)) {
        console.error("Error fetching upgrade history stats:", err);
        // The stat cards render 0 for every field on failure, which reads as
        // "no upgrades have ever run" rather than "the count failed".
        setStatsError(err.message || "Failed to fetch upgrade history stats");
      }
    } finally {
      if (mountedRef.current && !isSessionStale(gen)) {
        setStatsLoading(false);
      }
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
    statsError,
    statsLoading,
    refetch: fetchHistory,
    refetchStats: fetchStats,
  };
};
