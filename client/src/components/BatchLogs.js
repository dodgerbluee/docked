/**
 * Batch Logs Component
 * Displays batch processing logs and run history
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useContext,
} from "react";
import axios from "axios";
import "./Settings.css";
import { BatchConfigContext } from "../contexts/BatchConfigContext";
import { API_BASE_URL } from "../constants/api";

function BatchLogs({
  onNavigateHome = null,
  onTriggerBatch = null,
  onTriggerTrackedAppsBatch = null,
}) {
  // Get batchConfigs from Context - this will automatically update when state changes
  const contextValue = useContext(BatchConfigContext);
  const batchConfigs = contextValue?.batchConfig || {};

  // Check if any job type is enabled
  const hasEnabledJobs =
    batchConfigs["docker-hub-pull"]?.enabled ||
    false ||
    batchConfigs["tracked-apps-check"]?.enabled ||
    false;

  const [latestRun, setLatestRun] = useState(null);
  const [latestRunsByJobType, setLatestRunsByJobType] = useState({});
  const [recentRuns, setRecentRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggeringBatch, setTriggeringBatch] = useState(false);
  const [triggeringTrackedAppsBatch, setTriggeringTrackedAppsBatch] =
    useState(false);
  const [nextScheduledRunDockerHub, setNextScheduledRunDockerHub] =
    useState(null);
  const [nextScheduledRunTrackedApps, setNextScheduledRunTrackedApps] =
    useState(null);
  const lastCalculatedRunIdRefDockerHub = useRef(null);
  const lastCalculatedIntervalRefDockerHub = useRef(null);
  const baseScheduledTimeRefDockerHub = useRef(null);
  const lastCalculatedRunIdRefTrackedApps = useRef(null);
  const lastCalculatedIntervalRefTrackedApps = useRef(null);
  const baseScheduledTimeRefTrackedApps = useRef(null);

  // Log whenever batchConfigs changes from Context
  useEffect(() => {
    console.log("📥 BatchLogs received batchConfigs from Context:", {
      batchConfigs,
      dockerHubEnabled: batchConfigs["docker-hub-pull"]?.enabled,
      trackedAppsEnabled: batchConfigs["tracked-apps-check"]?.enabled,
    });
    // Reset dependency tracking when configs change
    baseScheduledTimeRefDockerHub.current = null;
    lastCalculatedRunIdRefDockerHub.current = null;
    lastCalculatedIntervalRefDockerHub.current = null;
    baseScheduledTimeRefTrackedApps.current = null;
    lastCalculatedRunIdRefTrackedApps.current = null;
    lastCalculatedIntervalRefTrackedApps.current = null;
  }, [batchConfigs]);

  useEffect(() => {
    fetchLatestRun();
    fetchRecentRuns();
    // Refresh every 10 seconds to show updates
    const interval = setInterval(() => {
      fetchLatestRun();
      fetchRecentRuns();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Calculate next scheduled run for Docker Hub Scan
  useEffect(() => {
    const dockerHubConfig = batchConfigs["docker-hub-pull"];
    if (
      !dockerHubConfig ||
      !dockerHubConfig.enabled ||
      !dockerHubConfig.intervalMinutes
    ) {
      setNextScheduledRunDockerHub(null);
      baseScheduledTimeRefDockerHub.current = null;
      return;
    }

    const intervalMs = dockerHubConfig.intervalMinutes * 60 * 1000;

    // Find the most recent completed run for docker-hub-pull
    const lastCompletedRun = recentRuns.find(
      (run) => run.status === "completed" && run.job_type === "docker-hub-pull"
    );
    let calculatedNextRun = null;
    let lastRunId = null;

    if (lastCompletedRun && lastCompletedRun.completed_at) {
      lastRunId = lastCompletedRun.id;
      const completedAtStr = lastCompletedRun.completed_at;
      let completedAt;
      if (
        typeof completedAtStr === "string" &&
        /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(completedAtStr)
      ) {
        completedAt = new Date(completedAtStr.replace(" ", "T") + "Z");
      } else {
        completedAt = new Date(completedAtStr);
      }
      calculatedNextRun = new Date(completedAt.getTime() + intervalMs);
    } else {
      // Check for running job
      const runningRun = recentRuns.find(
        (run) => run.status === "running" && run.job_type === "docker-hub-pull"
      );
      if (runningRun && runningRun.started_at) {
        lastRunId = runningRun.id;
        const startedAtStr = runningRun.started_at;
        let startedAt;
        if (
          typeof startedAtStr === "string" &&
          /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
        ) {
          startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
        } else {
          startedAt = new Date(startedAtStr);
        }
        calculatedNextRun = new Date(startedAt.getTime() + intervalMs);
      } else {
        // No runs - check if we already calculated a time for this scenario
        const currentKey = `none-${dockerHubConfig.intervalMinutes}`;
        const lastKey = `${lastCalculatedRunIdRefDockerHub.current || "none"}-${
          lastCalculatedIntervalRefDockerHub.current || 0
        }`;
        if (
          currentKey === lastKey &&
          baseScheduledTimeRefDockerHub.current !== null
        ) {
          // Use the cached time - don't recalculate from current time
          setNextScheduledRunDockerHub(
            new Date(baseScheduledTimeRefDockerHub.current)
          );
          return;
        }
        // First time calculating - use current time and store it
        const now = new Date();
        calculatedNextRun = new Date(now.getTime() + intervalMs);
      }
    }

    // Check if we need to recalculate (only if run ID or interval changed)
    const currentKey = `${lastRunId || "none"}-${
      dockerHubConfig.intervalMinutes
    }`;
    const lastKey = `${lastCalculatedRunIdRefDockerHub.current || "none"}-${
      lastCalculatedIntervalRefDockerHub.current || 0
    }`;

    if (
      currentKey === lastKey &&
      baseScheduledTimeRefDockerHub.current !== null
    ) {
      // Same run and interval - use cached time, don't recalculate
      setNextScheduledRunDockerHub(
        new Date(baseScheduledTimeRefDockerHub.current)
      );
      return;
    }

    // Only update if the run ID or interval actually changed
    lastCalculatedRunIdRefDockerHub.current = lastRunId;
    lastCalculatedIntervalRefDockerHub.current =
      dockerHubConfig.intervalMinutes;

    // Store the calculated time (as timestamp) so it doesn't change
    if (calculatedNextRun) {
      baseScheduledTimeRefDockerHub.current = calculatedNextRun.getTime();
      setNextScheduledRunDockerHub(calculatedNextRun);
    }
  }, [batchConfigs, recentRuns]);

  // Calculate next scheduled run for Tracked Apps Scan
  useEffect(() => {
    const trackedAppsConfig = batchConfigs["tracked-apps-check"];
    if (
      !trackedAppsConfig ||
      !trackedAppsConfig.enabled ||
      !trackedAppsConfig.intervalMinutes
    ) {
      setNextScheduledRunTrackedApps(null);
      baseScheduledTimeRefTrackedApps.current = null;
      return;
    }

    const intervalMs = trackedAppsConfig.intervalMinutes * 60 * 1000;

    // Find the most recent completed run for tracked-apps-check
    const lastCompletedRun = recentRuns.find(
      (run) =>
        run.status === "completed" && run.job_type === "tracked-apps-check"
    );
    let calculatedNextRun = null;
    let lastRunId = null;

    if (lastCompletedRun && lastCompletedRun.completed_at) {
      lastRunId = lastCompletedRun.id;
      const completedAtStr = lastCompletedRun.completed_at;
      let completedAt;
      if (
        typeof completedAtStr === "string" &&
        /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(completedAtStr)
      ) {
        completedAt = new Date(completedAtStr.replace(" ", "T") + "Z");
      } else {
        completedAt = new Date(completedAtStr);
      }
      calculatedNextRun = new Date(completedAt.getTime() + intervalMs);
    } else {
      // Check for running job
      const runningRun = recentRuns.find(
        (run) =>
          run.status === "running" && run.job_type === "tracked-apps-check"
      );
      if (runningRun && runningRun.started_at) {
        lastRunId = runningRun.id;
        const startedAtStr = runningRun.started_at;
        let startedAt;
        if (
          typeof startedAtStr === "string" &&
          /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
        ) {
          startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
        } else {
          startedAt = new Date(startedAtStr);
        }
        calculatedNextRun = new Date(startedAt.getTime() + intervalMs);
      } else {
        // No runs - check if we already calculated a time for this scenario
        const currentKey = `none-${trackedAppsConfig.intervalMinutes}`;
        const lastKey = `${
          lastCalculatedRunIdRefTrackedApps.current || "none"
        }-${lastCalculatedIntervalRefTrackedApps.current || 0}`;
        if (
          currentKey === lastKey &&
          baseScheduledTimeRefTrackedApps.current !== null
        ) {
          // Use the cached time - don't recalculate from current time
          setNextScheduledRunTrackedApps(
            new Date(baseScheduledTimeRefTrackedApps.current)
          );
          return;
        }
        // First time calculating - use current time and store it
        const now = new Date();
        calculatedNextRun = new Date(now.getTime() + intervalMs);
      }
    }

    // Check if we need to recalculate (only if run ID or interval changed)
    const currentKey = `${lastRunId || "none"}-${
      trackedAppsConfig.intervalMinutes
    }`;
    const lastKey = `${lastCalculatedRunIdRefTrackedApps.current || "none"}-${
      lastCalculatedIntervalRefTrackedApps.current || 0
    }`;

    if (
      currentKey === lastKey &&
      baseScheduledTimeRefTrackedApps.current !== null
    ) {
      // Same run and interval - use cached time, don't recalculate
      setNextScheduledRunTrackedApps(
        new Date(baseScheduledTimeRefTrackedApps.current)
      );
      return;
    }

    // Only update if the run ID or interval actually changed
    lastCalculatedRunIdRefTrackedApps.current = lastRunId;
    lastCalculatedIntervalRefTrackedApps.current =
      trackedAppsConfig.intervalMinutes;

    // Store the calculated time (as timestamp) so it doesn't change
    if (calculatedNextRun) {
      baseScheduledTimeRefTrackedApps.current = calculatedNextRun.getTime();
      setNextScheduledRunTrackedApps(calculatedNextRun);
    }
  }, [batchConfigs, recentRuns]);

  const fetchLatestRun = async () => {
    try {
      // Fetch latest run overall (for backward compatibility)
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs/latest`);
      if (response.data.success) {
        setLatestRun(response.data.run || null);
        // Auto-select latest run if none selected
        if (!selectedRun && response.data.run) {
          setSelectedRun(response.data.run);
        }
      }

      // Fetch latest runs by job type
      const byJobTypeResponse = await axios.get(
        `${API_BASE_URL}/api/batch/runs/latest?byJobType=true`
      );
      if (byJobTypeResponse.data.success) {
        setLatestRunsByJobType(byJobTypeResponse.data.runs || {});
      }
    } catch (err) {
      console.error("Error fetching latest batch run:", err);
      setLatestRun(null);
      setLatestRunsByJobType({});
      if (loading) {
        setError("Failed to load batch run information");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentRuns = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/batch/runs?limit=20`
      );
      if (response.data.success) {
        setRecentRuns(response.data.runs || []);
      }
    } catch (err) {
      console.error("Error fetching recent batch runs:", err);
    }
  };

  const formatDuration = (ms) => {
    if (!ms && ms !== 0) return "N/A";
    // Handle negative durations (shouldn't happen with fix, but handle gracefully)
    const absMs = Math.abs(ms);
    const seconds = Math.floor(absMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    let result = "";
    if (hours > 0) {
      result = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      result = `${minutes}m ${seconds % 60}s`;
    } else {
      result = `${seconds}s`;
    }

    // Add negative sign if duration is negative (indicates calculation error)
    return ms < 0 ? `-${result}` : result;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    // SQLite DATETIME returns strings in format "YYYY-MM-DD HH:MM:SS" (no timezone
    // Since the database uses CURRENT_TIMESTAMP which is UTC, we need to parse it as UTC
    let date;
    if (typeof dateString === "string") {
      // Check if it's a SQLite datetime format (YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS)
      if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(dateString)) {
        // SQLite datetime without timezone - assume UTC and add 'Z'
        date = new Date(dateString.replace(" ", "T") + "Z");
      } else if (
        dateString.includes("T") &&
        !dateString.includes("Z") &&
        !dateString.match(/[+-]\d{2}:\d{2}$/)
      ) {
        // ISO string without timezone - assume UTC
        date = new Date(dateString + "Z");
      } else {
        // Already has timezone info or is in a different format
        date = new Date(dateString);
      }
    } else {
      date = new Date(dateString);
    }

    // Format in America/Chicago timezone
    return date.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: true,
    });
  };

  const getJobTypeBadge = (jobType) => {
    const jobTypes = {
      "docker-hub-pull": {
        bg: "rgba(0, 90, 156, 0.2)",
        color: "var(--dodger-blue)",
        text: "Docker Hub Scan",
      },
      "tracked-apps-check": {
        bg: "rgba(139, 92, 246, 0.2)",
        color: "#8b5cf6",
        text: "Tracked Apps Scan",
      },
      // Future job types can be added here
      // 'image-cleanup': { bg: "rgba(139, 92, 246, 0.2)", color: "#8b5cf6", text: "Image Cleanup" },
      // 'backup': { bg: "rgba(34, 197, 94, 0.2)", color: "#22c55e", text: "Backup" },
    };
    const jobInfo = jobTypes[jobType] || {
      bg: "rgba(156, 163, 175, 0.2)",
      color: "#9ca3af",
      text: jobType || "Unknown Job",
    };
    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: "12px",
          fontSize: "0.85rem",
          fontWeight: "600",
          background: jobInfo.bg,
          color: jobInfo.color,
        }}
      >
        {jobInfo.text}
      </span>
    );
  };

  const getStatusBadge = (status) => {
    const statusColors = {
      running: {
        bg: "rgba(0, 90, 156, 0.2)",
        color: "var(--dodger-blue)",
        text: "Running",
      },
      completed: {
        bg: "rgba(34, 197, 94, 0.2)",
        color: "#22c55e",
        text: "Completed",
      },
      failed: {
        bg: "rgba(239, 62, 66, 0.2)",
        color: "var(--dodger-red)",
        text: "Failed",
      },
    };

    const style = statusColors[status] || statusColors.running;

    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: "12px",
          fontSize: "0.85rem",
          fontWeight: "600",
          background: style.bg,
          color: style.color,
        }}
      >
        {style.text}
      </span>
    );
  };

  const getManualBadge = () => {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: "12px",
          fontSize: "0.85rem",
          fontWeight: "600",
          background: "rgba(239, 62, 66, 0.2)",
          color: "var(--dodger-red)",
        }}
      >
        Manual
      </span>
    );
  };

  const formatNextRun = (nextRunDate) => {
    if (!nextRunDate) return "N/A";
    return nextRunDate.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: true,
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-container">
        {error && (
          <div className="error-message" style={{ marginBottom: "20px" }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <p style={{ color: "var(--text-secondary)" }}>
              Loading batch logs...
            </p>
          </div>
        )}

        {/* Next Scheduled Run */}
        <div
          style={{
            background: "var(--bg-secondary)",
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "30px",
            border: "1px solid var(--border-color)",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              color: "var(--text-primary)",
              marginBottom: "20px",
            }}
          >
            Batch Jobs
          </h3>
          {hasEnabledJobs ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {/* Docker Hub Scan */}
              {batchConfigs["docker-hub-pull"]?.enabled && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "200px 1fr",
                    gap: "15px",
                    alignItems: "center",
                    padding: "12px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "6px",
                  }}
                >
                  <div
                    style={{ fontWeight: "600", color: "var(--text-primary)" }}
                  >
                    {getJobTypeBadge("docker-hub-pull")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: "500",
                        }}
                      >
                        {formatNextRun(nextScheduledRunDockerHub)}
                      </span>
                      <span
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        (Interval:{" "}
                        {batchConfigs["docker-hub-pull"]?.intervalMinutes
                          ? batchConfigs["docker-hub-pull"].intervalMinutes ===
                            60
                            ? "1 hour"
                            : batchConfigs["docker-hub-pull"].intervalMinutes <
                              60
                            ? `${batchConfigs["docker-hub-pull"].intervalMinutes} minutes`
                            : (() => {
                                const hours =
                                  batchConfigs["docker-hub-pull"]
                                    .intervalMinutes / 60;
                                return hours % 1 === 0
                                  ? `${hours} hours`
                                  : `${hours.toFixed(1)} hours`;
                              })()
                          : "N/A"}
                        )
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (onTriggerBatch) {
                          setTriggeringBatch(true);
                          try {
                            await onTriggerBatch();
                            // Refresh the runs after triggering
                            setTimeout(() => {
                              fetchLatestRun();
                              fetchRecentRuns();
                            }, 1000);
                          } catch (err) {
                            console.error("Error triggering batch:", err);
                          } finally {
                            setTriggeringBatch(false);
                          }
                        }
                      }}
                      disabled={triggeringBatch}
                      className="update-button"
                      style={{
                        padding: "8px 16px",
                        fontSize: "0.9rem",
                        fontWeight: "600",
                        background: "rgba(30, 144, 255, 0.2)",
                        color: "var(--dodger-blue)",
                        border: "1px solid var(--dodger-blue)",
                        borderRadius: "8px",
                        cursor: triggeringBatch ? "not-allowed" : "pointer",
                        transition: "all 0.3s",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        marginTop: 0,
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      {triggeringBatch ? "Running..." : "Run Now"}
                    </button>
                  </div>
                </div>
              )}
              {/* Tracked Apps Scan */}
              {batchConfigs["tracked-apps-check"]?.enabled && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "200px 1fr",
                    gap: "15px",
                    alignItems: "center",
                    padding: "12px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "6px",
                  }}
                >
                  <div
                    style={{ fontWeight: "600", color: "var(--text-primary)" }}
                  >
                    {getJobTypeBadge("tracked-apps-check")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: "500",
                        }}
                      >
                        {formatNextRun(nextScheduledRunTrackedApps)}
                      </span>
                      <span
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        (Interval:{" "}
                        {batchConfigs["tracked-apps-check"]?.intervalMinutes
                          ? batchConfigs["tracked-apps-check"]
                              .intervalMinutes === 60
                            ? "1 hour"
                            : batchConfigs["tracked-apps-check"]
                                .intervalMinutes < 60
                            ? `${batchConfigs["tracked-apps-check"].intervalMinutes} minutes`
                            : (() => {
                                const hours =
                                  batchConfigs["tracked-apps-check"]
                                    .intervalMinutes / 60;
                                return hours % 1 === 0
                                  ? `${hours} hours`
                                  : `${hours.toFixed(1)} hours`;
                              })()
                          : "N/A"}
                        )
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (onTriggerTrackedAppsBatch) {
                          setTriggeringTrackedAppsBatch(true);
                          try {
                            await onTriggerTrackedAppsBatch();
                            // Refresh the runs after triggering
                            setTimeout(() => {
                              fetchLatestRun();
                              fetchRecentRuns();
                            }, 1000);
                          } catch (err) {
                            console.error(
                              "Error triggering tracked apps batch:",
                              err
                            );
                          } finally {
                            setTriggeringTrackedAppsBatch(false);
                          }
                        }
                      }}
                      disabled={triggeringTrackedAppsBatch}
                      className="update-button purple-button"
                      style={{
                        padding: "8px 16px",
                        fontSize: "0.9rem",
                        fontWeight: "600",
                        background: "rgba(139, 92, 246, 0.2)",
                        color: "#8b5cf6",
                        border: "1px solid #8b5cf6",
                        borderRadius: "8px",
                        cursor: triggeringTrackedAppsBatch
                          ? "not-allowed"
                          : "pointer",
                        transition: "all 0.3s",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        marginTop: 0,
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      {triggeringTrackedAppsBatch ? "Running..." : "Run Now"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-secondary)",
              }}
            >
              No batch jobs are currently scheduled. Enable batch processing in
              Settings to schedule automatic runs.
            </div>
          )}
        </div>

        {/* Latest Run Summary - Show last run for each job type */}
        {(latestRunsByJobType["docker-hub-pull"] ||
          latestRunsByJobType["tracked-apps-check"]) && (
          <div
            style={{
              background: "var(--bg-secondary)",
              padding: "20px",
              paddingBottom: "30px",
              borderRadius: "8px",
              marginBottom: "30px",
              border: "1px solid var(--border-color)",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                color: "var(--text-primary)",
                marginBottom: "20px",
              }}
            >
              Last Run
            </h3>
            <div
              style={{
                display: "table",
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: "0",
              }}
            >
              {/* Table Header */}
              <div
                style={{
                  display: "table-row",
                  background: "var(--bg-tertiary)",
                }}
              >
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Job Type
                </div>
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Status
                </div>
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Start Time
                </div>
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Completed Time
                </div>
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Duration
                </div>
                <div
                  style={{
                    display: "table-cell",
                    padding: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Details
                </div>
              </div>
              {/* Table Rows - One for each job type */}
              {latestRunsByJobType["docker-hub-pull"] && (
                <div style={{ display: "table-row" }}>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {getJobTypeBadge("docker-hub-pull")}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {getStatusBadge(
                      latestRunsByJobType["docker-hub-pull"].status
                    )}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {formatDate(
                      latestRunsByJobType["docker-hub-pull"].started_at
                    )}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {latestRunsByJobType["docker-hub-pull"].completed_at
                      ? formatDate(
                          latestRunsByJobType["docker-hub-pull"].completed_at
                        )
                      : "N/A"}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {latestRunsByJobType["docker-hub-pull"].duration_ms
                      ? formatDuration(
                          latestRunsByJobType["docker-hub-pull"].duration_ms
                        )
                      : "N/A"}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <div style={{ marginBottom: "4px" }}>
                      {latestRunsByJobType["docker-hub-pull"]
                        .containers_checked || 0}{" "}
                      containers checked
                    </div>
                    <div>
                      {latestRunsByJobType["docker-hub-pull"]
                        .containers_updated || 0}{" "}
                      updates found
                    </div>
                  </div>
                </div>
              )}
              {latestRunsByJobType["tracked-apps-check"] && (
                <div style={{ display: "table-row" }}>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {getJobTypeBadge("tracked-apps-check")}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {getStatusBadge(
                      latestRunsByJobType["tracked-apps-check"].status
                    )}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {formatDate(
                      latestRunsByJobType["tracked-apps-check"].started_at
                    )}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {latestRunsByJobType["tracked-apps-check"].completed_at
                      ? formatDate(
                          latestRunsByJobType["tracked-apps-check"].completed_at
                        )
                      : "N/A"}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {latestRunsByJobType["tracked-apps-check"].duration_ms
                      ? formatDuration(
                          latestRunsByJobType["tracked-apps-check"].duration_ms
                        )
                      : "N/A"}
                  </div>
                  <div
                    style={{
                      display: "table-cell",
                      padding: "12px",
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <div style={{ marginBottom: "4px" }}>
                      {latestRunsByJobType["tracked-apps-check"]
                        .containers_checked || 0}{" "}
                      apps checked
                    </div>
                    <div>
                      {latestRunsByJobType["tracked-apps-check"]
                        .containers_updated || 0}{" "}
                      updates found
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Error messages for each job type */}
            {latestRunsByJobType["docker-hub-pull"]?.error_message && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "12px",
                  background: "rgba(239, 62, 66, 0.1)",
                  border: "1px solid var(--dodger-red)",
                  borderRadius: "6px",
                  color: "var(--dodger-red)",
                }}
              >
                <strong>Docker Hub Scan Error:</strong>{" "}
                {latestRunsByJobType["docker-hub-pull"].error_message}
              </div>
            )}
            {latestRunsByJobType["tracked-apps-check"]?.error_message && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "12px",
                  background: "rgba(239, 62, 66, 0.1)",
                  border: "1px solid var(--dodger-red)",
                  borderRadius: "6px",
                  color: "var(--dodger-red)",
                }}
              >
                <strong>Tracked Apps Scan Error:</strong>{" "}
                {latestRunsByJobType["tracked-apps-check"].error_message}
              </div>
            )}
          </div>
        )}

        {/* Run History and Logs */}
        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "300px 1fr",
              gap: "20px",
            }}
          >
            {/* Run History List */}
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "15px",
                  borderBottom: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                }}
              >
                <h4 style={{ margin: 0, color: "var(--text-primary)" }}>
                  Run History
                </h4>
              </div>
              <div style={{ maxHeight: "600px", overflowY: "auto" }}>
                {recentRuns.length === 0 ? (
                  <div
                    style={{
                      padding: "20px",
                      textAlign: "center",
                      color: "var(--text-secondary)",
                    }}
                  >
                    No batch runs yet
                  </div>
                ) : (
                  recentRuns.map((run) => (
                    <div
                      key={run.id}
                      onClick={() => setSelectedRun(run)}
                      style={{
                        padding: "12px 15px",
                        borderBottom: "1px solid var(--border-color)",
                        cursor: "pointer",
                        background:
                          selectedRun?.id === run.id
                            ? "var(--bg-tertiary)"
                            : "transparent",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (selectedRun?.id !== run.id) {
                          e.currentTarget.style.background =
                            "var(--bg-tertiary)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedRun?.id !== run.id) {
                          e.currentTarget.style.background = "transparent";
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "5px",
                          flexWrap: "wrap",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: "600",
                              color: "var(--text-primary)",
                            }}
                          >
                            Run #{run.id}
                          </span>
                          {getJobTypeBadge(run.job_type)}
                          {getStatusBadge(run.status)}
                          {Number(run.is_manual) === 1 && getManualBadge()}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {formatDate(run.started_at)}
                      </div>
                      {run.containers_checked !== null && (
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-tertiary)",
                            marginTop: "3px",
                          }}
                        >
                          {run.job_type === "tracked-apps-check"
                            ? `${run.containers_checked} apps, ${
                                run.containers_updated || 0
                              } updates`
                            : `${run.containers_checked} containers, ${
                                run.containers_updated || 0
                              } updates`}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Logs Display */}
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "15px",
                  borderBottom: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                }}
              >
                <h4 style={{ margin: 0, color: "var(--text-primary)" }}>
                  {selectedRun
                    ? `Run #${selectedRun.id} Logs`
                    : "Select a run to view logs"}
                </h4>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: "15px",
                  overflowY: "auto",
                  maxHeight: "600px",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                }}
              >
                {selectedRun && selectedRun.logs ? (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "var(--text-primary)",
                    }}
                  >
                    {selectedRun.logs}
                  </pre>
                ) : selectedRun ? (
                  <div style={{ color: "var(--text-secondary)" }}>
                    No logs available for this run
                  </div>
                ) : (
                  <div style={{ color: "var(--text-secondary)" }}>
                    Select a run from the history to view its logs
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BatchLogs;
