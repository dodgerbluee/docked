import { useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { parseUTCTimestamp } from "../utils/formatters";
import { API_BASE_URL } from "../constants/api";
import { handleDockerHubError } from "../utils/apiErrorHandler";

/**
 * Custom hook for managing batch processing operations
 * Handles Docker Hub pulls, tracked apps checks, and batch run polling
 */
export const useBatchProcessing = ({
  isAuthenticated,
  authToken,
  passwordChanged,
  batchConfig,
  containersData,
  successfullyUpdatedContainersRef,
  setPulling,
  setError,
  setLastPullTime,
  fetchDockerHubCredentials,
  dockerHubCredentials,
  fetchTrackedImages,
}) => {
  const batchIntervalRef = useRef(null);
  const lastCheckedBatchRunIdRef = useRef(null);
  const lastCheckedBatchRunStatusRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunIdRef = useRef(null);
  const lastCheckedTrackedAppsBatchRunStatusRef = useRef(null);
  const batchInitialTimeoutRef = useRef(null);
  const hasRunInitialPullRef = useRef(false);

  const {
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    fetchContainers,
    fetchUnusedImages,
  } = containersData;

  // Handle batch pull with logging
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
          response.data.error ||
            response.data.message ||
            "Failed to pull container data"
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
        containersUpdated =
          response.data.containers?.filter((c) => c.hasUpdate).length || 0;
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
          log(`❌ ${err.response?.status === 429 || err.response?.data?.rateLimitExceeded ? "Rate limit exceeded" : "Error"}: ${msg}`);
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

  // Batch handler for tracked apps updates check
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
        log(
          `Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`
        );

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

  // Poll for server-side batch run completions
  useEffect(() => {
    if (!isAuthenticated || !authToken || !passwordChanged) {
      return;
    }

    const checkBatchRuns = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/batch/runs/latest?byJobType=true`
        );
        if (response.data.success && response.data.runs) {
          // Check Docker Hub pull batch run
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
                isNewRun ||
                justCompleted ||
                (previousId === null && previousStatus === null);

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

          // Check tracked apps check batch run
          const trackedAppsRun = response.data.runs["tracked-apps-check"];
          if (trackedAppsRun) {
            const previousStatus = lastCheckedTrackedAppsBatchRunStatusRef.current;
            const previousId = lastCheckedTrackedAppsBatchRunIdRef.current;

            if (trackedAppsRun.status === "completed" && trackedAppsRun.completed_at) {
              const completedAt = parseUTCTimestamp(trackedAppsRun.completed_at);

              const isNewRun = trackedAppsRun.id !== previousId;
              const justCompleted =
                trackedAppsRun.id === previousId &&
                previousStatus !== "completed" &&
                previousStatus !== null;

              const shouldUpdate =
                isNewRun ||
                justCompleted ||
                (previousId === null && previousStatus === null);

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
      } catch (err) {
        console.error("Error checking batch runs:", err);
      }
    };

    checkBatchRuns();
    const interval = setInterval(checkBatchRuns, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, authToken, passwordChanged, setLastPullTime]);

  // Set up batch processing interval
  useEffect(() => {
    // Clear any existing interval and timeout first
    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (batchInitialTimeoutRef.current) {
      clearTimeout(batchInitialTimeoutRef.current);
      batchInitialTimeoutRef.current = null;
    }

    // Only set up interval if batch is enabled
    if (
      batchConfig.enabled &&
      isAuthenticated &&
      authToken &&
      passwordChanged &&
      batchConfig.intervalMinutes > 0
    ) {
      const intervalMs = batchConfig.intervalMinutes * 60 * 1000;
      const currentIntervalMinutes = batchConfig.intervalMinutes;
      const intervalId = setInterval(() => {
        if (batchIntervalRef.current === intervalId) {
          handleBatchPull().catch((err) => {
            console.error("❌ Error in batch pull (interval will continue):", err);
          });
          handleBatchTrackedAppsCheck().catch((err) => {
            console.error("❌ Error in tracked apps batch check (interval will continue):", err);
          });
        } else {
          clearInterval(intervalId);
        }
      }, intervalMs);

      batchIntervalRef.current = intervalId;

      // Only trigger initial pull if we haven't run it recently
      const lastInitialPull = localStorage.getItem("lastBatchInitialPull");
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const lastPullTimestamp = lastInitialPull ? parseInt(lastInitialPull) : 0;
      const shouldRunInitial = !lastInitialPull || lastPullTimestamp < oneHourAgo;

      if (!hasRunInitialPullRef.current && shouldRunInitial) {
        hasRunInitialPullRef.current = true;
        localStorage.setItem("lastBatchInitialPull", now.toString());

        const timeoutId = setTimeout(() => {
          handleBatchPull().catch((err) => {
            console.error("Error in initial batch pull:", err);
          });
          handleBatchTrackedAppsCheck().catch((err) => {
            console.error("Error in initial tracked apps check:", err);
          });
          batchInitialTimeoutRef.current = null;
        }, 5000);

        batchInitialTimeoutRef.current = timeoutId;
      }

      return () => {
        if (batchIntervalRef.current) {
          clearInterval(batchIntervalRef.current);
          batchIntervalRef.current = null;
        }
        if (batchInitialTimeoutRef.current) {
          clearTimeout(batchInitialTimeoutRef.current);
          batchInitialTimeoutRef.current = null;
        }
      };
    } else if (batchIntervalRef.current || batchInitialTimeoutRef.current) {
      if (batchIntervalRef.current) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
      if (batchInitialTimeoutRef.current) {
        clearTimeout(batchInitialTimeoutRef.current);
        batchInitialTimeoutRef.current = null;
      }
    }
  }, [
    batchConfig.enabled,
    batchConfig.intervalMinutes,
    isAuthenticated,
    authToken,
    passwordChanged,
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  ]);

  return {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
  };
};

