/**
 * Hook for batch trigger operations
 */

import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";
import { graphqlClient } from "../../../graphql/client";
import {
  TRACKED_APPS_QUERY,
  CHECK_TRACKED_APP_UPDATES_MUTATION,
  BATCH_RUNS_QUERY,
  CREATE_BATCH_RUN_MUTATION,
  UPDATE_BATCH_RUN_MUTATION,
  PULL_CONTAINERS_MUTATION,
} from "../../../graphql/queries";
import { mapGraphRunToRow } from "../../batchRunsCache";
import { handleDockerHubError } from "../../../utils/apiErrorHandler";
import { updateContainersWithPreservedState } from "../../../utils/containerStateHelpers";

/**
 * Hook for batch trigger operations
 * @param {Object} params - Parameters
 * @param {Object} params.containersData - Containers data object
 * @param {Object} params.successfullyUpdatedContainersRef - Ref for successfully updated containers
 * @param {Function} params.setPulling - Set pulling state function
 * @param {Function} params.setError - Set error function
 * @param {Function} params.setLastPullTime - Set last pull time function
 * @param {Function} params.fetchTrackedApps - Fetch tracked images function
 * @returns {Object} Batch trigger handlers
 */
export const useBatchTriggers = ({
  containersData,
  successfullyUpdatedContainersRef,
  setPulling,
  setError,
  setLastPullTime,
  fetchTrackedApps,
}) => {
  const {
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setSourceInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    fetchUnusedImages,
  } = containersData;

  const handleBatchPull = useCallback(async () => {
    try {
      setPulling(true);
      setError(null);

      // Kick off the container sync in the Go API. The mutation registers a
      // 'running' docker-hub-pull batch run before responding, so the poll
      // below always observes the new run.
      const triggerResult = await graphqlClient.mutation(PULL_CONTAINERS_MUTATION, {}).toPromise();
      if (triggerResult.error || !triggerResult.data?.pullContainers) {
        throw new Error(triggerResult.error?.message || "Failed to trigger container sync");
      }

      // Fetch cached data for immediate display (portainerOnly — no need to hit runners here)
      try {
        const cachedResponse = await axios.get(`${API_BASE_URL}/api/containers?portainerOnly=true`);
        if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
          const apiContainers = cachedResponse.data.containers || [];
          const updatedContainers = updateContainersWithPreservedState(
            apiContainers,
            successfullyUpdatedContainersRef
          );
          setContainers(updatedContainers);
          setStacks(cachedResponse.data.stacks || []);
          setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

          if (cachedResponse.data.sourceInstances || cachedResponse.data.portainerInstances) {
            setSourceInstancesFromAPI(
              cachedResponse.data.sourceInstances || cachedResponse.data.portainerInstances
            );
          }
          setDataFetched(true);
        }
      } catch {
        // Ignore cache errors
      }

      // Poll for the latest batch run to get the runId and wait for completion
      const maxWaitTime = 300000; // 5 minutes
      const pollInterval = 1000; // 1 second
      const startTime = Date.now();
      let batchRun = null;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const runsResult = await graphqlClient
            .query(BATCH_RUNS_QUERY, { jobType: "DOCKER_HUB_PULL", first: 1 })
            .toPromise();
          batchRun = mapGraphRunToRow(runsResult.data?.batchRuns?.items?.[0]);

          if (batchRun) {
            // Check if the run is completed or failed
            if (batchRun.status === "completed" || batchRun.status === "failed") {
              break;
            }
          }
        } catch {
          // Continue polling on error
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      if (!batchRun) {
        throw new Error("Batch job did not complete within the expected time");
      }

      if (batchRun.status === "failed") {
        throw new Error(batchRun.error_message || "Batch job failed");
      }

      // Fetch updated container data after batch job completes
      const response = await axios.get(`${API_BASE_URL}/api/containers`);

      if (response.data.grouped && response.data.stacks) {
        const apiContainers = response.data.containers || [];
        const updatedContainers = updateContainersWithPreservedState(
          apiContainers,
          successfullyUpdatedContainersRef
        );
        setContainers(updatedContainers);
        setStacks(response.data.stacks || []);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);

        if (response.data.sourceInstances || response.data.portainerInstances) {
          setSourceInstancesFromAPI(
            response.data.sourceInstances || response.data.portainerInstances
          );
        }

        setDockerHubDataPulled(true);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
        const pullTime = new Date();
        setLastPullTime(pullTime);
        localStorage.setItem("lastPullTime", pullTime.toISOString());
      }

      setError(null);
      setDataFetched(true);

      // Fetch unused images
      await fetchUnusedImages();
    } catch (err) {
      await handleDockerHubError(err, (msg) => {
        setError(msg);
      });
      console.error("Error in batch pull:", err);
    } finally {
      setPulling(false);
    }
  }, [
    setPulling,
    setError,
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setSourceInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    setLastPullTime,
    fetchUnusedImages,
    successfullyUpdatedContainersRef,
  ]);

  const handleBatchTrackedAppsCheck = useCallback(async () => {
    let runId = null;
    const logs = [];

    const log = (message) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      logs.push(logEntry);
      console.log(logEntry);
    };

    try {
      log("Starting tracked apps batch check process...");
      const runResult = await graphqlClient
        .mutation(CREATE_BATCH_RUN_MUTATION, { jobType: "TRACKED_APPS_CHECK" })
        .toPromise();
      if (runResult.error || !runResult.data?.createBatchRun?.id) {
        throw new Error(runResult.error?.message || "Failed to create batch run");
      }
      runId = runResult.data.createBatchRun.id;
      log(`Batch run ${runId} created`);

      log("🔄 Checking for tracked app updates...");
      log("Initiating tracked apps update check...");
      const result = await graphqlClient.mutation(CHECK_TRACKED_APP_UPDATES_MUTATION).toPromise();

      if (!result.error && result.data?.checkTrackedAppUpdates?.success) {
        log("Tracked apps check completed successfully");

        const updatedResponse = await graphqlClient.query(TRACKED_APPS_QUERY).toPromise();
        if (updatedResponse.error || !updatedResponse.data?.trackedApps) {
          throw new Error("Failed to fetch updated tracked images");
        }
        const updatedImages = updatedResponse.data.trackedApps;
        const appsChecked = updatedImages.length;
        const appsWithUpdates = updatedImages.filter((img) => Boolean(img.hasUpdate)).length;
        log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

        await fetchTrackedApps();

        if (runId) {
          await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "COMPLETED",
              containersChecked: appsChecked,
              containersUpdated: appsWithUpdates,
              logs: logs.join("\n"),
            })
            .toPromise();
          log(`Batch run ${runId} marked as completed`);
        }
      } else {
        throw new Error(result.error?.message || "Failed to check tracked apps");
      }
    } catch (err) {
      let errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to check tracked apps";
      log(`❌ Error: ${errorMessage}`);
      console.error("Error checking tracked apps:", err);

      if (runId) {
        try {
          await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "FAILED",
              errorMessage,
              logs: logs.join("\n"),
            })
            .toPromise();
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      log("Tracked apps batch check process finished (success or failure)");
    }
  }, [fetchTrackedApps]);

  return {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  };
};
