/**
 * Utility functions for calculating Tracked Apps statistics
 */

/**
 * Check if an app has unknown latest version
 * @param {Object} img - Tracked image object
 * @returns {boolean} - True if latest version is unknown
 */
export function isUnknown(img) {
  return (
    !img.latest_version ||
    img.latest_version === "Unknown" ||
    (typeof img.latest_version === "string" && img.latest_version.trim() === "")
  );
}

/**
 * Calculate tracked apps statistics
 * @param {Array} trackedApps - Array of tracked images
 * @param {Map} dismissedNotifications - Map of dismissed notifications (id -> version)
 * @returns {Object} Statistics object
 */
export function calculateTrackedAppsStats(trackedApps, dismissedNotifications = new Map()) {
  const totalTrackedApps = trackedApps.length;

  // Count unknown apps first
  const trackedAppsUnknown = trackedApps.filter(isUnknown).length;

  // Up to date: apps that are not unknown, not behind, and have matching versions
  const trackedAppsUpToDate = trackedApps.filter((img) => {
    // Exclude unknown apps
    if (isUnknown(img)) return false;

    // Must not have updates and versions should match
    return (
      !img.has_update ||
      (img.current_version && img.latest_version && img.current_version === img.latest_version)
    );
  }).length;

  // Behind: apps that have updates (excluding unknown apps)
  const trackedAppsBehind = trackedApps.filter((img) => {
    // Exclude unknown apps
    if (isUnknown(img)) return false;

    return img.has_update;
  }).length;

  // Filter out dismissed notifications, but show again if version has changed
  const activeTrackedAppsBehind = trackedApps.filter((img) => {
    if (!img.has_update) return false;
    // Convert ID to string to match how it's stored in localStorage
    const dismissedVersion = dismissedNotifications.get(String(img.id));
    if (!dismissedVersion) {
      // Not dismissed, show it
      return true;
    }
    // Check if the latest version has changed since dismissal
    return img.latest_version !== dismissedVersion;
  });

  return {
    totalTrackedApps,
    trackedAppsUpToDate,
    trackedAppsBehind,
    trackedAppsUnknown,
    activeTrackedAppsBehind,
  };
}
