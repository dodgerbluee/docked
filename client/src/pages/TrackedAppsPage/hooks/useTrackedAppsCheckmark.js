/**
 * Hook for managing checkmark display on tracked apps page
 */

import { useState, useEffect } from "react";

/**
 * Hook to manage checkmark display when operations complete successfully
 * @param {Object} options
 * @param {string|null} options.trackedAppSuccess - Success message
 * @param {boolean} options.checkingUpdates - Whether checking for updates
 * @returns {boolean} Whether to show checkmark
 */
export const useTrackedAppsCheckmark = ({ trackedAppSuccess, checkingUpdates }) => {
  const [showCheckmark, setShowCheckmark] = useState(false);

  // Show checkmark when check completes successfully
  useEffect(() => {
    if (trackedAppSuccess && !checkingUpdates) {
      setShowCheckmark(true);
      // Hide checkmark after 3 seconds
      const timer = setTimeout(() => setShowCheckmark(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [trackedAppSuccess, checkingUpdates]);

  // Hide checkmark when checking starts
  useEffect(() => {
    if (checkingUpdates) {
      setShowCheckmark(false);
    }
  }, [checkingUpdates]);

  return showCheckmark;
};
