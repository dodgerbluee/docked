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

// How often to refresh runner data while the Runners view is open, so runners
// updated outside docked clear their "update available" badge automatically.
const RUNNER_REFRESH_INTERVAL_MS = 60 * 1000;

export function useRunnerState() {
  const [runners, setRunners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editRunner, setEditRunner] = useState(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [healthStatus, setHealthStatus] = useState({}); // id -> { online, checking, health }
  const [updatingRunners, setUpdatingRunners] = useState(new Set()); // runnerIds being updated
  const [updatedRunners, setUpdatedRunners] = useState(new Set()); // ids that finished updating
  const updatePollRef = useRef({}); // runnerId -> intervalId
  const [runOp, setRunOp] = useState(null); // { runner, appName, operationName }
  const [showOpsRunner, setShowOpsRunner] = useState(null); // runner to show ops modal for
  const [detailRunner, setDetailRunner] = useState(null); // runner for detail modal

  const fetchRunners = useCallback(async () => {
    try {
      const result = await graphqlClient.query(RUNNERS_QUERY).toPromise();
      if (!result.error && result.data?.runners) {
        const runners = result.data.runners.map(mapGraphRunner);
        setRunners(runners);
        return runners;
      }
      return [];
    } catch (err) {
      console.error("Failed to fetch runners:", err);
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
      if (!editRunner) return;
      setSaving(true);
      try {
        await graphqlClient
          .mutation(UPDATE_RUNNER_MUTATION, {
            id: editRunner.id,
            input: { name, url, enabled },
          })
          .toPromise();
        await fetchRunners();
        setEditRunner(null);
      } catch (err) {
        console.error("Failed to update runner:", err);
      } finally {
        setSaving(false);
      }
    },
    [editRunner, fetchRunners]
  );

  const handleUpdate = useCallback(
    async (runner) => {
      setUpdatingRunners((prev) => new Set([...prev, runner.id]));
      try {
        await updateRunnerBinary(runner.id);
        const targetVersion = runner.latest_version || "";
        let attempts = 0;
        updatePollRef.current[runner.id] = setInterval(async () => {
          attempts++;
          try {
            const data = await checkRunnerHealth(runner.id);
            const liveVersion = data.health?.version || "";
            if (versionsEqual(liveVersion, targetVersion)) {
              clearInterval(updatePollRef.current[runner.id]);
              delete updatePollRef.current[runner.id];
              setUpdatingRunners((prev) => {
                const next = new Set(prev);
                next.delete(runner.id);
                return next;
              });
              setUpdatedRunners((prev) => new Set([...prev, runner.id]));
              fetchRunners();
              return;
            }
          } catch {
            /* runner still restarting, keep polling */
          }
          if (attempts >= 24) {
            // 2 min max
            clearInterval(updatePollRef.current[runner.id]);
            delete updatePollRef.current[runner.id];
            setUpdatingRunners((prev) => {
              const next = new Set(prev);
              next.delete(runner.id);
              return next;
            });
            fetchRunners();
          }
        }, 5000);
      } catch (err) {
        console.error("Failed to update runner:", err);
        setUpdatingRunners((prev) => {
          const next = new Set(prev);
          next.delete(runner.id);
          return next;
        });
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
    return () => {
      Object.values(polls).forEach(clearInterval);
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
      // Auto-ping the new runner
      setTimeout(() => handlePing(newRunner), 1000);
    },
    [fetchRunners, handlePing]
  );

  return {
    // State
    runners,
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
