import { useState, useEffect, useCallback, useMemo } from "react";
import { calculateTrackedAppsStats } from "../utils/trackedAppsStats";

/**
 * Custom hook for managing notification state and logic
 * Handles dismissed notifications for containers and tracked apps
 */
export const useNotifications = (containers, trackedApps) => {
  // Store dismissed notifications as Map: id -> dismissed version
  // Load from localStorage on mount
  const [dismissedContainerNotifications, setDismissedContainerNotifications] = useState(() => {
    try {
      const stored = localStorage.getItem("dismissedContainerNotifications");
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Map(Object.entries(parsed));
      }
    } catch (err) {
      console.error("Error loading dismissed container notifications:", err);
    }
    return new Map();
  });

  const [dismissedTrackedAppNotifications, setDismissedTrackedAppNotifications] = useState(() => {
    try {
      const stored = localStorage.getItem("dismissedTrackedAppNotifications");
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert keys to strings to ensure consistent lookup (IDs might be numbers)
        const map = new Map();
        Object.entries(parsed).forEach(([key, value]) => {
          map.set(String(key), value);
        });
        return map;
      }
    } catch (err) {
      console.error("Error loading dismissed tracked app notifications:", err);
    }
    return new Map();
  });

  // Persist dismissed notifications to localStorage whenever they change
  useEffect(() => {
    try {
      const containerData = Object.fromEntries(dismissedContainerNotifications);
      localStorage.setItem("dismissedContainerNotifications", JSON.stringify(containerData));
    } catch (err) {
      console.error("Error saving dismissed container notifications:", err);
    }
  }, [dismissedContainerNotifications]);

  useEffect(() => {
    try {
      // Convert Map to object, ensuring keys are strings for JSON serialization
      const trackedAppData = Object.fromEntries(dismissedTrackedAppNotifications);
      localStorage.setItem("dismissedTrackedAppNotifications", JSON.stringify(trackedAppData));
    } catch (err) {
      console.error("Error saving dismissed tracked app notifications:", err);
    }
  }, [dismissedTrackedAppNotifications]);

  // Filter containers with updates
  const containersWithUpdates = useMemo(() => containers.filter((c) => c.hasUpdate), [containers]);

  // Filter out dismissed notifications, but show again if version has changed
  const activeContainersWithUpdates = useMemo(
    () =>
      containersWithUpdates.filter((container) => {
        const dismissedVersion = dismissedContainerNotifications.get(container.id);
        if (!dismissedVersion) {
          // Not dismissed, show it
          return true;
        }
        // Check if the latest version has changed since dismissal
        const currentLatestVersion =
          container.latestVersion ||
          container.newVersion ||
          container.latestTag ||
          container.latestDigest;
        return currentLatestVersion !== dismissedVersion;
      }),
    [containersWithUpdates, dismissedContainerNotifications]
  );

  // Calculate tracked apps statistics
  const trackedAppsStats = useMemo(
    () => calculateTrackedAppsStats(trackedApps, dismissedTrackedAppNotifications),
    [trackedApps, dismissedTrackedAppNotifications]
  );

  const { activeTrackedAppsBehind } = trackedAppsStats;

  // Calculate notification count
  const notificationCount = useMemo(
    () => activeContainersWithUpdates.length + activeTrackedAppsBehind.length,
    [activeContainersWithUpdates.length, activeTrackedAppsBehind.length]
  );

  // Notification handlers
  const handleDismissContainerNotification = useCallback((containerId, latestVersion) => {
    setDismissedContainerNotifications((prev) => {
      const newMap = new Map(prev);
      newMap.set(containerId, latestVersion);
      return newMap;
    });
  }, []);

  const handleDismissTrackedAppNotification = useCallback((imageId, latestVersion) => {
    setDismissedTrackedAppNotifications((prev) => {
      const newMap = new Map(prev);
      // Convert ID to string to ensure consistent storage and lookup
      newMap.set(String(imageId), latestVersion);
      return newMap;
    });
  }, []);

  return {
    dismissedContainerNotifications,
    dismissedTrackedAppNotifications,
    containersWithUpdates,
    activeContainersWithUpdates,
    activeTrackedAppsBehind,
    notificationCount,
    trackedAppsStats,
    handleDismissContainerNotification,
    handleDismissTrackedAppNotification,
  };
};
