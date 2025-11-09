/**
 * Batch Logs Component
 * Displays batch processing logs and run history
 */

import React, { useState, useEffect, useCallback, useRef, useContext } from "react";
import axios from "axios";
import "./Settings.css";
import { BatchConfigContext } from "../App";

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

function BatchLogs({ onNavigateHome = null, onTriggerBatch = null, onTriggerTrackedAppsBatch = null }) {
  // Get batchConfigs from Context - this will automatically update when state changes
  const contextValue = useContext(BatchConfigContext);
  const batchConfigs = contextValue?.batchConfig || {};
  
  // Check if any job type is enabled
  const hasEnabledJobs = (batchConfigs['docker-hub-pull']?.enabled || false) || 
                         (batchConfigs['tracked-apps-check']?.enabled || false);
  
  const [latestRun, setLatestRun] = useState(null);
  const [latestRunsByJobType, setLatestRunsByJobType] = useState({});
  const [recentRuns, setRecentRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggeringBatch, setTriggeringBatch] = useState(false);
  const [triggeringTrackedAppsBatch, setTriggeringTrackedAppsBatch] = useState(false);
  const [nextScheduledRun, setNextScheduledRun] = useState(null);
  const lastTriggeredIntervalRef = useRef(null);
  const lastCalculatedRunIdRef = useRef(null);
  const lastCalculatedIntervalRef = useRef(null);
  const baseScheduledTimeRef = useRef(null); // Store the base scheduled time that doesn't change
  const lastDependencyKeyRef = useRef(null); // Track the last dependency key to prevent unnecessary recalculations
  
  // Log whenever batchConfigs changes from Context and reset dependency tracking
  useEffect(() => {
    console.log("📥 BatchLogs received batchConfigs from Context:", {
      batchConfigs,
      dockerHubEnabled: batchConfigs['docker-hub-pull']?.enabled,
      trackedAppsEnabled: batchConfigs['tracked-apps-check']?.enabled,
    });
    // Reset dependency tracking when configs change to force recalculation
    lastDependencyKeyRef.current = null;
    baseScheduledTimeRef.current = null;
    lastCalculatedRunIdRef.current = null;
    lastCalculatedIntervalRef.current = null;
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

  // Update next scheduled run when batchConfigs or recentRuns change
  useEffect(() => {
    // Create a stable dependency key
    const completed = recentRuns.find(r => r.status === 'completed');
    const running = recentRuns.find(r => r.status === 'running');
    const dockerHubEnabled = batchConfigs['docker-hub-pull']?.enabled || false;
    const trackedAppsEnabled = batchConfigs['tracked-apps-check']?.enabled || false;
    const dockerHubInterval = batchConfigs['docker-hub-pull']?.intervalMinutes || 60;
    const trackedAppsInterval = batchConfigs['tracked-apps-check']?.intervalMinutes || 60;
    const dependencyKey = `${dockerHubEnabled}-${dockerHubInterval}-${trackedAppsEnabled}-${trackedAppsInterval}-${completed ? `${completed.id}-${completed.completed_at}` : running ? `${running.id}-${running.started_at}` : 'none'}`;
    
    // Only recalculate if the dependency key actually changed
    if (lastDependencyKeyRef.current === dependencyKey && baseScheduledTimeRef.current !== null) {
      // Dependencies haven't changed - use the stored base time
      setNextScheduledRun(new Date(baseScheduledTimeRef.current));
      return;
    }
    
    // Update the dependency key
    lastDependencyKeyRef.current = dependencyKey;
    
    console.log("🔄 BatchLogs useEffect triggered", {
      batchConfigs,
      dockerHubEnabled,
      trackedAppsEnabled,
      recentRunsLength: recentRuns.length,
      dependencyKey
    });
    
    // Recalculate next scheduled run whenever dependencies change
    // Use docker-hub-pull config for next scheduled run calculation (or first enabled one)
    const activeConfig = dockerHubEnabled ? batchConfigs['docker-hub-pull'] : 
                        (trackedAppsEnabled ? batchConfigs['tracked-apps-check'] : null);
    
    if (!activeConfig || !activeConfig.enabled || !activeConfig.intervalMinutes) {
      console.log("⚠️ No active batch config, setting nextScheduledRun to null");
      setNextScheduledRun(null);
      lastCalculatedRunIdRef.current = null;
      lastCalculatedIntervalRef.current = null;
      baseScheduledTimeRef.current = null;
      return;
    }
    
    const batchConfig = activeConfig; // Use for compatibility with rest of the function
    const now = new Date();
    const intervalMs = batchConfig.intervalMinutes * 60 * 1000;
    let calculatedNextRun = null;
    let lastRunId = null;

    // Find the most recent completed run
    const lastCompletedRun = recentRuns.find(run => run.status === 'completed');
    if (lastCompletedRun && lastCompletedRun.completed_at) {
      lastRunId = lastCompletedRun.id;
      // If we have a completed run, next run is after the interval
      const completedAtStr = lastCompletedRun.completed_at;
      let completedAt;
      if (typeof completedAtStr === 'string' && /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(completedAtStr)) {
        completedAt = new Date(completedAtStr.replace(' ', 'T') + 'Z');
      } else {
        completedAt = new Date(completedAtStr);
      }
      calculatedNextRun = new Date(completedAt.getTime() + intervalMs);
    } else {
      // If no completed run, check if there's a running one
      const runningRun = recentRuns.find(run => run.status === 'running');
      if (runningRun && runningRun.started_at) {
        lastRunId = runningRun.id;
        const startedAtStr = runningRun.started_at;
        let startedAt;
        if (typeof startedAtStr === 'string' && /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)) {
          startedAt = new Date(startedAtStr.replace(' ', 'T') + 'Z');
        } else {
          startedAt = new Date(startedAtStr);
        }
        calculatedNextRun = new Date(startedAt.getTime() + intervalMs);
      } else {
        // No runs at all - only calculate once per interval change, don't recalculate on every refresh
        // Check if we've already calculated for this interval
        if (lastCalculatedRunIdRef.current === 'none' && lastCalculatedIntervalRef.current === batchConfig.intervalMinutes) {
          // Already calculated for this interval, don't recalculate
          return;
        }
        // First time calculating - use current time
        calculatedNextRun = new Date(now.getTime() + intervalMs);
      }
    }

    // Only recalculate if the last run ID or interval actually changed
    const currentKey = `${lastRunId || 'none'}-${batchConfig.intervalMinutes}`;
    const lastKey = `${lastCalculatedRunIdRef.current}-${lastCalculatedIntervalRef.current}`;
    
    if (currentKey === lastKey && baseScheduledTimeRef.current !== null) {
      // Same run and interval - don't recalculate, use the stored base time
      // This prevents the time from incrementing on every refresh
      setNextScheduledRun(new Date(baseScheduledTimeRef.current));
      return;
    }

    // Update refs to track what we calculated
    lastCalculatedRunIdRef.current = lastRunId;
    lastCalculatedIntervalRef.current = batchConfig.intervalMinutes;
    // Store the base scheduled time (timestamp) so we don't recalculate
    if (calculatedNextRun) {
      baseScheduledTimeRef.current = calculatedNextRun.getTime();
    }

    // If the calculated next run is in the past (interval was increased), 
    // trigger batch immediately and recalculate from now
    // Only trigger once per interval change to avoid multiple triggers
    if (calculatedNextRun && calculatedNextRun < now) {
      const currentIntervalKey = `${batchConfig.intervalMinutes}-${lastRunId || 'none'}`;
      if (lastTriggeredIntervalRef.current !== currentIntervalKey) {
        console.log("⚠️ Next scheduled run is in the past - triggering batch immediately");
        lastTriggeredIntervalRef.current = currentIntervalKey;
        // Trigger batch process immediately
        if (onTriggerBatch) {
          onTriggerBatch().catch((err) => {
            console.error("Error triggering batch after interval update:", err);
          });
        }
      }
      // Recalculate from current time instead
      calculatedNextRun = new Date(now.getTime() + intervalMs);
      baseScheduledTimeRef.current = calculatedNextRun.getTime();
    } else {
      // Reset the trigger guard when next run is not in the past
      lastTriggeredIntervalRef.current = null;
    }

    console.log("✅ Setting nextScheduledRun:", calculatedNextRun);
    setNextScheduledRun(calculatedNextRun);
  }, [
    // Depend on batchConfigs and recentRuns, but use ref-based tracking inside to prevent unnecessary recalculations
    batchConfigs,
    recentRuns,
  ]);

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
      const byJobTypeResponse = await axios.get(`${API_BASE_URL}/api/batch/runs/latest?byJobType=true`);
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
      const response = await axios.get(`${API_BASE_URL}/api/batch/runs?limit=20`);
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
    if (typeof dateString === 'string') {
      // Check if it's a SQLite datetime format (YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS)
      if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(dateString)) {
        // SQLite datetime without timezone - assume UTC and add 'Z'
        date = new Date(dateString.replace(' ', 'T') + 'Z');
      } else if (dateString.includes('T') && !dateString.includes('Z') && !dateString.match(/[+-]\d{2}:\d{2}$/)) {
        // ISO string without timezone - assume UTC
        date = new Date(dateString + 'Z');
      } else {
        // Already has timezone info or is in a different format
        date = new Date(dateString);
      }
    } else {
      date = new Date(dateString);
    }
    
    // Format in America/Chicago timezone
    return date.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    });
  };

  const getJobTypeBadge = (jobType) => {
    const jobTypes = {
      'docker-hub-pull': { bg: "rgba(0, 90, 156, 0.2)", color: "var(--dodger-blue)", text: "Docker Hub Scan" },
      'tracked-apps-check': { bg: "rgba(139, 92, 246, 0.2)", color: "#8b5cf6", text: "Tracked Apps Scan" },
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
      running: { bg: "rgba(0, 90, 156, 0.2)", color: "var(--dodger-blue)", text: "Running" },
      completed: { bg: "rgba(34, 197, 94, 0.2)", color: "#22c55e", text: "Completed" },
      failed: { bg: "rgba(239, 62, 66, 0.2)", color: "var(--dodger-red)", text: "Failed" },
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

  const getNextScheduledRun = () => {
    // Use docker-hub-pull config for next scheduled run calculation (or first enabled one)
    const activeConfig = batchConfigs['docker-hub-pull']?.enabled ? batchConfigs['docker-hub-pull'] : 
                        (batchConfigs['tracked-apps-check']?.enabled ? batchConfigs['tracked-apps-check'] : null);
    
    if (!activeConfig || !activeConfig.enabled || !activeConfig.intervalMinutes) {
      return null;
    }
    
    const batchConfig = activeConfig; // Use for compatibility with rest of the function

    // Find the most recent completed run
    const lastCompletedRun = recentRuns.find(run => run.status === 'completed');
    if (lastCompletedRun && lastCompletedRun.completed_at) {
      // If we have a completed run, next run is after the interval
      // Parse the completed_at date string as UTC (from SQLite)
      const completedAtStr = lastCompletedRun.completed_at;
      let completedAt;
      if (typeof completedAtStr === 'string' && /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(completedAtStr)) {
        completedAt = new Date(completedAtStr.replace(' ', 'T') + 'Z');
      } else {
        completedAt = new Date(completedAtStr);
      }
      const nextRun = new Date(completedAt.getTime() + batchConfig.intervalMinutes * 60 * 1000);
      return nextRun;
    }

    // If no completed run, check if there's a running one
    const runningRun = recentRuns.find(run => run.status === 'running');
    if (runningRun && runningRun.started_at) {
      // Parse the started_at date string as UTC (from SQLite)
      const startedAtStr = runningRun.started_at;
      let startedAt;
      if (typeof startedAtStr === 'string' && /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)) {
        startedAt = new Date(startedAtStr.replace(' ', 'T') + 'Z');
      } else {
        startedAt = new Date(startedAtStr);
      }
      const nextRun = new Date(startedAt.getTime() + batchConfig.intervalMinutes * 60 * 1000);
      return nextRun;
    }

    // No runs at all - calculate next run from current time
    // The initial pull runs after 5 seconds, then subsequent runs are at the interval
    // For display purposes, show when the first scheduled recurring run will be
    // This is: current time + interval (the first scheduled run after initial setup)
    const now = new Date();
    const intervalMs = batchConfig.intervalMinutes * 60 * 1000;
    // Show the first scheduled recurring run (after the initial pull completes)
    // We estimate initial pull takes ~30 seconds, so next run is: now + ~30s + interval
    // But for simplicity, just show: now + interval (first scheduled run)
    const nextRun = new Date(now.getTime() + intervalMs);
    return nextRun;
  };

  const formatNextRun = (nextRunDate) => {
    if (!nextRunDate) return "N/A";
    return nextRunDate.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
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
          <p style={{ color: "var(--text-secondary)" }}>Loading batch logs...</p>
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
        <h3 style={{ marginTop: 0, color: "var(--text-primary)", marginBottom: "20px" }}>
          Next Scheduled Runs
        </h3>
        {hasEnabledJobs ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Docker Hub Scan */}
            {batchConfigs['docker-hub-pull']?.enabled && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: "15px",
              alignItems: "center",
              padding: "12px",
              background: "var(--bg-tertiary)",
              borderRadius: "6px",
            }}>
              <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>
                {getJobTypeBadge('docker-hub-pull')}
              </div>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: "12px",
                flexWrap: "wrap",
                justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>
                    {formatNextRun(nextScheduledRun)}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    (Interval: {batchConfigs['docker-hub-pull']?.intervalMinutes ? (
                      batchConfigs['docker-hub-pull'].intervalMinutes === 60
                        ? "1 hour"
                        : batchConfigs['docker-hub-pull'].intervalMinutes < 60
                        ? `${batchConfigs['docker-hub-pull'].intervalMinutes} minutes`
                        : (() => {
                            const hours = batchConfigs['docker-hub-pull'].intervalMinutes / 60;
                            return hours % 1 === 0 ? `${hours} hours` : `${hours.toFixed(1)} hours`;
                          })()
                    ) : "N/A"})
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
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.85rem",
                    fontWeight: "600",
                    background: triggeringBatch ? "var(--text-secondary)" : "var(--dodger-blue)",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: triggeringBatch ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    opacity: triggeringBatch ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!triggeringBatch) {
                      e.currentTarget.style.background = "var(--dodger-blue-light)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!triggeringBatch) {
                      e.currentTarget.style.background = "var(--dodger-blue)";
                    }
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
            {batchConfigs['tracked-apps-check']?.enabled && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: "15px",
              alignItems: "center",
              padding: "12px",
              background: "var(--bg-tertiary)",
              borderRadius: "6px",
            }}>
              <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>
                {getJobTypeBadge('tracked-apps-check')}
              </div>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: "12px",
                flexWrap: "wrap",
                justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>
                    {formatNextRun(nextScheduledRun)}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    (Interval: {batchConfigs['tracked-apps-check']?.intervalMinutes ? (
                      batchConfigs['tracked-apps-check'].intervalMinutes === 60
                        ? "1 hour"
                        : batchConfigs['tracked-apps-check'].intervalMinutes < 60
                        ? `${batchConfigs['tracked-apps-check'].intervalMinutes} minutes`
                        : (() => {
                            const hours = batchConfigs['tracked-apps-check'].intervalMinutes / 60;
                            return hours % 1 === 0 ? `${hours} hours` : `${hours.toFixed(1)} hours`;
                          })()
                    ) : "N/A"})
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
                        console.error("Error triggering tracked apps batch:", err);
                      } finally {
                        setTriggeringTrackedAppsBatch(false);
                      }
                    }
                  }}
                  disabled={triggeringTrackedAppsBatch}
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.85rem",
                    fontWeight: "600",
                    background: triggeringTrackedAppsBatch ? "var(--text-secondary)" : "#8b5cf6",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: triggeringTrackedAppsBatch ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    opacity: triggeringTrackedAppsBatch ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!triggeringTrackedAppsBatch) {
                      e.currentTarget.style.background = "#7c3aed";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!triggeringTrackedAppsBatch) {
                      e.currentTarget.style.background = "#8b5cf6";
                    }
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
            No batch jobs are currently scheduled. Enable batch processing in Settings to schedule automatic runs.
          </div>
        )}
      </div>

      {/* Latest Run Summary - Show last run for each job type */}
      {(latestRunsByJobType['docker-hub-pull'] || latestRunsByJobType['tracked-apps-check']) && (
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
          <h3 style={{ marginTop: 0, color: "var(--text-primary)", marginBottom: "20px" }}>
            Last Run
          </h3>
          <div style={{
            display: "table",
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: "0",
          }}>
            {/* Table Header */}
            <div style={{
              display: "table-row",
              background: "var(--bg-tertiary)",
            }}>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Job Type
              </div>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Status
              </div>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Start Time
              </div>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Completed Time
              </div>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Duration
              </div>
              <div style={{
                display: "table-cell",
                padding: "12px",
                fontWeight: "600",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}>
                Details
              </div>
            </div>
            {/* Table Rows - One for each job type */}
            {latestRunsByJobType['docker-hub-pull'] && (
              <div style={{ display: "table-row" }}>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {getJobTypeBadge('docker-hub-pull')}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {getStatusBadge(latestRunsByJobType['docker-hub-pull'].status)}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {formatDate(latestRunsByJobType['docker-hub-pull'].started_at)}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {latestRunsByJobType['docker-hub-pull'].completed_at ? formatDate(latestRunsByJobType['docker-hub-pull'].completed_at) : "N/A"}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {latestRunsByJobType['docker-hub-pull'].duration_ms ? formatDuration(latestRunsByJobType['docker-hub-pull'].duration_ms) : "N/A"}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  <div style={{ marginBottom: "4px" }}>{latestRunsByJobType['docker-hub-pull'].containers_checked || 0} containers checked</div>
                  <div>{latestRunsByJobType['docker-hub-pull'].containers_updated || 0} updates found</div>
                </div>
              </div>
            )}
            {latestRunsByJobType['tracked-apps-check'] && (
              <div style={{ display: "table-row" }}>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {getJobTypeBadge('tracked-apps-check')}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {getStatusBadge(latestRunsByJobType['tracked-apps-check'].status)}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {formatDate(latestRunsByJobType['tracked-apps-check'].started_at)}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {latestRunsByJobType['tracked-apps-check'].completed_at ? formatDate(latestRunsByJobType['tracked-apps-check'].completed_at) : "N/A"}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  {latestRunsByJobType['tracked-apps-check'].duration_ms ? formatDuration(latestRunsByJobType['tracked-apps-check'].duration_ms) : "N/A"}
                </div>
                <div style={{
                  display: "table-cell",
                  padding: "12px",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-color)",
                }}>
                  <div style={{ marginBottom: "4px" }}>{latestRunsByJobType['tracked-apps-check'].containers_checked || 0} apps checked</div>
                  <div>{latestRunsByJobType['tracked-apps-check'].containers_updated || 0} updates found</div>
                </div>
              </div>
            )}
          </div>
          {/* Error messages for each job type */}
          {latestRunsByJobType['docker-hub-pull']?.error_message && (
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
              <strong>Docker Hub Scan Error:</strong> {latestRunsByJobType['docker-hub-pull'].error_message}
            </div>
          )}
          {latestRunsByJobType['tracked-apps-check']?.error_message && (
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
              <strong>Tracked Apps Scan Error:</strong> {latestRunsByJobType['tracked-apps-check'].error_message}
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
                      e.currentTarget.style.background = "var(--bg-tertiary)";
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
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>
                        Run #{run.id}
                      </span>
                      {getJobTypeBadge(run.job_type)}
                    </div>
                    {getStatusBadge(run.status)}
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
                      {run.job_type === 'tracked-apps-check' 
                        ? `${run.containers_checked} apps, ${run.containers_updated || 0} updates`
                        : `${run.containers_checked} containers, ${run.containers_updated || 0} updates`}
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
              {selectedRun ? `Run #${selectedRun.id} Logs` : "Select a run to view logs"}
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


