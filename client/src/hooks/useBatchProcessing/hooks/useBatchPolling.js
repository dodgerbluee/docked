/**
 * Hook for batch run polling
 */

import { useEffect, useRef } from "react";
import { parseUTCTimestamp } from "../../../utils/formatters";
import { fetchLatestRunsByJobType } from "../../batchRunsCache";
import { isBackendUp } from "../../../utils/backendStatus";

/**
 * Hook for batch run polling
 * @param {Object} params - Parameters
 * @param {boolean} params.isAuthenticated - Whether user is authenticated
 * @param {string} params.authToken - Auth token
 * @param {Object} params.batchConfig - Batch configuration
 * @param {Function} params.setLastPullTime - Set last pull time function
 * @param {Function} params.fetchContainers - Function to fetch containers
 * @param {Function} params.fetchTrackedApps - Function to fetch tracked apps
 * @returns {void}
 */
export const useBatchPolling = ({
  isAuthenticated,
  authToken,
  batchConfig,
  setLastPullTime,
  fetchContainers,
  fetchTrackedApps,
}) => {
  const lastCheckedBatchRunIdRef = useRef(null);
  const lastCheckedBatchRunStatusRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunIdRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunStatusRef = useRef(null);
  const initialPollDoneRef = useRef(false);
  // Track whether this is the very first poll check – on the first check we
  // seed the "last seen" refs but do NOT trigger data refreshes because the
  // data was already fetched during app initialisation.
  const isFirstCheckRef = useRef(true);

  useEffect(() => {
    if (!isAuthenticated || !authToken) {
      initialPollDoneRef.current = false;
      return;
    }

    // Only run polling if at least one batch job type is enabled
    const dockerHubEnabled = batchConfig["docker-hub-pull"]?.enabled || false;
    const trackedAppsEnabled = batchConfig["tracked-apps-check"]?.enabled || false;

    if (!dockerHubEnabled && !trackedAppsEnabled) {
      return;
    }

    const checkBatchRuns = async () => {
      const isFirstCheck = isFirstCheckRef.current;
      if (isFirstCheck) {
        isFirstCheckRef.current = false;
      }

      try {
        const runs = await fetchLatestRunsByJobType();
        if (runs) {
          // Check Docker Hub pull batch run (only if enabled)
          if (dockerHubEnabled) {
            const dockerHubRun = runs["docker-hub-pull"];
            if (dockerHubRun) {
              const previousStatus = lastCheckedBatchRunStatusRef.current;
              const previousId = lastCheckedBatchRunIdRef.current;

              // Always update the refs to track the current state
              lastCheckedBatchRunIdRef.current = dockerHubRun.id;
              lastCheckedBatchRunStatusRef.current = dockerHubRun.status;

              if (dockerHubRun.status === "completed" && dockerHubRun.completed_at) {
                const completedAt = parseUTCTimestamp(dockerHubRun.completed_at);

                const isNewRun = dockerHubRun.id !== previousId;
                const justCompleted =
                  dockerHubRun.id === previousId &&
                  previousStatus !== "completed" &&
                  previousStatus !== null;

                const shouldUpdate = isNewRun || justCompleted;

                // On the first check we only seed the refs – data was already
                // fetched during app initialisation so we skip the refresh.
                if (shouldUpdate && !isFirstCheck) {
                  setLastPullTime(completedAt);
                  localStorage.setItem("lastPullTime", completedAt.toISOString());

                  // Refresh container data when batch completes
                  if (fetchContainers) {
                    fetchContainers(false); // false = don't show loading spinner
                  }
                } else if (isFirstCheck && dockerHubRun.completed_at) {
                  // Still update lastPullTime on first check so the UI shows it
                  setLastPullTime(completedAt);
                  localStorage.setItem("lastPullTime", completedAt.toISOString());
                }
              }
            }
          }

          // Check tracked apps check batch run (only if enabled)
          if (trackedAppsEnabled) {
            const trackedAppsRun = runs["tracked-apps-check"];
            if (trackedAppsRun) {
              const previousStatus = lastCheckedTrackedAppsBatchRunStatusRef.current;
              const previousId = lastCheckedTrackedAppsBatchRunIdRef.current;

              // Always update the refs to track the current state
              lastCheckedTrackedAppsBatchRunIdRef.current = trackedAppsRun.id;
              lastCheckedTrackedAppsBatchRunStatusRef.current = trackedAppsRun.status;

              if (trackedAppsRun.status === "completed" && trackedAppsRun.completed_at) {
                // Parse timestamp for potential future use
                parseUTCTimestamp(trackedAppsRun.completed_at);

                const isNewRun = trackedAppsRun.id !== previousId;
                const justCompleted =
                  trackedAppsRun.id === previousId &&
                  previousStatus !== "completed" &&
                  previousStatus !== null;

                const shouldUpdate = isNewRun || justCompleted;

                // On the first check we only seed the refs – data was already
                // fetched during app initialisation so we skip the refresh.
                if (shouldUpdate && !isFirstCheck) {
                  // Refresh tracked apps when batch completes
                  if (fetchTrackedApps) {
                    fetchTrackedApps();
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Error checking batch runs:", err);
      }
    };

    // Initial check (guard prevents StrictMode double-fetch)
    if (!initialPollDoneRef.current) {
      initialPollDoneRef.current = true;
      checkBatchRuns();
    }
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && isBackendUp()) {
        checkBatchRuns();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, authToken, setLastPullTime, batchConfig, fetchContainers, fetchTrackedApps]);
};
