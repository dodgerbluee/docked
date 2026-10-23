/**
 * useRunnerState Hook
 * Extracted from RunnerTab — manages runner data, health status, and CRUD operations.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { hasVersionUpdate, versionsEqual } from "../utils/versionHelpers";
import { checkRunnerHealth, updateRunnerBinary } from "../graphql/runnerOps";
import { graphqlClient } from "../graphql/client";
import { RUNNERS_QUERY, UPDATE_RUNNER_MUTATION } from "../graphql/queries";
import { mapGraphRunner } from "../utils/runnerShape";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

// How often to refresh runner data while the Runners view is open, so runners
// updated outside docked clear their "update available" badge automatically.
const RUNNER_REFRESH_INTERVAL_MS = 60 * 1000;

export function useRunnerState() {
  const [runners, setRunners] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed runner fetch used to resolve to an empty list, so the Runners view
  // rendered "no runners" and the user could not tell an outage from a genuinely
  // empty fleet.
  const [runnersError, setRunnersError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editRunner, setEditRunner] = useState(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [healthStatus, setHealthStatus] = useState({}); // id -> { online, checking, health }
  const [updatingRunners, setUpdatingRunners] = useState(new Set()); // runnerIds being updated
  const [updatedRunners, setUpdatedRunners] = useState(new Set()); // ids that finished updating
  const updatePollRef = useRef({}); // runnerId -> intervalId
  const enrollPingRef = useRef(null); // pending auto-ping timer for a new runner
  const mountedRef = useRef(true);
  const [runOp, setRunOp] = useState(null); // { runner, appName, operationName }
  const [showOpsRunner, setShowOpsRunner] = useState(null); // runner to show ops modal for
  const [detailRunner, setDetailRunner] = useState(null); // runner for detail modal

  const fetchRunners = useCallback(async () => {
    try {
      const result = await graphqlClient.query(RUNNERS_QUERY).toPromise();
      if (result.error) throw new Error(result.error.message);
      if (result.data?.runners) {
        const runners = result.data.runners.map(mapGraphRunner);
        setRunners(runners);
        setRunnersError("");
        return runners;
      }
      return [];
    } catch (err) {
      console.error("Failed to fetch runners:", err);
      setRunnersError(err.message || "Failed to load runners");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Ping a single runner's health. The server persists the reported version to
  // the DB, so a later fetchRunners() reflects any out-of-band update.
  const pingRunnerHealth = useCallback((id) => {
    setHealthStatus((prev) => ({ ...prev, [id]: { checking: true } }));
    return checkRunnerHealth(id)
      .then((data) => {
        setHealthStatus((prev) => ({
          ...prev,
          [id]: { online: data.online, checking: false, health: data.health },
        }));
      })
      .catch(() => {
        setHealthStatus((prev) => ({ ...prev, [id]: { online: false, checking: false } }));
      });
  }, []);

  // Auto-ping all runners on mount, then refetch so the version badge reflects
  // the versions the health pings just persisted. This clears a stale "update
  // available" badge on page load without a manual Update/Upgrade or reload.
  const hasAutoPinged = useRef(false);
  useEffect(() => {
    if (hasAutoPinged.current) return;
    hasAutoPinged.current = true;
    fetchRunners().then((list) => {
      if (!list?.length) return;
      Promise.allSettled(list.map((r) => pingRunnerHealth(r.id))).then(() => fetchRunners());
    });
  }, [fetchRunners, pingRunnerHealth]);

  // Keep runner data fresh while the view is open so runners updated outside
  // docked drop their "update available" badge automatically (no reload needed).
  useEffect(() => {
    const refresh = () => {
      fetchRunners().then((list) => {
        if (!list?.length) return;
        list.forEach((r) => pingRunnerHealth(r.id));
      });
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, RUNNER_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchRunners, pingRunnerHealth]);

  const handleEdit = useCallback(
    async ({ name, url, enabled }) => {
      if (!editRunner) return { success: false, error: "No runner selected" };
      setSaving(true);
      try {
        const result = await graphqlClient
          .mutation(UPDATE_RUNNER_MUTATION, {
            id: editRunner.id,
            input: { name, url, enabled },
          })
          .toPromise();
        // urql reports GraphQL/network failures as result.error instead of
        // rejecting, so the old code reached the success path (dialog closed,
        // no message) on a failed mutation.
        if (result.error) {
          const msg = result.error.message || "Failed to update runner";
          console.error("Failed to update runner:", result.error);
          return { success: false, error: msg };
        }
        await fetchRunners();
        setEditRunner(null);
        return { success: true };
      } catch (err) {
        console.error("Failed to update runner:", err);
        return { success: false, error: err.message || "Failed to update runner" };
      } finally {
        setSaving(false);
      }
    },
    [editRunner, fetchRunners]
  );

  const handleUpdate = useCallback(
    async (runner) => {
      // Captured before the mutation: this poll runs for up to 2 minutes, so it
      // must abandon itself if the session ends or the view closes mid-flight.
      const gen = getSessionGeneration();
      const clearUpdating = () =>
        setUpdatingRunners((prev) => {
          const next = new Set(prev);
          next.delete(runner.id);
          return next;
        });
      setUpdatingRunners((prev) => new Set([...prev, runner.id]));
      try {
        await updateRunnerBinary(runner.id);
        // Unmounted during that await: the unmount cleanup has already run, so
        // an interval created now would never be cleared.
        if (!mountedRef.current || isSessionStale(gen)) return;
        const targetVersion = runner.latest_version || "";
        let attempts = 0;
        updatePollRef.current[runner.id] = setInterval(async () => {
          if (!mountedRef.current || isSessionStale(gen)) {
            clearInterval(updatePollRef.current[runner.id]);
            delete updatePollRef.current[runner.id];
            return;
          }
          attempts++;
          try {
            const data = await checkRunnerHealth(runner.id);
            if (!mountedRef.current || isSessionStale(gen)) return;
            const liveVersion = data.health?.version || "";
            if (versionsEqual(liveVersion, targetVersion)) {
              clearInterval(updatePollRef.current[runner.id]);
              delete updatePollRef.current[runner.id];
              clearUpdating();
              setUpdatedRunners((prev) => new Set([...prev, runner.id]));
              fetchRunners();
              return;
            }
          } catch {
            /* runner still restarting, keep polling */
            if (!mountedRef.current || isSessionStale(gen)) return;
          }
          if (attempts >= 24) {
            // 2 min max
            clearInterval(updatePollRef.current[runner.id]);
            delete updatePollRef.current[runner.id];
            clearUpdating();
            fetchRunners();
          }
        }, 5000);
      } catch (err) {
        console.error("Failed to update runner:", err);
        if (mountedRef.current && !isSessionStale(gen)) clearUpdating();
      }
    },
    [fetchRunners]
  );

  /**
   * Update all online runners that have a pending version update.
   * Fires handleUpdate for each eligible runner concurrently.
   */
  const handleUpdateAll = useCallback(() => {
    const eligible = runners.filter(
      (r) =>
        r.version &&
        r.latest_version &&
        hasVersionUpdate(r.version, r.latest_version) &&
        !updatedRunners.has(r.id) &&
        !updatingRunners.has(r.id) &&
        healthStatus[r.id]?.online
    );
    eligible.forEach((r) => handleUpdate(r));
  }, [runners, healthStatus, updatedRunners, updatingRunners, handleUpdate]);

  // Clean up any active update polls on unmount
  useEffect(() => {
    const polls = updatePollRef.current;
    mountedRef.current = true;
    return () => {
      // Flip the liveness flag first: handleUpdate checks it after every await,
      // so a poll that is mid-request when the view closes must stop touching
      // state and stop starting new intervals that nothing will ever clear.
      mountedRef.current = false;
      Object.values(polls).forEach(clearInterval);
      if (enrollPingRef.current) clearTimeout(enrollPingRef.current);
    };
  }, []);

  const handlePing = useCallback(async (runner) => {
    setHealthStatus((prev) => ({ ...prev, [runner.id]: { checking: true } }));
    try {
      const data = await checkRunnerHealth(runner.id);
      setHealthStatus((prev) => ({
        ...prev,
        [runner.id]: { online: data.online, checking: false, health: data.health },
      }));
    } catch {
      setHealthStatus((prev) => ({
        ...prev,
        [runner.id]: { online: false, checking: false },
      }));
    }
  }, []);

  const handleHealthUpdate = useCallback((runnerId, status) => {
    setHealthStatus((prev) => ({ ...prev, [runnerId]: status }));
  }, []);

  const handleEnrolled = useCallback(
    (newRunner) => {
      setShowEnrollment(false);
      fetchRunners();
      // Auto-ping the new runner. The timer is tracked so the unmount cleanup
      // can cancel a ping that has not fired yet.
      if (enrollPingRef.current) clearTimeout(enrollPingRef.current);
      enrollPingRef.current = setTimeout(() => {
        enrollPingRef.current = null;
        if (mountedRef.current) handlePing(newRunner);
      }, 1000);
    },
    [fetchRunners, handlePing]
  );

  return {
    // State
    runners,
    runnersError,
    loading,
    saving,
    editRunner,
    showEnrollment,
    deleteConfirm,
    healthStatus,
    updatingRunners,
    updatedRunners,
    runOp,
    showOpsRunner,
    detailRunner,

    // Setters
    setEditRunner,
    setShowEnrollment,
    setDeleteConfirm,
    setRunOp,
    setShowOpsRunner,
    setDetailRunner,

    // Handlers
    fetchRunners,
    handleEdit,
    handleUpdate,
    handleUpdateAll,
    handlePing,
    handleHealthUpdate,
    handleEnrolled,
  };
}
