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
  // Use extracted hooks
  const { handleBatchPull, handleBatchTrackedAppsCheck } = useBatchTriggers({
    containersData,
    successfullyUpdatedContainersRef,
    setPulling,
    setError,
    setLastPullTime,
    fetchDockerHubCredentials,
    dockerHubCredentials,
    fetchTrackedImages,
  });

  useBatchPolling({
    isAuthenticated,
    authToken,
    passwordChanged,
    batchConfig,
    setLastPullTime,
  });

  const { batchIntervalRef, batchInitialTimeoutRef, hasRunInitialPullRef } = useBatchIntervals({
    batchEnabled: batchConfig.enabled,
    isAuthenticated,
    authToken,
    passwordChanged,
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
