import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import StatCard from "../components/StatCard";
import PortainerInstanceCard from "../components/PortainerInstanceCard";
import { useSummaryStats } from "../hooks/useSummaryStats";
import { useNavigationHandlers } from "../hooks/useNavigationHandlers";
import { CONTENT_TABS, STAT_CARD_VARIANTS } from "../constants/summaryPage";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";
import {
  containerShape,
  portainerInstanceShape,
  unusedImageShape,
  trackedImageShape,
} from "../utils/propTypes";
import WelcomeModal from "./SummaryPage/components/WelcomeModal";
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
 * @param {Function} props.onAddInstance - Handler to open Add Portainer Instance modal
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
  onAddInstance,
}) => {
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const hasNoInstances = portainerInstances.length === 0;
  const hasNoTrackedApps = trackedImages.length === 0;
  const shouldShowWelcome = hasNoInstances && hasNoTrackedApps;

  // Show welcome modal when there are no instances and no tracked apps
  // Add a delay to ensure data has been fetched from the API
  // Only show once per login session (using sessionStorage)
  useEffect(() => {
    // Check if modal has already been shown in this session
    const welcomeModalShown = sessionStorage.getItem("welcomeModalShown") === "true";

    if (shouldShowWelcome && !welcomeModalShown) {
      // Reduced delay for faster appearance
      const timer = setTimeout(() => {
        // Show modal if instances and tracked apps are still empty
        if (portainerInstances.length === 0 && trackedImages.length === 0) {
          setShowWelcomeModal(true);
          sessionStorage.setItem("welcomeModalShown", "true");
        }
      }, 500); // 0.5 second delay for faster appearance

      return () => clearTimeout(timer);
    } else {
      // If instances or tracked apps are added, close the modal
      setShowWelcomeModal(false);
    }
  }, [shouldShowWelcome, portainerInstances.length, trackedImages.length]);
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

  // Show zeroed-out dashboard when no instances (instead of loading state)
  const shouldShowEmptyState = !isLoading && portainerInstances.length === 0;

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
            value={shouldShowEmptyState ? 0 : summaryStats.totalContainers}
            label="Total Containers"
            clickable={!shouldShowEmptyState}
            onClick={() => {
              if (shouldShowEmptyState || !onNavigateToPortainer) return;
              onNavigateToPortainer();
              if (onSetSelectedPortainerInstances) {
                onSetSelectedPortainerInstances(new Set());
              }
              if (onSetContentTab) {
                onSetContentTab(PORTAINER_CONTENT_TABS.ALL);
              }
            }}
          />
          <StatCard
            value={shouldShowEmptyState ? 0 : summaryStats.containersWithUpdates}
            label="Updates Available"
            variant={
              shouldShowEmptyState || summaryStats.containersWithUpdates === 0
                ? STAT_CARD_VARIANTS.DEFAULT
                : STAT_CARD_VARIANTS.UPDATE_AVAILABLE
            }
            clickable={!shouldShowEmptyState}
            onClick={() => {
              if (shouldShowEmptyState) return;
              handlePortainerStatClick(CONTENT_TABS.UPDATES);
            }}
          />
          <StatCard
            value={shouldShowEmptyState ? 0 : summaryStats.containersUpToDate}
            label="Up to Date"
            variant={STAT_CARD_VARIANTS.CURRENT}
            clickable={!shouldShowEmptyState}
            onClick={() => {
              if (shouldShowEmptyState) return;
              handlePortainerStatClick(CONTENT_TABS.CURRENT);
            }}
          />
          <StatCard
            value={shouldShowEmptyState ? 0 : summaryStats.unusedImages}
            label="Unused Images"
            variant={STAT_CARD_VARIANTS.UNUSED_IMAGES}
            clickable={!shouldShowEmptyState}
            onClick={() => {
              if (shouldShowEmptyState) return;
              handlePortainerStatClick(CONTENT_TABS.UNUSED);
            }}
          />
        </div>
        <div className={styles.summaryDivider}></div>

        <div className={styles.portainerInstancesList}>
          <h3 className={styles.sectionTitle}>Portainer Instances</h3>
          {shouldShowEmptyState || summaryStats.portainerStats.length === 0 ? (
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
              clickable={true}
              onClick={() => {
                handleTrackedAppsClick();
              }}
            />
            <StatCard
              value={summaryStats.trackedAppsBehind}
              label="Updates Available"
              variant={
                summaryStats.trackedAppsBehind === 0
                  ? STAT_CARD_VARIANTS.DEFAULT
                  : STAT_CARD_VARIANTS.UPDATE_AVAILABLE
              }
              clickable={true}
              onClick={() => {
                handleTrackedAppsClick();
              }}
            />
            <StatCard
              value={summaryStats.trackedAppsUpToDate}
              label="Up to Date"
              variant={STAT_CARD_VARIANTS.CURRENT}
              clickable={true}
              onClick={() => {
                handleTrackedAppsClick();
              }}
            />
            <StatCard
              value={summaryStats.trackedAppsUnknown}
              label="Unknown"
              variant={STAT_CARD_VARIANTS.UNUSED_IMAGES}
              clickable={true}
              onClick={() => {
                handleTrackedAppsClick();
              }}
            />
          </div>
        </div>
      </div>

      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => {
          setShowWelcomeModal(false);
          sessionStorage.setItem("welcomeModalShown", "true"); // Mark as shown/dismissed in session
        }}
        onAddInstance={onAddInstance}
        onAddTrackedApp={() => {
          setShowWelcomeModal(false);
          sessionStorage.setItem("welcomeModalShown", "true");
          if (onNavigateToTrackedApps) {
            onNavigateToTrackedApps();
          }
        }}
        onNavigateToPortainer={onNavigateToPortainer}
      />
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
  onAddInstance: PropTypes.func,
};

export default SummaryPage;
