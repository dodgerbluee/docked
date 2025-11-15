import { useMemo } from "react";
import { calculateTrackedAppsStats } from "../utils/trackedAppsStats";

/**
 * Custom hook to calculate summary statistics for the Summary page
 * @param {Object} params - Parameters for calculating stats
 * @param {Array} params.portainerInstances - Array of Portainer instances
 * @param {Array} params.containers - Array of all containers
 * @param {Array} params.unusedImages - Array of unused images
 * @param {number} params.unusedImagesCount - Total count of unused images
 * @param {Array} params.trackedImages - Array of tracked images
 * @param {Map} params.dismissedTrackedAppNotifications - Map of dismissed tracked app notifications
 * @returns {Object} Summary statistics object
 */
export const useSummaryStats = ({
  portainerInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  trackedImages = [],
  dismissedTrackedAppNotifications = new Map(),
}) => {
  // Calculate containers with updates and up to date
  const containersWithUpdates = useMemo(() => containers.filter((c) => c.hasUpdate), [containers]);

  const containersUpToDate = useMemo(() => containers.filter((c) => !c.hasUpdate), [containers]);

  // Calculate unused images per Portainer instance (match by URL)
  const unusedImagesByPortainer = useMemo(() => {
    return unusedImages.reduce((acc, img) => {
      const portainerUrl = img.portainerUrl || "Unknown";
      acc[portainerUrl] = (acc[portainerUrl] || 0) + 1;
      return acc;
    }, {});
  }, [unusedImages]);

  // Calculate tracked apps statistics
  const trackedAppsStats = useMemo(
    () => calculateTrackedAppsStats(trackedImages, dismissedTrackedAppNotifications),
    [trackedImages, dismissedTrackedAppNotifications]
  );

  const { totalTrackedApps, trackedAppsUpToDate, trackedAppsBehind, trackedAppsUnknown } =
    trackedAppsStats;

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    return {
      totalPortainers: portainerInstances.length,
      totalContainers: containers.length,
      containersWithUpdates: containersWithUpdates.length,
      containersUpToDate: containersUpToDate.length,
      unusedImages: unusedImagesCount,
      totalTrackedApps,
      trackedAppsUpToDate,
      trackedAppsBehind,
      trackedAppsUnknown,
      portainerStats: portainerInstances
        .filter((p) => p != null) // Filter out any null/undefined entries
        .map((p) => ({
          name: p.name || "Unknown",
          url: p.url || "",
          total: (p.containers || []).length,
          withUpdates: (p.withUpdates || []).length,
          upToDate: (p.upToDate || []).length,
          unusedImages: unusedImagesByPortainer[p.url] || 0, // Match by URL instead of name
        })),
    };
  }, [
    portainerInstances,
    containers.length,
    containersWithUpdates.length,
    containersUpToDate.length,
    unusedImagesCount,
    totalTrackedApps,
    trackedAppsUpToDate,
    trackedAppsBehind,
    trackedAppsUnknown,
    unusedImagesByPortainer,
  ]);

  return summaryStats;
};
