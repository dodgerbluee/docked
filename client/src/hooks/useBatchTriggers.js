import { useState, useCallback } from "react";
import { REFETCH_DELAY_MS } from "../constants/numbers";
import { getErrorMessage } from "../utils/errorMessages";

/**
 * Custom hook for handling batch job triggers
 * Separated from useBatchLogs for better modularity
 */
export function useBatchTriggers(onTriggerBatch, onTriggerTrackedAppsBatch, refetch) {
  const [triggeringBatch, setTriggeringBatch] = useState(false);
  const [triggeringTrackedAppsBatch, setTriggeringTrackedAppsBatch] = useState(false);

  // Handle batch trigger
  const handleTriggerBatch = useCallback(async () => {
    if (!onTriggerBatch) return;
    setTriggeringBatch(true);
    try {
      await onTriggerBatch();
      // Refetch after a short delay to allow server to process
      setTimeout(() => {
        if (refetch) {
          refetch();
        }
      }, REFETCH_DELAY_MS);
    } catch (err) {
      console.error("Error triggering batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      // Could add error state here if needed
      throw new Error(errorMessage);
    } finally {
      setTriggeringBatch(false);
    }
  }, [onTriggerBatch, refetch]);

  // Handle tracked apps batch trigger
  const handleTriggerTrackedAppsBatch = useCallback(async () => {
    if (!onTriggerTrackedAppsBatch) return;
    setTriggeringTrackedAppsBatch(true);
    try {
      await onTriggerTrackedAppsBatch();
      // Refetch after a short delay to allow server to process
      setTimeout(() => {
        if (refetch) {
          refetch();
        }
      }, REFETCH_DELAY_MS);
    } catch (err) {
      console.error("Error triggering tracked apps batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      // Could add error state here if needed
      throw new Error(errorMessage);
    } finally {
      setTriggeringTrackedAppsBatch(false);
    }
  }, [onTriggerTrackedAppsBatch, refetch]);

  return {
    triggeringBatch,
    triggeringTrackedAppsBatch,
    handleTriggerBatch,
    handleTriggerTrackedAppsBatch,
  };
}

