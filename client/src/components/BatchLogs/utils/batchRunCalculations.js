/**
 * Utility functions for calculating next scheduled run times
 */

/**
 * Parse date string from database format
 * @param {string} dateString - Date string from database
 * @returns {Date} Parsed Date object
 */
const parseDateString = (dateString) => {
  if (
    typeof dateString === "string" &&
    /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(dateString)
  ) {
    return new Date(dateString.replace(" ", "T") + "Z");
  }
  return new Date(dateString);
};

/**
 * Calculate next scheduled run time based on config and recent runs
 * @param {Object} config - Batch config for the job type
 * @param {Array} recentRuns - Array of recent batch runs
 * @param {string} jobType - Job type identifier
 * @param {Object} refs - Refs for caching calculations
 * @returns {Date|null} Next scheduled run time or null
 */
export const calculateNextScheduledRun = (config, recentRuns, jobType, refs) => {
  if (!config || !config.enabled || !config.intervalMinutes) {
    return null;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;

  // Find the most recent completed run for this job type
  const lastCompletedRun = recentRuns.find(
    (run) => run.status === "completed" && run.job_type === jobType
  );
  let calculatedNextRun = null;
  let lastRunId = null;

  if (lastCompletedRun && lastCompletedRun.completed_at) {
    lastRunId = lastCompletedRun.id;
    const completedAt = parseDateString(lastCompletedRun.completed_at);
    calculatedNextRun = new Date(completedAt.getTime() + intervalMs);
  } else {
    // Check for running job
    const runningRun = recentRuns.find(
      (run) => run.status === "running" && run.job_type === jobType
    );
    if (runningRun && runningRun.started_at) {
      lastRunId = runningRun.id;
      const startedAt = parseDateString(runningRun.started_at);
      calculatedNextRun = new Date(startedAt.getTime() + intervalMs);
    } else {
      // No runs - check if we already calculated a time for this scenario
      const currentKey = `none-${config.intervalMinutes}`;
      const lastKey = `${refs.lastCalculatedRunId?.current || "none"}-${
        refs.lastCalculatedInterval?.current || 0
      }`;
      if (currentKey === lastKey && refs.baseScheduledTime?.current !== null) {
        // Use the cached time - don't recalculate from current time
        return new Date(refs.baseScheduledTime.current);
      }
      // First time calculating - use current time and store it
      const now = new Date();
      calculatedNextRun = new Date(now.getTime() + intervalMs);
    }
  }

  // Check if we need to recalculate (only if run ID or interval changed)
  const currentKey = `${lastRunId || "none"}-${config.intervalMinutes}`;
  const lastKey = `${refs.lastCalculatedRunId?.current || "none"}-${
    refs.lastCalculatedInterval?.current || 0
  }`;

  if (currentKey === lastKey && refs.baseScheduledTime?.current !== null) {
    // Same run and interval - use cached time, don't recalculate
    return new Date(refs.baseScheduledTime.current);
  }

  // Only update if the run ID or interval actually changed
  refs.lastCalculatedRunId.current = lastRunId;
  refs.lastCalculatedInterval.current = config.intervalMinutes;

  // Store the calculated time (as timestamp) so it doesn't change
  if (calculatedNextRun) {
    refs.baseScheduledTime.current = calculatedNextRun.getTime();
    return calculatedNextRun;
  }

  return null;
};
