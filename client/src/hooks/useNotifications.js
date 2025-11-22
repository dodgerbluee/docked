import { useState, useEffect, useCallback, useMemo } from "react";
import { calculateTrackedAppsStats } from "../utils/trackedAppsStats";

/**
 * Custom hook for managing notification state and logic
 * Handles dismissed notifications for containers and tracked apps
 */
export const useNotifications = (containers, trackedApps, instanceAdmin = false) => {
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

  const [dismissedVersionUpdateNotification, setDismissedVersionUpdateNotification] = useState(
    () => {
      try {
        const stored = localStorage.getItem("dismissedVersionUpdateNotification");
        return stored || null;
      } catch (err) {
        console.error("Error loading dismissed version update notification:", err);
      }
      return null;
    }
  );

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

  useEffect(() => {
    try {
      if (dismissedVersionUpdateNotification) {
        localStorage.setItem(
          "dismissedVersionUpdateNotification",
          dismissedVersionUpdateNotification
        );
      } else {
        localStorage.removeItem("dismissedVersionUpdateNotification");
      }
    } catch (err) {
      console.error("Error saving dismissed version update notification:", err);
    }
  }, [dismissedVersionUpdateNotification]);

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

  // Check for version update
  const versionUpdateInfo = useMemo(() => {
    try {
      const stored = localStorage.getItem("versionUpdateInfo");
      if (stored) {
        const info = JSON.parse(stored);
        // Only show if not dismissed or if the version has changed
        if (
          info.hasUpdate &&
          info.latestVersion &&
          dismissedVersionUpdateNotification !== info.latestVersion
        ) {
          return info;
        }
      }
    } catch (err) {
      console.error("Error loading version update info:", err);
    }
    return null;
  }, [dismissedVersionUpdateNotification]);

  // Calculate notification count (include version update only for instance admins)
  const notificationCount = useMemo(
    () =>
      activeContainersWithUpdates.length +
      activeTrackedAppsBehind.length +
      (versionUpdateInfo && instanceAdmin ? 1 : 0),
    [
      activeContainersWithUpdates.length,
      activeTrackedAppsBehind.length,
      versionUpdateInfo,
      instanceAdmin,
    ]
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

  const handleDismissVersionUpdateNotification = useCallback((latestVersion) => {
    setDismissedVersionUpdateNotification(latestVersion);
  }, []);

  return {
    dismissedContainerNotifications,
    dismissedTrackedAppNotifications,
    containersWithUpdates,
    activeContainersWithUpdates,
    activeTrackedAppsBehind,
    versionUpdateInfo,
    notificationCount,
    trackedAppsStats,
    handleDismissContainerNotification,
    handleDismissTrackedAppNotification,
    handleDismissVersionUpdateNotification,
  };
};
