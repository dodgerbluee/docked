import { useState, useCallback, useEffect, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import { TRIGGER_BATCH_JOB_MUTATION } from "../graphql/queries";
import { REFETCH_DELAY_MS } from "../constants/numbers";
import { getErrorMessage } from "../utils/errorMessages";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

/**
 * Custom hook for handling batch job triggers
 * Separated from useBatchLogs for better modularity
 */
export function useBatchTriggers(onTriggerBatch, onTriggerTrackedAppsBatch, refetch) {
  const [triggeringBatch, setTriggeringBatch] = useState(false);
  const [triggeringTrackedAppsBatch, setTriggeringTrackedAppsBatch] = useState(false);
  const [triggeringAppVersionScanBatch, setTriggeringAppVersionScanBatch] = useState(false);

  // The post-trigger refetch timers outlive the call that scheduled them:
  // capture the session generation and check it when the timer fires, and
  // clear pending timers on unmount, so a dead session's refetch never runs
  // (or keeps running) inside the replacement session.
  const refetchTimersRef = useRef(new Set());
  useEffect(() => {
    const timers = refetchTimersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const scheduleRefetch = useCallback(() => {
    const gen = getSessionGeneration();
    const id = setTimeout(() => {
      refetchTimersRef.current.delete(id);
      if (isSessionStale(gen)) return;
      if (refetch) {
        refetch();
      }
    }, REFETCH_DELAY_MS);
    refetchTimersRef.current.add(id);
  }, [refetch]);

  // Handle batch trigger
  const handleTriggerBatch = useCallback(async () => {
    if (!onTriggerBatch) return;
    setTriggeringBatch(true);
    try {
      await onTriggerBatch();
      // Refetch after a short delay to allow server to process
      scheduleRefetch();
    } catch (err) {
      console.error("Error triggering batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      // Could add error state here if needed
      throw new Error(errorMessage, { cause: err });
    } finally {
      setTriggeringBatch(false);
    }
  }, [onTriggerBatch, scheduleRefetch]);

  // Handle tracked apps batch trigger
  const handleTriggerTrackedAppsBatch = useCallback(async () => {
    if (!onTriggerTrackedAppsBatch) return;
    setTriggeringTrackedAppsBatch(true);
    try {
      await onTriggerTrackedAppsBatch();
      // Refetch after a short delay to allow server to process
      scheduleRefetch();
    } catch (err) {
      console.error("Error triggering tracked apps batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      // Could add error state here if needed
      throw new Error(errorMessage, { cause: err });
    } finally {
      setTriggeringTrackedAppsBatch(false);
    }
  }, [onTriggerTrackedAppsBatch, scheduleRefetch]);

  // Handle app version scan batch trigger (GraphQL)
  const handleTriggerAppVersionScanBatch = useCallback(async () => {
    setTriggeringAppVersionScanBatch(true);
    try {
      const result = await graphqlClient
        .mutation(TRIGGER_BATCH_JOB_MUTATION, { jobType: "APP_VERSION_SCAN" })
        .toPromise();
      if (result.error) throw new Error(result.error.message);
      scheduleRefetch();
    } catch (err) {
      console.error("Error triggering app version scan batch:", err);
      const errorMessage = getErrorMessage("BATCH", "TRIGGER");
      throw new Error(errorMessage, { cause: err });
    } finally {
      setTriggeringAppVersionScanBatch(false);
    }
  }, [scheduleRefetch]);

  return {
    triggeringBatch,
    triggeringTrackedAppsBatch,
    triggeringAppVersionScanBatch,
    handleTriggerBatch,
    handleTriggerTrackedAppsBatch,
    handleTriggerAppVersionScanBatch,
  };
}
