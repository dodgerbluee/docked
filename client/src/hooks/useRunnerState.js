/**
 * useRunnerState Hook
 * Extracted from RunnerTab — manages runner data, health status, and CRUD operations.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

export function useRunnerState() {
  const [runners, setRunners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editRunner, setEditRunner] = useState(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [healthStatus, setHealthStatus] = useState({}); // id -> { online, checking, health }
  const [updatingRunner, setUpdatingRunner] = useState(null); // runnerId
  const [updatedRunners, setUpdatedRunners] = useState(new Set()); // ids that finished updating
  const updatePollRef = useRef({}); // runnerId -> intervalId
  const [runOp, setRunOp] = useState(null); // { runner, appName, operationName }
  const [showOpsRunner, setShowOpsRunner] = useState(null); // runner to show ops modal for
  const [detailRunner, setDetailRunner] = useState(null); // runner for detail modal

  const fetchRunners = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners`);
      if (data.success) setRunners(data.runners);
      return data.runners || [];
    } catch (err) {
      console.error("Failed to fetch runners:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-ping all runners on mount
  const hasAutoPinged = useRef(false);
  useEffect(() => {
    if (hasAutoPinged.current) return;
    hasAutoPinged.current = true;
    fetchRunners().then((list) => {
      if (!list?.length) return;
      list.forEach((r) => {
        setHealthStatus((prev) => ({ ...prev, [r.id]: { checking: true } }));
        axios
          .post(`${API_BASE_URL}/api/runners/${r.id}/health`)
          .then(({ data }) => {
            setHealthStatus((prev) => ({
              ...prev,
              [r.id]: { online: data.online, checking: false, health: data.health },
            }));
          })
          .catch(() => {
            setHealthStatus((prev) => ({
              ...prev,
              [r.id]: { online: false, checking: false },
            }));
          });
      });
    });
  }, [fetchRunners]);

  const handleEdit = useCallback(
    async ({ name, url, enabled }) => {
      if (!editRunner) return;
      setSaving(true);
      try {
        await axios.put(`${API_BASE_URL}/api/runners/${editRunner.id}`, {
          name,
          url,
          enabled,
        });
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
      setUpdatingRunner(runner.id);
      try {
        await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/update`);
        const targetVersion = (runner.latest_version || "").replace(/^v/, "");
        let attempts = 0;
        updatePollRef.current[runner.id] = setInterval(async () => {
          attempts++;
          try {
            const { data } = await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/health`);
            const liveVersion = (data.health?.version || "").replace(/^v/, "");
            if (liveVersion === targetVersion) {
              clearInterval(updatePollRef.current[runner.id]);
              delete updatePollRef.current[runner.id];
              setUpdatingRunner(null);
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
            setUpdatingRunner(null);
            fetchRunners();
          }
        }, 5000);
      } catch (err) {
        console.error("Failed to update runner:", err);
        setUpdatingRunner(null);
      }
    },
    [fetchRunners]
  );

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
      const { data } = await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/health`);
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
    updatingRunner,
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
    handlePing,
    handleHealthUpdate,
    handleEnrolled,
  };
}
