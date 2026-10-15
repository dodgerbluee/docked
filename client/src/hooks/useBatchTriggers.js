import { useState, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import { TRIGGER_BATCH_JOB_MUTATION } from "../graphql/queries";
import { REFETCH_DELAY_MS } from "../constants/numbers";
import { getErrorMessage } from "../utils/errorMessages";

/**
 * Custom hook for handling batch job triggers
 * Separated from useBatchLogs for better modularity
 */
export function useBatchTriggers(onTriggerBatch, onTriggerTrackedAppsBatch, refetch) {
  const [triggeringBatch, setTriggeringBatch] = useState(false);
  const [triggeringTrackedAppsBatch, setTriggeringTrackedAppsBatch] = useState(false);
  const [triggeringAppVersionScanBatch, setTriggeringAppVersionScanBatch] = useState(false);

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
      throw new Error(errorMessage, { cause: err });
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
      throw new Error(errorMessage, { cause: err });
    } finally {
      setTriggeringTrackedAppsBatch(false);
    }
  }, [onTriggerTrackedAppsBatch, refetch]);

  // Handle app version scan batch trigger (GraphQL)
  const handleTriggerAppVersionScanBatch = useCallback(async () => {
    setTriggeringAppVersionScanBatch(true);
    try {
      const result = await graphqlClient
        .mutation(TRIGGER_BATCH_JOB_MUTATION, { jobType: "APP_VERSION_SCAN" })
        .toPromise();
      if (result.error) throw new Error(result.error.message);
      setTimeout(() => {
        if (refetch) {
          refetch();
        }
      }, REFETCH_DELAY_MS);
    } catch (err) {
      console.error("Error triggering app version scan batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      throw new Error(errorMessage, { cause: err });
    } finally {
      setTriggeringAppVersionScanBatch(false);
    }
  }, [refetch]);

  return {
    triggeringBatch,
    triggeringTrackedAppsBatch,
    triggeringAppVersionScanBatch,
    handleTriggerBatch,
    handleTriggerTrackedAppsBatch,
    handleTriggerAppVersionScanBatch,
  };
}
