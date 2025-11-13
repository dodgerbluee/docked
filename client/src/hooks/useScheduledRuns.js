import { useState, useEffect, useRef, useCallback } from "react";
import { BATCH_JOB_TYPES } from "../constants/batch";
import { MILLISECONDS_PER_MINUTE } from "../constants/numbers";
import { parseSQLiteDate } from "../utils/dateParsing";

/**
 * Custom hook for calculating scheduled runs
 * Separated from useBatchLogs for better modularity
 */
export function useScheduledRuns(batchConfigs, recentRuns) {
  const [nextScheduledRunDockerHub, setNextScheduledRunDockerHub] = useState(null);
  const [nextScheduledRunTrackedApps, setNextScheduledRunTrackedApps] = useState(null);

  // Refs for scheduled run calculations
  const lastCalculatedRunIdRefDockerHub = useRef(null);
  const lastCalculatedIntervalRefDockerHub = useRef(null);
  const baseScheduledTimeRefDockerHub = useRef(null);
  const lastCalculatedRunIdRefTrackedApps = useRef(null);
  const lastCalculatedIntervalRefTrackedApps = useRef(null);
  const baseScheduledTimeRefTrackedApps = useRef(null);

  // Calculate next scheduled run for a job type
  const calculateNextScheduledRun = useCallback(
    (jobType, recentRuns, config, setNextRun, refs) => {
      if (!config || !config.enabled || !config.intervalMinutes) {
        setNextRun(null);
        refs.baseScheduledTime.current = null;
        return;
      }

      const intervalMs = config.intervalMinutes * MILLISECONDS_PER_MINUTE;
      const lastCompletedRun = recentRuns.find(
        (run) => run.status === "completed" && run.job_type === jobType
      );
      let calculatedNextRun = null;
      let lastRunId = null;

      if (lastCompletedRun && lastCompletedRun.completed_at) {
        lastRunId = lastCompletedRun.id;
        const completedAt = parseSQLiteDate(lastCompletedRun.completed_at);
        if (completedAt) {
          calculatedNextRun = new Date(completedAt.getTime() + intervalMs);
        }
      } else {
        const runningRun = recentRuns.find(
          (run) => run.status === "running" && run.job_type === jobType
        );
        if (runningRun && runningRun.started_at) {
          lastRunId = runningRun.id;
          const startedAt = parseSQLiteDate(runningRun.started_at);
          if (startedAt) {
            calculatedNextRun = new Date(startedAt.getTime() + intervalMs);
          }
        } else {
          const currentKey = `none-${config.intervalMinutes}`;
          const lastKey = `${refs.lastCalculatedRunId.current || "none"}-${
            refs.lastCalculatedInterval.current || 0
          }`;
          if (currentKey === lastKey && refs.baseScheduledTime.current !== null) {
            setNextRun(new Date(refs.baseScheduledTime.current));
            return;
          }
          const now = new Date();
          calculatedNextRun = new Date(now.getTime() + intervalMs);
        }
      }

      const currentKey = `${lastRunId || "none"}-${config.intervalMinutes}`;
      const lastKey = `${refs.lastCalculatedRunId.current || "none"}-${
        refs.lastCalculatedInterval.current || 0
      }`;

      if (currentKey === lastKey && refs.baseScheduledTime.current !== null) {
        setNextRun(new Date(refs.baseScheduledTime.current));
        return;
      }

      refs.lastCalculatedRunId.current = lastRunId;
      refs.lastCalculatedInterval.current = config.intervalMinutes;

      if (calculatedNextRun) {
        refs.baseScheduledTime.current = calculatedNextRun.getTime();
        setNextRun(calculatedNextRun);
      }
    },
    []
  );

  // Calculate next scheduled run for Docker Hub
  useEffect(() => {
    calculateNextScheduledRun(
      BATCH_JOB_TYPES.DOCKER_HUB_PULL,
      recentRuns,
      batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL],
      setNextScheduledRunDockerHub,
      {
        lastCalculatedRunId: lastCalculatedRunIdRefDockerHub,
        lastCalculatedInterval: lastCalculatedIntervalRefDockerHub,
        baseScheduledTime: baseScheduledTimeRefDockerHub,
      }
    );
  }, [batchConfigs, recentRuns, calculateNextScheduledRun]);

  // Calculate next scheduled run for Tracked Apps
  useEffect(() => {
    calculateNextScheduledRun(
      BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
      recentRuns,
      batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK],
      setNextScheduledRunTrackedApps,
      {
        lastCalculatedRunId: lastCalculatedRunIdRefTrackedApps,
        lastCalculatedInterval: lastCalculatedIntervalRefTrackedApps,
        baseScheduledTime: baseScheduledTimeRefTrackedApps,
      }
    );
  }, [batchConfigs, recentRuns, calculateNextScheduledRun]);

  // Reset dependency tracking when configs change
  useEffect(() => {
    baseScheduledTimeRefDockerHub.current = null;
    lastCalculatedRunIdRefDockerHub.current = null;
    lastCalculatedIntervalRefDockerHub.current = null;
    baseScheduledTimeRefTrackedApps.current = null;
    lastCalculatedRunIdRefTrackedApps.current = null;
    lastCalculatedIntervalRefTrackedApps.current = null;
  }, [batchConfigs]);

  return {
    nextScheduledRunDockerHub,
    nextScheduledRunTrackedApps,
  };
}

