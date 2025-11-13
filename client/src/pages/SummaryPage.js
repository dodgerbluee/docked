import React from "react";
import PropTypes from "prop-types";
import StatCard from "../components/StatCard";
import PortainerInstanceCard from "../components/PortainerInstanceCard";
import { useSummaryStats } from "../hooks/useSummaryStats";
import { useNavigationHandlers } from "../hooks/useNavigationHandlers";
import {
  CONTENT_TABS,
  STAT_CARD_VARIANTS,
} from "../constants/summaryPage";
import {
  containerShape,
  portainerInstanceShape,
  unusedImageShape,
  trackedImageShape,
} from "../utils/propTypes";
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
 * @param {boolean} props.isLoading - Whether data is currently loading
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
  isLoading = false,
}) => {
  const summaryStats = useSummaryStats({
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    trackedImages,
    dismissedTrackedAppNotifications,
  });

  const {
    handlePortainerStatClick,
    handleInstanceClick,
    handleInstanceStatClick,
    handleTrackedAppsClick,
  } = useNavigationHandlers({
    onNavigateToPortainer,
    onNavigateToTrackedApps,
    onSetSelectedPortainerInstances,
    onSetContentTab,
  });

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.summaryPage}>
        <div className={styles.summaryHeader}>
          <div className={styles.headerContent}>
            <h2 className={styles.summaryHeaderTitle}>Summary</h2>
          </div>
        </div>
        <div className={styles.contentTabPanel}>
          <div className={styles.loadingState}>
            <p>Loading summary statistics...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.summaryPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.summaryHeaderTitle}>Summary</h2>
        </div>
      </div>

      <div className={styles.contentTabPanel}>
        <h3 className={styles.sectionTitle}>Portainer Summary</h3>
        <div className={styles.summaryStats}>
          <StatCard
            value={summaryStats.totalPortainers}
            label="Portainer Instances"
          />
          <StatCard
            value={summaryStats.containersWithUpdates}
            label="Updates Available"
            variant={STAT_CARD_VARIANTS.UPDATE_AVAILABLE}
            clickable
            onClick={() => handlePortainerStatClick(CONTENT_TABS.UPDATES)}
          />
          <StatCard
            value={summaryStats.containersUpToDate}
            label="Up to Date"
            variant={STAT_CARD_VARIANTS.CURRENT}
            clickable
            onClick={() => handlePortainerStatClick(CONTENT_TABS.CURRENT)}
          />
          <StatCard
            value={summaryStats.unusedImages}
            label="Unused Images"
            variant={STAT_CARD_VARIANTS.UNUSED_IMAGES}
            clickable
            onClick={() => handlePortainerStatClick(CONTENT_TABS.UNUSED)}
          />
        </div>

        <div className={styles.portainerInstancesList}>
          <h3>Portainer Instances</h3>
          {summaryStats.portainerStats.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No Portainer instances configured.</p>
            </div>
          ) : (
            <div className={styles.instancesGrid}>
              {summaryStats.portainerStats.map((stat) => (
                <PortainerInstanceCard
                  key={stat.name}
                  instance={stat}
                  onInstanceClick={handleInstanceClick}
                  onStatClick={handleInstanceStatClick}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.trackedAppsSummary}>
          <h3 className={styles.sectionTitle}>Tracked Apps Summary</h3>
          <div className={styles.summaryStats}>
            <StatCard
              value={summaryStats.totalTrackedApps}
              label="Tracked Apps"
              clickable
              onClick={handleTrackedAppsClick}
            />
            <StatCard
              value={summaryStats.trackedAppsBehind}
              label="Updates Available"
              variant={STAT_CARD_VARIANTS.UPDATE_AVAILABLE}
              clickable
              onClick={handleTrackedAppsClick}
            />
            <StatCard
              value={summaryStats.trackedAppsUpToDate}
              label="Up to Date"
              variant={STAT_CARD_VARIANTS.CURRENT}
              clickable
              onClick={handleTrackedAppsClick}
            />
            <StatCard
              value={summaryStats.trackedAppsUnknown}
              label="Unknown"
              variant={STAT_CARD_VARIANTS.UNUSED_IMAGES}
              clickable
              onClick={handleTrackedAppsClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

SummaryPage.propTypes = {
  portainerInstances: PropTypes.arrayOf(portainerInstanceShape),
  containers: PropTypes.arrayOf(containerShape),
  unusedImages: PropTypes.arrayOf(unusedImageShape),
  unusedImagesCount: PropTypes.number,
  trackedImages: PropTypes.arrayOf(trackedImageShape),
  dismissedTrackedAppNotifications: PropTypes.instanceOf(Map),
  onNavigateToPortainer: PropTypes.func,
  onNavigateToTrackedApps: PropTypes.func,
  onSetSelectedPortainerInstances: PropTypes.func,
  onSetContentTab: PropTypes.func,
  isLoading: PropTypes.bool,
};

export default SummaryPage;

