import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSummaryStats } from "../hooks/useSummaryStats";
import { useNavigationHandlers } from "../hooks/useNavigationHandlers";
import { useBatchRuns } from "../hooks/useBatchRuns";
import { CONTENT_TABS } from "../constants/summaryPage";
import {
  containerShape,
  sourceInstanceShape,
  unusedImageShape,
  trackedAppShape,
} from "../utils/propTypes";
import WelcomeModal from "./SummaryPage/components/WelcomeModal";
import SummaryPageSkeleton from "./SummaryPage/components/SummaryPageSkeleton";
import HeroStats from "./SummaryPage/components/HeroStats";
import ActivityFeed from "./SummaryPage/components/ActivityFeed";
import ContainerHealthOverview from "./SummaryPage/components/ContainerHealthOverview";
import ImageStatistics from "./SummaryPage/components/ImageStatistics";
import ModernPortainerInstances from "./SummaryPage/components/ModernPortainerInstances";
import styles from "./SummaryPage.module.css";

/**
 * Modern Summary page component displaying comprehensive Docker ecosystem information
 * @param {Object} props - Component props
 */
const SummaryPage = ({
  portainerInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  trackedApps = [],
  dismissedTrackedAppNotifications = new Map(),
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onNavigateToAnalytics,
  onSetSelectedPortainerInstances,
  onSetContentTab,
  isLoading = false,
  dataFetched = false,
  onAddInstance,
}) => {
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const hasNoInstances = portainerInstances.length === 0;
  const hasNoTrackedApps = trackedApps.length === 0;
  const shouldShowWelcome = hasNoInstances && hasNoTrackedApps;

  // Show welcome modal when there are no instances and no tracked apps
  useEffect(() => {
    // Gate on dataFetched — don't show modal until we know the data is real
    if (!dataFetched) {
      return;
    }

    const welcomeModalShown = localStorage.getItem("welcomeModalShown") === "true";

    if (shouldShowWelcome && !welcomeModalShown) {
      const timer = setTimeout(() => {
        if (portainerInstances.length === 0 && trackedApps.length === 0 && dataFetched) {
          setShowWelcomeModal(true);
          localStorage.setItem("welcomeModalShown", "true");
        }
      }, 500);

      return () => clearTimeout(timer);
    } else {
      setShowWelcomeModal(false);
    }
  }, [shouldShowWelcome, portainerInstances.length, trackedApps.length, dataFetched]);

  const summaryStats = useSummaryStats({
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    trackedApps,
    dismissedTrackedAppNotifications,
  });

  const {
    handleSourceStatClick: handlePortainerStatClick,
    handleInstanceClick,
    handleInstanceStatClick,
    handleTrackedAppsClick,
  } = useNavigationHandlers({
    onNavigateToContainers: onNavigateToPortainer,
    onNavigateToTrackedApps,
    onSetSelectedSourceInstances: onSetSelectedPortainerInstances,
    onSetContentTab,
  });

  // Fetch batch run data for activity feed
  const { latestRunsByJobType, recentRuns } = useBatchRuns();

  const shouldShowEmptyState = dataFetched && portainerInstances.length === 0;

  // Show skeleton while initial data hasn't been fetched yet
  if (!dataFetched) {
    return (
      <div className={styles.summaryPage}>
        <div className={styles.contentTabPanel}>
          <SummaryPageSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.summaryPage}>
      <div className={styles.contentTabPanel}>
        <div className={styles.modernDashboard}>
          {/* Hero Stats Section */}
          <HeroStats
            stats={summaryStats}
            shouldShowEmptyState={shouldShowEmptyState}
            onPortainerStatClick={handlePortainerStatClick}
            onTrackedAppsClick={handleTrackedAppsClick}
          />

          {/* Main Content Grid */}
          <div className={styles.dashboardGrid}>
            {/* Left Column - Instances & Health + Images (two equal sections) */}
            <div className={styles.leftColumn}>
              <ModernPortainerInstances
                portainerStats={summaryStats.portainerStats}
                shouldShowEmptyState={shouldShowEmptyState}
                onInstanceClick={handleInstanceClick}
                onStatClick={handleInstanceStatClick}
              />

              <div className={styles.healthAndImagesRow}>
                <ContainerHealthOverview
                  containers={containers}
                  summaryStats={summaryStats}
                  shouldShowEmptyState={shouldShowEmptyState}
                  onStatClick={handlePortainerStatClick}
                />
                <ImageStatistics
                  containers={containers}
                  unusedImagesCount={unusedImagesCount}
                  shouldShowEmptyState={shouldShowEmptyState}
                  onUnusedImagesClick={() => handlePortainerStatClick(CONTENT_TABS.UNUSED)}
                />
              </div>
            </div>

            {/* Right Column - Activity */}
            <div className={styles.rightColumn}>
              <ActivityFeed
                containers={containers}
                trackedApps={trackedApps}
                recentRuns={recentRuns}
                latestRunsByJobType={latestRunsByJobType}
              />
            </div>
          </div>
        </div>
      </div>

      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => {
          setShowWelcomeModal(false);
          localStorage.setItem("welcomeModalShown", "true");
        }}
        onAddInstance={onAddInstance}
        onAddTrackedApp={() => {
          setShowWelcomeModal(false);
          localStorage.setItem("welcomeModalShown", "true");
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
  portainerInstances: PropTypes.arrayOf(sourceInstanceShape),
  containers: PropTypes.arrayOf(containerShape),
  unusedImages: PropTypes.arrayOf(unusedImageShape),
  unusedImagesCount: PropTypes.number,
  trackedApps: PropTypes.arrayOf(trackedAppShape),
  dismissedTrackedAppNotifications: PropTypes.instanceOf(Map),
  onNavigateToPortainer: PropTypes.func,
  onNavigateToTrackedApps: PropTypes.func,
  onNavigateToAnalytics: PropTypes.func,
  onSetSelectedPortainerInstances: PropTypes.func,
  onSetContentTab: PropTypes.func,
  isLoading: PropTypes.bool,
  dataFetched: PropTypes.bool,
  onAddInstance: PropTypes.func,
};

export default SummaryPage;
