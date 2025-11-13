import React from "react";
import PropTypes from "prop-types";
import StatCard from "../components/StatCard";
import PortainerInstanceCard from "../components/PortainerInstanceCard";
import { useSummaryStats } from "../hooks/useSummaryStats";
import styles from "./SummaryPage.module.css";

/**
 * Summary page component displaying Portainer and Tracked Apps statistics
 * @param {Object} props - Component props
 * @param {Array} props.portainerInstances - Array of Portainer instances
 * @param {Array} props.containers - Array of all containers
 * @param {Array} props.unusedImages - Array of unused images
 * @param {number} props.unusedImagesCount - Total count of unused images
 * @param {Array} props.trackedImages - Array of tracked images
 * @param {Map} props.dismissedTrackedAppNotifications - Map of dismissed tracked app notifications
 * @param {Function} props.onNavigateToPortainer - Handler for navigating to Portainer tab
 * @param {Function} props.onNavigateToTrackedApps - Handler for navigating to Tracked Apps tab
 * @param {Function} props.onSetSelectedPortainerInstances - Handler for setting selected Portainer instances
 * @param {Function} props.onSetContentTab - Handler for setting content tab
 */
const SummaryPage = ({
  portainerInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  trackedImages = [],
  dismissedTrackedAppNotifications = new Map(),
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onSetSelectedPortainerInstances,
  onSetContentTab,
}) => {
  const summaryStats = useSummaryStats({
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    trackedImages,
    dismissedTrackedAppNotifications,
  });

  const handlePortainerStatClick = (contentTab) => {
    if (onNavigateToPortainer) {
      onNavigateToPortainer();
    }
    if (onSetSelectedPortainerInstances) {
      onSetSelectedPortainerInstances(new Set());
    }
    if (onSetContentTab) {
      onSetContentTab(contentTab);
    }
  };

  const handleInstanceClick = (instanceName) => {
    if (onNavigateToPortainer) {
      onNavigateToPortainer();
    }
    if (onSetSelectedPortainerInstances) {
      onSetSelectedPortainerInstances(new Set([instanceName]));
    }
    if (onSetContentTab) {
      onSetContentTab("updates");
    }
  };

  const handleInstanceStatClick = (instanceName, contentTab) => {
    if (onNavigateToPortainer) {
      onNavigateToPortainer();
    }
    if (onSetSelectedPortainerInstances) {
      onSetSelectedPortainerInstances(new Set([instanceName]));
    }
    if (onSetContentTab) {
      onSetContentTab(contentTab);
    }
  };

  const getContentTab = (statType) => {
    switch (statType) {
      case "updates":
        return "updates";
      case "current":
        return "current";
      case "unused":
        return "unused";
      default:
        return "updates";
    }
  };

  return (
    <div className={styles.summaryPage}>
      <div className={styles.summaryHeader}>
        <h2>Summary</h2>
      </div>

      <h3 className={styles.sectionTitle}>Portainer Summary</h3>
      <div className={styles.summaryStats}>
        <StatCard
          value={summaryStats.totalPortainers}
          label="Portainer Instances"
        />
        <StatCard value={summaryStats.totalContainers} label="Total Containers" />
        <StatCard
          value={summaryStats.containersWithUpdates}
          label="Updates Available"
          variant="update-available"
          clickable
          onClick={() => handlePortainerStatClick("updates")}
        />
        <StatCard
          value={summaryStats.containersUpToDate}
          label="Up to Date"
          variant="current"
          clickable
          onClick={() => handlePortainerStatClick("current")}
        />
        <StatCard
          value={summaryStats.unusedImages}
          label="Unused Images"
          variant="unused-images"
          clickable
          onClick={() => handlePortainerStatClick("unused")}
        />
      </div>

      <div className={styles.portainerInstancesList}>
        <h3>Portainer Instances</h3>
        <div className={styles.instancesGrid}>
          {summaryStats.portainerStats.map((stat) => (
            <PortainerInstanceCard
              key={stat.name}
              instance={stat}
              onInstanceClick={handleInstanceClick}
              onStatClick={handleInstanceStatClick}
              getContentTab={getContentTab}
            />
          ))}
        </div>
      </div>

      <div className={styles.trackedAppsSummary}>
        <h3 className={styles.sectionTitle}>Tracked Apps Summary</h3>
        <div className={styles.summaryStats}>
          <StatCard
            value={summaryStats.totalTrackedApps}
            label="Tracked Apps"
            clickable
            onClick={onNavigateToTrackedApps}
          />
          <StatCard
            value={summaryStats.trackedAppsUpToDate}
            label="Up to Date"
            variant="current"
            clickable
            onClick={onNavigateToTrackedApps}
          />
          <StatCard
            value={summaryStats.trackedAppsBehind}
            label="Updates Available"
            variant="update-available"
            clickable
            onClick={onNavigateToTrackedApps}
          />
          <StatCard
            value={summaryStats.trackedAppsUnknown}
            label="Unknown"
            variant="unused-images"
            clickable
            onClick={onNavigateToTrackedApps}
          />
        </div>
      </div>
    </div>
  );
};

SummaryPage.propTypes = {
  portainerInstances: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      url: PropTypes.string,
      containers: PropTypes.array,
      withUpdates: PropTypes.array,
      upToDate: PropTypes.array,
    })
  ),
  containers: PropTypes.arrayOf(PropTypes.object),
  unusedImages: PropTypes.arrayOf(PropTypes.object),
  unusedImagesCount: PropTypes.number,
  trackedImages: PropTypes.arrayOf(PropTypes.object),
  dismissedTrackedAppNotifications: PropTypes.instanceOf(Map),
  onNavigateToPortainer: PropTypes.func,
  onNavigateToTrackedApps: PropTypes.func,
  onSetSelectedPortainerInstances: PropTypes.func,
  onSetContentTab: PropTypes.func,
};

export default SummaryPage;

