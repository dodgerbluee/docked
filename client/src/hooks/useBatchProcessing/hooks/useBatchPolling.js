/**
 * Hook for batch run polling
 */

import { useEffect, useRef } from "react";
import axios from "axios";
import { parseUTCTimestamp } from "../../../utils/formatters";
import { API_BASE_URL } from "../../../constants/api";

/**
 * Hook for batch run polling
 * @param {Object} params - Parameters
 * @param {boolean} params.isAuthenticated - Whether user is authenticated
 * @param {string} params.authToken - Auth token
 * @param {boolean} params.passwordChanged - Whether password has been changed
 * @param {Object} params.batchConfig - Batch configuration
 * @param {Function} params.setLastPullTime - Set last pull time function
 * @returns {void}
 */
export const useBatchPolling = ({
  isAuthenticated,
  authToken,
  passwordChanged,
  batchConfig,
  setLastPullTime,
}) => {
  const lastCheckedBatchRunIdRef = useRef(null);
  const lastCheckedBatchRunStatusRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunIdRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunStatusRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !authToken || !passwordChanged) {
      return;
    }

    // Only run polling if at least one batch job type is enabled
    const dockerHubEnabled = batchConfig["docker-hub-pull"]?.enabled || false;
    const trackedAppsEnabled = batchConfig["tracked-apps-check"]?.enabled || false;

    if (!dockerHubEnabled && !trackedAppsEnabled) {
      return;
    }

    const checkBatchRuns = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/batch/runs/latest?byJobType=true`);
        if (response.data.success && response.data.runs) {
          // Check Docker Hub pull batch run (only if enabled)
          if (dockerHubEnabled) {
            const dockerHubRun = response.data.runs["docker-hub-pull"];
            if (dockerHubRun) {
              const previousStatus = lastCheckedBatchRunStatusRef.current;
              const previousId = lastCheckedBatchRunIdRef.current;

              if (dockerHubRun.status === "completed" && dockerHubRun.completed_at) {
                const completedAt = parseUTCTimestamp(dockerHubRun.completed_at);

                const isNewRun = dockerHubRun.id !== previousId;
                const justCompleted =
                  dockerHubRun.id === previousId &&
                  previousStatus !== "completed" &&
                  previousStatus !== null;

                // Note: lastPullTime comparison needs to be done via a ref or callback
                // For now, we'll update if it's a new run or just completed
                const shouldUpdate =
                  isNewRun || justCompleted || (previousId === null && previousStatus === null);

                if (shouldUpdate) {
                  lastCheckedBatchRunIdRef.current = dockerHubRun.id;
                  lastCheckedBatchRunStatusRef.current = dockerHubRun.status;
                  setLastPullTime(completedAt);
                  localStorage.setItem("lastPullTime", completedAt.toISOString());
                } else {
                  lastCheckedBatchRunIdRef.current = dockerHubRun.id;
                  lastCheckedBatchRunStatusRef.current = dockerHubRun.status;
                }
              } else {
                lastCheckedBatchRunIdRef.current = dockerHubRun.id;
                lastCheckedBatchRunStatusRef.current = dockerHubRun.status;
              }
            }
          }

          // Check tracked apps check batch run (only if enabled)
          if (trackedAppsEnabled) {
            const trackedAppsRun = response.data.runs["tracked-apps-check"];
            if (trackedAppsRun) {
              const previousStatus = lastCheckedTrackedAppsBatchRunStatusRef.current;
              const previousId = lastCheckedTrackedAppsBatchRunIdRef.current;

              if (trackedAppsRun.status === "completed" && trackedAppsRun.completed_at) {
                // Parse timestamp for potential future use
                parseUTCTimestamp(trackedAppsRun.completed_at);

                const isNewRun = trackedAppsRun.id !== previousId;
                const justCompleted =
                  trackedAppsRun.id === previousId &&
                  previousStatus !== "completed" &&
                  previousStatus !== null;

                const shouldUpdate =
                  isNewRun || justCompleted || (previousId === null && previousStatus === null);

                if (shouldUpdate) {
                  lastCheckedTrackedAppsBatchRunIdRef.current = trackedAppsRun.id;
                  lastCheckedTrackedAppsBatchRunStatusRef.current = trackedAppsRun.status;
                } else {
                  lastCheckedTrackedAppsBatchRunIdRef.current = trackedAppsRun.id;
                  lastCheckedTrackedAppsBatchRunStatusRef.current = trackedAppsRun.status;
                }
              } else {
                lastCheckedTrackedAppsBatchRunIdRef.current = trackedAppsRun.id;
                lastCheckedTrackedAppsBatchRunStatusRef.current = trackedAppsRun.status;
              }
            }
          }
        }
      } catch (err) {
        console.error("Error checking batch runs:", err);
      }
    };

    checkBatchRuns();
    const interval = setInterval(checkBatchRuns, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, authToken, passwordChanged, setLastPullTime, batchConfig]);
};

