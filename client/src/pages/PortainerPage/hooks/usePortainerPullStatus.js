/**
 * Hook for managing Portainer pull status and checkmark
 */

import { useState, useEffect, useCallback } from "react";
import { TIMING } from "../../../constants/timing";

/**
 * Hook to manage pull status and checkmark display
 * @param {Object} options
 * @param {boolean} options.pullingDockerHub - Whether pulling from Docker Hub
 * @param {string|null} options.pullSuccess - Pull success message
 * @param {string|null} options.pullError - Pull error message
 * @param {Function} options.fetchContainers - Function to fetch containers
 * @returns {Object} Pull status state and handlers
 */
export const usePortainerPullStatus = ({
  pullingDockerHub,
  pullSuccess,
  pullError,
  fetchContainers,
}) => {
  const [localPullError, setLocalPullError] = useState("");
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [pullingPortainerOnly, setPullingPortainerOnly] = useState(false);

  // Show checkmark when pull completes successfully
  useEffect(() => {
    // Only show checkmark when we have success and we're not currently pulling
    if (pullSuccess && !pullingDockerHub) {
      setShowCheckmark(true);
      // Hide checkmark after configured time
      const timer = setTimeout(() => {
        setShowCheckmark(false);
      }, TIMING.CHECKMARK_DISPLAY_TIME);
      return () => clearTimeout(timer);
    } else {
      // Hide checkmark when pulling starts or when there's no success
      setShowCheckmark(false);
    }
  }, [pullSuccess, pullingDockerHub]);

  useEffect(() => {
    if (pullError) {
      setLocalPullError(pullError);
      setShowCheckmark(false);
    } else {
      // Clear local error when pullError is cleared
      setLocalPullError("");
    }
  }, [pullError]);

  // Handler for Portainer-only data update (no Docker Hub)
  const handlePullPortainerOnly = useCallback(async () => {
    try {
      setPullingPortainerOnly(true);
      setLocalPullError("");
      console.log("🔄 Pulling Portainer data only (no Docker Hub)...");

      // Use fetchContainers with portainerOnly=true to update all state properly
      await fetchContainers(false, null, true);
      console.log("✅ Portainer data updated successfully");
    } catch (err) {
      console.error("Error pulling Portainer data:", err);
      setLocalPullError(
        err.response?.data?.error || err.message || "Failed to pull Portainer data"
      );
    } finally {
      setPullingPortainerOnly(false);
    }
  }, [fetchContainers]);

  const handleDismissError = useCallback(() => {
    setLocalPullError("");
  }, []);

  return {
    localPullError,
    showCheckmark,
    pullingPortainerOnly,
    handlePullPortainerOnly,
    handleDismissError,
  };
};
