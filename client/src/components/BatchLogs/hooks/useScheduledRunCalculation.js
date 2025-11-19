/**
 * Custom hook for calculating next scheduled run times
 */

import { useState, useEffect, useRef } from "react";
import { calculateNextScheduledRun } from "../utils/batchRunCalculations";

/**
 * Hook to calculate next scheduled run for a specific job type
 * @param {Object} config - Batch config for the job type
 * @param {Array} recentRuns - Array of recent batch runs
 * @param {string} jobType - Job type identifier
 * @returns {Date|null} Next scheduled run time or null
 */
export const useScheduledRunCalculation = (config, recentRuns, jobType) => {
  const [nextScheduledRun, setNextScheduledRun] = useState(null);
  const lastCalculatedRunIdRef = useRef(null);
  const lastCalculatedIntervalRef = useRef(null);
  const baseScheduledTimeRef = useRef(null);

  useEffect(() => {
    if (!config || !config.enabled || !config.intervalMinutes) {
      setNextScheduledRun(null);
      baseScheduledTimeRef.current = null;
      return;
    }

    const refs = {
      lastCalculatedRunId: lastCalculatedRunIdRef,
      lastCalculatedInterval: lastCalculatedIntervalRef,
      baseScheduledTime: baseScheduledTimeRef,
    };

    const calculated = calculateNextScheduledRun(config, recentRuns, jobType, refs);
    setNextScheduledRun(calculated);
  }, [config, recentRuns, jobType]);

  // Reset refs when config changes
  useEffect(() => {
    baseScheduledTimeRef.current = null;
    lastCalculatedRunIdRef.current = null;
    lastCalculatedIntervalRef.current = null;
  }, [config]);

  return nextScheduledRun;
};

