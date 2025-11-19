/**
 * Hook for batch trigger operations
 */

import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";
import { handleDockerHubError } from "../../../utils/apiErrorHandler";

/**
 * Hook for batch trigger operations
 * @param {Object} params - Parameters
 * @param {Object} params.containersData - Containers data object
 * @param {Object} params.successfullyUpdatedContainersRef - Ref for successfully updated containers
 * @param {Function} params.setPulling - Set pulling state function
 * @param {Function} params.setError - Set error function
 * @param {Function} params.setLastPullTime - Set last pull time function
 * @param {Function} params.fetchDockerHubCredentials - Fetch Docker Hub credentials function
 * @param {Object} params.dockerHubCredentials - Docker Hub credentials
 * @param {Function} params.fetchTrackedImages - Fetch tracked images function
 * @returns {Object} Batch trigger handlers
 */
export const useBatchTriggers = ({
  containersData,
  successfullyUpdatedContainersRef,
  setPulling,
  setError,
  setLastPullTime,
  fetchDockerHubCredentials,
  dockerHubCredentials,
  fetchTrackedImages,
}) => {
  const {
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    fetchUnusedImages,
  } = containersData;

  const handleBatchPull = useCallback(async () => {
    let runId = null;
    const logs = [];

    const log = (message) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      logs.push(logEntry);
      console.log(logEntry);
    };

    try {
      // Create batch run record
      log("Starting batch pull process...");
      const runResponse = await axios.post(`${API_BASE_URL}/api/batch/runs`, {
        status: "running",
        jobType: "docker-hub-pull",
      });
      runId = runResponse.data.runId;
      log(`Batch run ${runId} created`);

      setPulling(true);
      setError(null);
      log("🔄 Pulling fresh data from Docker Hub...");

      // Start the pull operation
      log("Initiating Docker Hub API call...");
      const pullPromise = axios.post(
        `${API_BASE_URL}/api/containers/pull`,
        {},
        {
          timeout: 300000, // 5 minute timeout
        }
      );

      // While pulling, fetch any existing cached data to show immediately
      log("Fetching cached data for immediate display...");
      try {
        const cachedResponse = await axios.get(`${API_BASE_URL}/api/containers`);
        if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
          const apiContainers = cachedResponse.data.containers || [];
          const updatedContainers = apiContainers.map((apiContainer) => {
            if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
              if (!apiContainer.hasUpdate) {
                successfullyUpdatedContainersRef.current.delete(apiContainer.id);
              }
              return { ...apiContainer, hasUpdate: false };
            }
            return apiContainer;
          });
          setContainers(updatedContainers);
          setStacks(cachedResponse.data.stacks || []);
          setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

          if (cachedResponse.data.portainerInstances) {
            setPortainerInstancesFromAPI(cachedResponse.data.portainerInstances);
          }
          setDataFetched(true);
          log("Cached data loaded successfully");
        }
      } catch (cacheErr) {
        log("No cached data available yet");
      }

      // Wait for the pull to complete
      log("Waiting for Docker Hub pull to complete...");
      const response = await pullPromise;
      log("Docker Hub pull completed successfully");

      if (response.data.success === false) {
        throw new Error(
          response.data.error || response.data.message || "Failed to pull container data"
        );
      }

      let containersChecked = 0;
      let containersUpdated = 0;

      if (response.data.grouped && response.data.stacks) {
        const apiContainers = response.data.containers || [];
        const updatedContainers = apiContainers.map((apiContainer) => {
          if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
            if (!apiContainer.hasUpdate) {
              successfullyUpdatedContainersRef.current.delete(apiContainer.id);
            }
            return { ...apiContainer, hasUpdate: false };
          }
          return apiContainer;
        });
        setContainers(updatedContainers);
        setStacks(response.data.stacks || []);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);

        if (response.data.portainerInstances) {
          setPortainerInstancesFromAPI(response.data.portainerInstances);
        }

        containersChecked = updatedContainers.length || 0;
        containersUpdated = response.data.containers?.filter((c) => c.hasUpdate).length || 0;
        log(
          `Processed ${containersChecked} containers, ${containersUpdated} with updates available`
        );

        setDockerHubDataPulled(true);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
        const pullTime = new Date();
        setLastPullTime(pullTime);
        localStorage.setItem("lastPullTime", pullTime.toISOString());
      } else {
        const apiContainers = Array.isArray(response.data) ? response.data : [];
        const updatedContainers = apiContainers.map((apiContainer) => {
          if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
            if (!apiContainer.hasUpdate) {
              successfullyUpdatedContainersRef.current.delete(apiContainer.id);
            }
            return { ...apiContainer, hasUpdate: false };
          }
          return apiContainer;
        });
        setContainers(updatedContainers);
        setStacks([]);
        setUnusedImagesCount(0);
        containersChecked = updatedContainers.length || 0;
        log(`Processed ${containersChecked} containers (legacy format)`);
      }

      setError(null);
      setDataFetched(true);

      log("Fetching unused images...");
      await fetchUnusedImages();
      log("Unused images fetched");

      // Update batch run as completed
      if (runId) {
        await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
          status: "completed",
          containersChecked,
          containersUpdated,
          logs: logs.join("\n"),
        });
        log(`Batch run ${runId} marked as completed`);
      }
    } catch (err) {
      const errorMessage = await handleDockerHubError(
        err,
        fetchDockerHubCredentials,
        dockerHubCredentials,
        (msg) => {
          log(
            `❌ ${err.response?.status === 429 || err.response?.data?.rateLimitExceeded ? "Rate limit exceeded" : "Error"}: ${msg}`
          );
          setError(msg);
        }
      );
      console.error("Error pulling containers:", err);

      if (runId) {
        try {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "failed",
            errorMessage,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      setPulling(false);
      log("Batch pull process finished (success or failure)");
    }
  }, [
    setPulling,
    setError,
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    setLastPullTime,
    fetchUnusedImages,
    successfullyUpdatedContainersRef,
    fetchDockerHubCredentials,
    dockerHubCredentials,
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
      const runResponse = await axios.post(`${API_BASE_URL}/api/batch/runs`, {
        status: "running",
        jobType: "tracked-apps-check",
      });
      runId = runResponse.data.runId;
      log(`Batch run ${runId} created`);

      log("🔄 Checking for tracked app updates...");
      log("Initiating tracked apps update check...");
      const response = await axios.post(
        `${API_BASE_URL}/api/tracked-images/check-updates`,
        {},
        {
          timeout: 300000,
        }
      );

      if (response.data.success) {
        log("Tracked apps check completed successfully");

        await new Promise((resolve) => setTimeout(resolve, 500));

        const updatedResponse = await axios.get(`${API_BASE_URL}/api/tracked-images`);
        if (!updatedResponse.data.success) {
          throw new Error("Failed to fetch updated tracked images");
        }
        const updatedImages = updatedResponse.data.images || [];
        const appsChecked = updatedImages.length;
        const appsWithUpdates = updatedImages.filter((img) => Boolean(img.has_update)).length;
        log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

        await fetchTrackedImages();

        if (runId) {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "completed",
            containersChecked: appsChecked,
            containersUpdated: appsWithUpdates,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as completed`);
        }
      } else {
        throw new Error(response.data.error || "Failed to check tracked apps");
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
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "failed",
            errorMessage,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      log("Tracked apps batch check process finished (success or failure)");
    }
  }, [fetchTrackedImages]);

  return {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  };
};

