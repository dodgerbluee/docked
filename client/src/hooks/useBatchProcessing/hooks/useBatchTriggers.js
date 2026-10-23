/**
 * Hook for batch trigger operations
 */

import { useCallback } from "react";
import { graphqlClient } from "../../../graphql/client";
import {
  TRACKED_APPS_QUERY,
  CHECK_TRACKED_APP_UPDATES_MUTATION,
  CREATE_BATCH_RUN_MUTATION,
  UPDATE_BATCH_RUN_MUTATION,
} from "../../../graphql/queries";
import { fetchContainersGraphql } from "../../../graphql/containers";
import { runContainerSync } from "../../../graphql/sync";
import { handleDockerHubError } from "../../../utils/apiErrorHandler";
import { updateContainersWithPreservedState } from "../../../utils/containerStateHelpers";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";

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
  const { setContainers, setStacks, setDockerHubDataPulled, setDataFetched, fetchUnusedImages } =
    containersData;

  const handleBatchPull = useCallback(async () => {
    // Session generation captured before any async work: every continuation
    // (state writes, localStorage, follow-up fetches) must be dropped when a
    // login/logout ends the session this pull was started in.
    const gen = getSessionGeneration();
    const stale = () => isSessionStale(gen);
    try {
      setPulling(true);
      setError(null);

      // Kick off the container sync in the Go API and wait for its batch run
      // to finish (the mutation registers a 'running' docker-hub-pull run
      // before responding, so the poll always observes the new run).
      // runContainerSync stops polling on session change; the no-op catch
      // keeps an early return from surfacing an unhandled rejection.
      const syncPromise = runContainerSync();
      syncPromise.catch(() => {});

      // Show cached data while the registry scan works
      try {
        const { containers: apiContainers, stacks: apiStacks } = await fetchContainersGraphql();
        if (stale()) return;
        const updatedContainers = updateContainersWithPreservedState(
          apiContainers,
          successfullyUpdatedContainersRef
        );
        setContainers(updatedContainers);
        setStacks(apiStacks);
        setDataFetched(true);
      } catch {
        if (stale()) return;
        // Ignore cache errors
      }

      await syncPromise;
      if (stale()) return;

      // Registry data is fresh now — refetch so hasUpdate reflects the scan
      const { containers: apiContainers, stacks: apiStacks } = await fetchContainersGraphql();
      if (stale()) return;
      const updatedContainers = updateContainersWithPreservedState(
        apiContainers,
        successfullyUpdatedContainersRef
      );
      setContainers(updatedContainers);
      setStacks(apiStacks);

      setDockerHubDataPulled(true);
      localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
      const pullTime = new Date();
      setLastPullTime(pullTime);
      localStorage.setItem("lastPullTime", pullTime.toISOString());

      setError(null);
      setDataFetched(true);

      // Fetch unused images
      await fetchUnusedImages();
      if (stale()) return;
    } catch (err) {
      if (stale()) return;
      await handleDockerHubError(err, (msg) => {
        if (!stale()) setError(msg);
      });
      console.error("Error in batch pull:", err);
    } finally {
      if (!stale()) setPulling(false);
    }
  }, [
    setPulling,
    setError,
    setContainers,
    setStacks,
    setDockerHubDataPulled,
    setDataFetched,
    setLastPullTime,
    fetchUnusedImages,
    successfullyUpdatedContainersRef,
  ]);

  const handleBatchTrackedAppsCheck = useCallback(async () => {
    let runId = null;
    const logs = [];

    // Session generation guard: after a login/logout the follow-up refresh
    // and the terminal batch-run bookkeeping mutations belong to a dead
    // session and must not fire through the replacement session's client.
    const gen = getSessionGeneration();
    const stale = () => isSessionStale(gen);

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
      if (stale()) return;
      if (runResult.error || !runResult.data?.createBatchRun?.id) {
        throw new Error(runResult.error?.message || "Failed to create batch run");
      }
      runId = runResult.data.createBatchRun.id;
      log(`Batch run ${runId} created`);

      log("🔄 Checking for tracked app updates...");
      log("Initiating tracked apps update check...");
      const result = await graphqlClient.mutation(CHECK_TRACKED_APP_UPDATES_MUTATION).toPromise();
      if (stale()) return;

      if (!result.error && result.data?.checkTrackedAppUpdates?.success) {
        log("Tracked apps check completed successfully");

        const updatedResponse = await graphqlClient.query(TRACKED_APPS_QUERY).toPromise();
        if (stale()) return;
        if (updatedResponse.error || !updatedResponse.data?.trackedApps) {
          throw new Error("Failed to fetch updated tracked images");
        }
        const updatedImages = updatedResponse.data.trackedApps;
        const appsChecked = updatedImages.length;
        const appsWithUpdates = updatedImages.filter((img) => Boolean(img.hasUpdate)).length;
        log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

        await fetchTrackedApps();
        if (stale()) return;

        if (runId) {
          const upd = await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "COMPLETED",
              containersChecked: appsChecked,
              containersUpdated: appsWithUpdates,
              logs: logs.join("\n"),
            })
            .toPromise();
          if (stale()) return;
          // A run whose status never landed is not a clean finish.
          const bookkeepingFailed = upd.error?.message
            ? upd.error.message
            : upd.data?.updateBatchRun?.success === false
              ? upd.data.updateBatchRun.message || "server rejected the update"
              : "";
          if (bookkeepingFailed) {
            log(`Could not record the batch run result: ${bookkeepingFailed}`);
            console.error("Error updating batch run:", bookkeepingFailed);
          } else {
            log(`Batch run ${runId} marked as completed`);
          }
        }
      } else {
        throw new Error(result.error?.message || "Failed to check tracked apps");
      }
    } catch (err) {
      if (stale()) return;
      let errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to check tracked apps";
      log(`❌ Error: ${errorMessage}`);
      console.error("Error checking tracked apps:", err);

      if (runId) {
        try {
          const upd = await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "FAILED",
              errorMessage,
              logs: logs.join("\n"),
            })
            .toPromise();
          if (stale()) return;
          const bookkeepingFailed = upd.error?.message
            ? upd.error.message
            : upd.data?.updateBatchRun?.success === false
              ? upd.data.updateBatchRun.message || "server rejected the update"
              : "";
          if (bookkeepingFailed) {
            log(`Could not record the batch run failure: ${bookkeepingFailed}`);
            console.error("Error updating batch run:", bookkeepingFailed);
          } else {
            log(`Batch run ${runId} marked as failed`);
          }
        } catch (updateErr) {
          if (stale()) return;
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      if (!stale()) log("Tracked apps batch check process finished (success or failure)");
    }
  }, [fetchTrackedApps]);

  return {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  };
};
