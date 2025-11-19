/**
 * Hook for batch processing intervals
 */

import { useEffect, useRef } from "react";

/**
 * Hook for batch processing intervals
 * @param {Object} params - Parameters
 * @param {boolean} params.batchEnabled - Whether batch is enabled
 * @param {boolean} params.isAuthenticated - Whether user is authenticated
 * @param {string} params.authToken - Auth token
 * @param {boolean} params.passwordChanged - Whether password has been changed
 * @param {number} params.intervalMinutes - Interval in minutes
 * @param {Function} params.handleBatchPull - Batch pull handler
 * @param {Function} params.handleBatchTrackedAppsCheck - Batch tracked apps check handler
 * @returns {Object} Interval refs
 */
export const useBatchIntervals = ({
  batchEnabled,
  isAuthenticated,
  authToken,
  passwordChanged,
  intervalMinutes,
  handleBatchPull,
  handleBatchTrackedAppsCheck,
}) => {
  const batchIntervalRef = useRef(null);
  const batchInitialTimeoutRef = useRef(null);
  const hasRunInitialPullRef = useRef(false);

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
      batchEnabled &&
      isAuthenticated &&
      authToken &&
      passwordChanged &&
      intervalMinutes > 0
    ) {
      const intervalMs = intervalMinutes * 60 * 1000;
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
    batchEnabled,
    intervalMinutes,
    isAuthenticated,
    authToken,
    passwordChanged,
    handleBatchPull,
    handleBatchTrackedAppsCheck,
  ]);

  return {
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
  };
};

