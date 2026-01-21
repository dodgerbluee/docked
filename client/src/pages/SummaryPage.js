import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSummaryStats } from "../hooks/useSummaryStats";
import { useNavigationHandlers } from "../hooks/useNavigationHandlers";
import { useBatchRuns } from "../hooks/useBatchRuns";
import { CONTENT_TABS } from "../constants/summaryPage";
import {
  containerShape,
  portainerInstanceShape,
  unusedImageShape,
  trackedAppShape,
} from "../utils/propTypes";
import WelcomeModal from "./SummaryPage/components/WelcomeModal";
import HeroStats from "./SummaryPage/components/HeroStats";
import ActivityFeed from "./SummaryPage/components/ActivityFeed";
import ContainerHealthOverview from "./SummaryPage/components/ContainerHealthOverview";
import ImageStatistics from "./SummaryPage/components/ImageStatistics";
import ModernPortainerInstances from "./SummaryPage/components/ModernPortainerInstances";
import RecentBatchRuns from "./SummaryPage/components/RecentBatchRuns";
import HistoryMetrics from "./SummaryPage/components/HistoryMetrics";
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
  onSetSelectedPortainerInstances,
  onSetContentTab,
  isLoading = false,
  onAddInstance,
}) => {
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const hasNoInstances = portainerInstances.length === 0;
  const hasNoTrackedApps = trackedApps.length === 0;
  const shouldShowWelcome = hasNoInstances && hasNoTrackedApps;

  // Show welcome modal when there are no instances and no tracked apps
  useEffect(() => {
    if (isLoading) {
      return;
    }

    const welcomeModalShown = localStorage.getItem("welcomeModalShown") === "true";

    if (shouldShowWelcome && !welcomeModalShown) {
      const timer = setTimeout(() => {
        if (portainerInstances.length === 0 && trackedApps.length === 0 && !isLoading) {
          setShowWelcomeModal(true);
          localStorage.setItem("welcomeModalShown", "true");
        }
      }, 500);

      return () => clearTimeout(timer);
    } else {
      setShowWelcomeModal(false);
    }
  }, [shouldShowWelcome, portainerInstances.length, trackedApps.length, isLoading]);

  const summaryStats = useSummaryStats({
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    trackedApps,
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

  // Fetch batch run data for activity feed
  const { latestRunsByJobType, recentRuns } = useBatchRuns();

  const shouldShowEmptyState = !isLoading && portainerInstances.length === 0;

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
            {/* Left Column - Health & History */}
            <div className={styles.leftColumn}>
              {/* Portainer Instances Section */}
              <ModernPortainerInstances
                portainerStats={summaryStats.portainerStats}
                shouldShowEmptyState={shouldShowEmptyState}
                onInstanceClick={handleInstanceClick}
                onStatClick={handleInstanceStatClick}
              />

              <ContainerHealthOverview
                containers={containers}
                summaryStats={summaryStats}
                shouldShowEmptyState={shouldShowEmptyState}
                onStatClick={handlePortainerStatClick}
              />

              <HistoryMetrics />
            </div>

            {/* Right Column - Activity & Stats */}
            <div className={styles.rightColumn}>
              <ActivityFeed
                containers={containers}
                trackedApps={trackedApps}
                recentRuns={recentRuns}
                latestRunsByJobType={latestRunsByJobType}
              />

              <ImageStatistics
                containers={containers}
                unusedImages={unusedImages}
                unusedImagesCount={unusedImagesCount}
                shouldShowEmptyState={shouldShowEmptyState}
                onUnusedImagesClick={() => handlePortainerStatClick(CONTENT_TABS.UNUSED)}
              />

              <RecentBatchRuns recentRuns={recentRuns} latestRunsByJobType={latestRunsByJobType} />
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
  portainerInstances: PropTypes.arrayOf(portainerInstanceShape),
  containers: PropTypes.arrayOf(containerShape),
  unusedImages: PropTypes.arrayOf(unusedImageShape),
  unusedImagesCount: PropTypes.number,
  trackedApps: PropTypes.arrayOf(trackedAppShape),
  dismissedTrackedAppNotifications: PropTypes.instanceOf(Map),
  onNavigateToPortainer: PropTypes.func,
  onNavigateToTrackedApps: PropTypes.func,
  onSetSelectedPortainerInstances: PropTypes.func,
  onSetContentTab: PropTypes.func,
  isLoading: PropTypes.bool,
  onAddInstance: PropTypes.func,
};

export default SummaryPage;
