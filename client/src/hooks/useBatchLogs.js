import { useContext, useMemo } from "react";
import { BatchConfigContext } from "../contexts/BatchConfigContext";
import { BATCH_JOB_TYPES } from "../constants/batch";
import { useBatchRuns } from "./useBatchRuns";
import { useScheduledRuns } from "./useScheduledRuns";
import { useBatchTriggers } from "./useBatchTriggers";

/**
 * Custom hook for managing batch logs
 * Composes smaller hooks for better modularity and maintainability
 */
export function useBatchLogs(onTriggerBatch, onTriggerTrackedAppsBatch) {
  const contextValue = useContext(BatchConfigContext);
  const batchConfigs = contextValue?.batchConfig || {};

  // Use composed hooks
  const batchRuns = useBatchRuns();
  const scheduledRuns = useScheduledRuns(batchConfigs, batchRuns.recentRuns);
  const triggers = useBatchTriggers(
    onTriggerBatch,
    onTriggerTrackedAppsBatch,
    batchRuns.refetch
  );

  // Check if any job type is enabled
  const hasEnabledJobs = useMemo(
    () =>
      batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled ||
      batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled,
    [batchConfigs]
  );

  return {
    ...batchRuns,
    ...scheduledRuns,
    ...triggers,
    hasEnabledJobs,
    batchConfigs,
  };
}

