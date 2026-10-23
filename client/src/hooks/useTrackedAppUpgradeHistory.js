/**
 * useTrackedAppUpgradeHistory Hook
 * Manages tracked app upgrade history data and operations
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import {
  TRACKED_APP_UPGRADE_HISTORY_QUERY,
  TRACKED_APP_UPGRADE_HISTORY_STATS_QUERY,
} from "../graphql/queries";
import { registerCacheClear, getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

// Module-level cache – survives unmount/remount so the tab renders instantly
// on re-navigation instead of firing API calls again.
let cachedHistory = null;
let cachedStats = null;

// The resolver caps one request at 500 rows (graph/helpers.go maxPageLimit);
// the mount window is walked by offset in pages of this size.
const SERVER_MAX_PAGE = 500;
const DEFAULT_WINDOW = 500;

// Holds one user's upgrade history; must not survive logout into the next
// session in the same tab.
export function clearTrackedAppUpgradeHistoryCache() {
  cachedHistory = null;
  cachedStats = null;
}
registerCacheClear(clearTrackedAppUpgradeHistoryCache);

/** Maps a graph TrackedAppUpgradeRecord to the snake_case shape UI components expect. */
function mapRecord(r) {
  return {
    id: Number(r.id),
    tracked_app_id: r.trackedAppId ? Number(r.trackedAppId) : null,
    app_name: r.appName,
    provider: r.provider,
    repository: r.repository,
    old_version: r.oldVersion,
    new_version: r.newVersion,
    old_tag: r.oldTag,
    new_tag: r.newTag,
    old_commit_sha: r.oldCommitSha,
    new_commit_sha: r.newCommitSha,
    release_notes: r.releaseNotes,
    status: r.status?.toLowerCase(),
    error_message: r.errorMessage,
    upgrade_duration_ms: r.upgradeDurationMs,
    created_at: r.createdAt,
  };
}

export function useTrackedAppUpgradeHistory() {
  const [history, setHistory] = useState(cachedHistory || []);
  const [stats, setStats] = useState(cachedStats);
  const [loading, setLoading] = useState(cachedHistory === null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async (options = {}) => {
    const gen = getSessionGeneration();
    try {
      if (cachedHistory === null) {
        setLoading(true);
      }
      setError(null);

      const filter = {};
      if (options.appName) filter.appName = options.appName;
      if (options.provider) filter.provider = options.provider;
      if (options.status) filter.status = options.status.toUpperCase();

      // The resolver caps one request at 500 rows and returns a plain list, so
      // a wider window has to be walked by offset: reading a single page made
      // every consumer silently see only the newest slice.
      const totalCap = options.limit || 100;
      const pageSize = Math.min(totalCap, SERVER_MAX_PAGE);
      const rows = [];
      for (let offset = options.offset || 0; rows.length < totalCap; ) {
        const want = Math.min(pageSize, totalCap - rows.length);
        const { data, error: gqlError } = await graphqlClient
          .query(TRACKED_APP_UPGRADE_HISTORY_QUERY, {
            filter: Object.keys(filter).length ? filter : null,
            first: want,
            offset,
          })
          .toPromise();
        if (gqlError) throw new Error(gqlError.message);
        // Logout mid-flight: this response belongs to the dead session
        // (possibly another user's history); never repopulate state or cache.
        if (isSessionStale(gen)) return;

        const page = data?.trackedAppUpgradeHistory || [];
        rows.push(...page);
        if (page.length < want) break;
        offset += page.length;
      }

      if (mountedRef.current) {
        const mapped = rows.map(mapRecord);
        cachedHistory = mapped;
        setHistory(mapped);
      }
    } catch (err) {
      if (isSessionStale(gen)) return;
      if (mountedRef.current) {
        setError(err.message || "Failed to fetch upgrade history");
      }
    } finally {
      if (mountedRef.current && !isSessionStale(gen)) {
        setLoading(false);
      }
    }
  }, []);

  const [statsError, setStatsError] = useState("");

  const fetchStats = useCallback(async () => {
    const gen = getSessionGeneration();
    try {
      const { data, error: gqlError } = await graphqlClient
        .query(TRACKED_APP_UPGRADE_HISTORY_STATS_QUERY)
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      if (isSessionStale(gen)) return;

      if (mountedRef.current) {
        const s = data?.trackedAppUpgradeHistoryStats || null;
        const mapped = s
          ? {
              total_upgrades: s.totalUpgrades ?? 0,
              successful_upgrades: s.successfulUpgrades ?? 0,
              failed_upgrades: s.failedUpgrades ?? 0,
              avg_duration_ms: s.avgDurationMs ?? null,
              first_upgrade: s.firstUpgrade ?? null,
              last_upgrade: s.lastUpgrade ?? null,
              total_apps_upgraded: s.totalAppsUpgraded ?? 0,
            }
          : null;
        cachedStats = mapped;
        setStats(mapped);
      }
      setStatsError("");
    } catch (err) {
      // The stats bar is not critical, but a failed read is not the same as
      // "no upgrades have happened": say which one the user is looking at.
      console.error("Failed to fetch upgrade history stats:", err);
      if (mountedRef.current && !isSessionStale(gen)) {
        setStatsError(err.message || "Failed to load upgrade statistics");
      }
    }
  }, []);

  // Fetch history on mount (guard prevents StrictMode double-fetch)
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!fetchDoneRef.current) {
      fetchDoneRef.current = true;
      fetchHistory({ limit: DEFAULT_WINDOW });
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
    statsError,
    fetchHistory,
    fetchStats,
  };
}
