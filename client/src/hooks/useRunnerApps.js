/**
 * Hook for fetching dockhand runner apps across all enabled runners.
 * Returns a flat list of apps (each decorated with runner info), plus
 * aggregate stats suitable for Summary/Analytics pages.
 *
 * Apps are NOT containers — they are named managed services with
 * operations/shell commands defined in each runner's dockhand config.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { hasVersionUpdate } from "../utils/versionHelpers";

// Module-level cache – survives unmount/remount so pages render instantly
let cachedRunners = null;
let cachedAppsByRunner = null;
let cachedHistory = null;

export const useRunnerApps = () => {
  const [runners, setRunners] = useState(cachedRunners || []);
  const [appsByRunner, setAppsByRunner] = useState(cachedAppsByRunner || {});
  const [history, setHistory] = useState(cachedHistory || []);
  const [loading, setLoading] = useState(cachedRunners === null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async (silent = false) => {
    try {
      if (!silent && cachedRunners === null) setLoading(true);
      setError(null);

      // 1. Fetch runners
      const { data: runnersData } = await axios.get(`${API_BASE_URL}/api/runners`);
      const enabledRunners = (runnersData.runners || []).filter((r) => r.enabled !== 0);

      if (!mountedRef.current) return;
      setRunners(enabledRunners);
      cachedRunners = enabledRunners;

      // 2. Fetch apps for each runner in parallel
      const appsResults = await Promise.allSettled(
        enabledRunners.map(async (runner) => {
          const { data } = await axios.get(`${API_BASE_URL}/api/runners/${runner.id}/apps`);
          return { runnerId: runner.id, apps: data.apps || [] };
        })
      );

      if (!mountedRef.current) return;

      const newAppsByRunner = {};
      appsResults.forEach((result) => {
        if (result.status === "fulfilled") {
          newAppsByRunner[result.value.runnerId] = result.value.apps;
        }
      });
      setAppsByRunner(newAppsByRunner);
      cachedAppsByRunner = newAppsByRunner;

      // 3. Fetch combined history from all runners in parallel
      const historyResults = await Promise.allSettled(
        enabledRunners.map(async (runner) => {
          const { data } = await axios.get(
            `${API_BASE_URL}/api/runners/${runner.id}/apps/history?limit=50`
          );
          return (data.history || []).map((h) => ({
            ...h,
            runnerId: runner.id,
            runnerName: runner.name,
          }));
        })
      );

      if (!mountedRef.current) return;

      const allHistory = historyResults
        .filter((r) => r.status === "fulfilled")
        .flatMap((r) => r.value)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, 100);

      setHistory(allHistory);
      cachedHistory = allHistory;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.response?.data?.error || err.message || "Failed to fetch runner apps");
        console.error("useRunnerApps: fetch error", err);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Guard prevents StrictMode double-fetch
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (!fetchDoneRef.current) {
      fetchDoneRef.current = true;
      fetchAll(cachedRunners !== null);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  // Flat list of all apps across all runners, each annotated with runner info
  const allApps = useMemo(() => {
    return runners.flatMap((runner) =>
      (appsByRunner[runner.id] || []).map((app) => ({
        ...app,
        runnerId: runner.id,
        runnerName: runner.name,
        runnerUrl: runner.url,
      }))
    );
  }, [runners, appsByRunner]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = allApps.length;
    const withUpdates = allApps.filter(
      (a) => hasVersionUpdate(a.currentVersion, a.latestVersion) || a.systemUpdatesAvailable
    ).length;
    const upToDate = total - withUpdates;

    // Operation stats from history
    const totalOps = history.length;
    const successfulOps = history.filter((h) => h.exitCode === 0).length;
    const failedOps = history.filter((h) => h.exitCode !== null && h.exitCode !== 0).length;
    const successRate = totalOps > 0 ? Math.round((successfulOps / totalOps) * 100) : 0;

    // System updates
    const withSystemUpdates = allApps.filter((a) => a.systemUpdatesAvailable).length;
    const totalSystemUpdateCount = allApps.reduce((sum, a) => sum + (a.systemUpdateCount || 0), 0);

    // Apps by runner
    const appsByRunnerCount = runners.map((r) => ({
      name: r.name,
      count: (appsByRunner[r.id] || []).length,
    }));

    // Version sources
    const withVersionSource = allApps.filter((a) => a.versionSource).length;

    return {
      total,
      withUpdates,
      upToDate,
      totalOps,
      successfulOps,
      failedOps,
      successRate,
      withSystemUpdates,
      totalSystemUpdateCount,
      appsByRunnerCount,
      withVersionSource,
      runnersCount: runners.length,
    };
  }, [allApps, history, runners, appsByRunner]);

  return {
    runners,
    appsByRunner,
    allApps,
    history,
    stats,
    loading,
    error,
    refetch: fetchAll,
  };
};
