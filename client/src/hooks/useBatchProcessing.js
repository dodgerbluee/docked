import { useBatchPolling } from "./useBatchProcessing/hooks/useBatchPolling";
import { useBatchTriggers } from "./useBatchProcessing/hooks/useBatchTriggers";
import { useBatchIntervals } from "./useBatchProcessing/hooks/useBatchIntervals";

/**
 * Custom hook for managing batch processing operations
 * Handles Docker Hub pulls, tracked apps checks, and batch run polling
 */
export const useBatchProcessing = ({
  isAuthenticated,
  authToken,
  batchConfig,
  containersData,
  successfullyUpdatedContainersRef,
  setPulling,
  setError,
  setLastPullTime,
  fetchDockerHubCredentials,
  dockerHubCredentials,
  fetchTrackedApps,
  fetchContainers,
}) => {
  // Use extracted hooks
  const { handleBatchPull, handleBatchTrackedAppsCheck } = useBatchTriggers({
    containersData,
    successfullyUpdatedContainersRef,
    setPulling,
    setError,
    setLastPullTime,
    fetchDockerHubCredentials,
    dockerHubCredentials,
    fetchTrackedApps,
  });

  useBatchPolling({
    isAuthenticated,
    authToken,
    batchConfig,
    setLastPullTime,
    fetchContainers,
    fetchTrackedApps,
  });

  const { batchIntervalRef, batchInitialTimeoutRef, hasRunInitialPullRef } = useBatchIntervals({
    batchEnabled: batchConfig.enabled,
    isAuthenticated,
    authToken,
    intervalMinutes: batchConfig.intervalMinutes,
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  });

  return {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
  };
};
