/**
 * Hook for batch run polling
 */

import { useEffect, useRef } from "react";
import { parseUTCTimestamp } from "../../../utils/formatters";
import { fetchLatestRunsByJobType } from "../../batchRunsCache";
import { isBackendUp } from "../../../utils/backendStatus";
import { graphqlClient } from "../../../graphql/client";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";
import {
  INTENT_EXECUTIONS_QUERY,
  BATCH_JOB_PROGRESS_SUBSCRIPTION,
  INTENT_EXECUTION_PROGRESS_SUBSCRIPTION,
  CONTAINERS_UPDATED_SUBSCRIPTION,
} from "../../../graphql/queries";

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
  const lastCheckedIntentExecutionIdRef = useRef(null);
  const lastCheckedIntentExecutionStatusRef = useRef(null);
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

    const dockerHubEnabled = batchConfig["docker-hub-pull"]?.enabled || false;
    const trackedAppsEnabled = batchConfig["tracked-apps-check"]?.enabled || false;

    // Capture the session generation for this effect's lifetime: a login/logout
    // mid-flight makes every continuation below (localStorage writes, follow-up
    // fetches) belong to a dead session, and the interval/subscriptions of the
    // dead effect must not keep firing through the new session's client.
    const gen = getSessionGeneration();

    const checkBatchRuns = async () => {
      const isFirstCheck = isFirstCheckRef.current;
      if (isFirstCheck) {
        isFirstCheckRef.current = false;
      }

      try {
        const runs = await fetchLatestRunsByJobType();
        if (isSessionStale(gen)) return;
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

        // Check for newly-completed intent executions to refresh container update status.
        // This runs unconditionally (independent of batch job config) so that containers
        // refresh automatically after an intent finishes upgrading them.
        if (fetchContainers) {
          try {
            const execResult = await graphqlClient
              .query(INTENT_EXECUTIONS_QUERY, { first: 1 })
              .toPromise();
            if (isSessionStale(gen)) return;
            const executions = (execResult.data?.intentExecutions?.items || []).map((e) => ({
              id: Number(e.id),
              status: e.status?.toLowerCase(),
            }));
            if (executions.length > 0) {
              const latestExecution = executions[0];
              const previousId = lastCheckedIntentExecutionIdRef.current;
              const previousStatus = lastCheckedIntentExecutionStatusRef.current;

              lastCheckedIntentExecutionIdRef.current = latestExecution.id;
              lastCheckedIntentExecutionStatusRef.current = latestExecution.status;

              const terminalStatuses = ["completed", "partial-success"];
              if (terminalStatuses.includes(latestExecution.status)) {
                const isNewRun = latestExecution.id !== previousId;
                const justCompleted =
                  latestExecution.id === previousId &&
                  !terminalStatuses.includes(previousStatus) &&
                  previousStatus !== null;

                if ((isNewRun || justCompleted) && !isFirstCheck) {
                  fetchContainers(false);
                }
              }
            }
          } catch {
            // Intent execution polling is best-effort
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
      if (isSessionStale(gen)) return;
      if (document.visibilityState === "visible" && isBackendUp()) {
        checkBatchRuns();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, authToken, setLastPullTime, batchConfig, fetchContainers, fetchTrackedApps]);

  // GraphQL subscriptions: react to batch/intent/container events the moment
  // they happen instead of waiting for the next poll tick. The 30s poll above
  // stays as a safety net for events missed while the socket was down.
  useEffect(() => {
    if (!isAuthenticated || !authToken) return undefined;

    // Same guard as the poll: an event that lands after a session change must
    // not write the new session's lastPullTime/storage or trigger its fetches.
    const gen = getSessionGeneration();
    const subs = [];

    subs.push(
      graphqlClient.subscription(BATCH_JOB_PROGRESS_SUBSCRIPTION).subscribe(({ data }) => {
        if (isSessionStale(gen)) return;
        const run = data?.batchJobProgress;
        if (!run) return;
        const status = (run.status || "").toLowerCase();
        if (status !== "completed" && status !== "failed") return;

        if (run.jobType === "DOCKER_HUB_PULL") {
          if (run.completedAt) {
            const completedAt = new Date(run.completedAt);
            setLastPullTime(completedAt);
            localStorage.setItem("lastPullTime", completedAt.toISOString());
          }
          if (fetchContainers) fetchContainers(false);
        } else if (run.jobType === "TRACKED_APPS_CHECK" && fetchTrackedApps) {
          fetchTrackedApps();
        }
      })
    );

    subs.push(
      graphqlClient.subscription(INTENT_EXECUTION_PROGRESS_SUBSCRIPTION).subscribe(({ data }) => {
        if (isSessionStale(gen)) return;
        const exec = data?.intentExecutionProgress;
        if (!exec || !fetchContainers) return;
        const status = (exec.status || "").toLowerCase();
        if (status === "completed" || status === "partial") {
          fetchContainers(false);
        }
      })
    );

    subs.push(
      graphqlClient.subscription(CONTAINERS_UPDATED_SUBSCRIPTION).subscribe(() => {
        if (isSessionStale(gen)) return;
        if (fetchContainers) fetchContainers(false);
      })
    );

    return () => subs.forEach((s) => s.unsubscribe());
  }, [isAuthenticated, authToken, setLastPullTime, fetchContainers, fetchTrackedApps]);
};
