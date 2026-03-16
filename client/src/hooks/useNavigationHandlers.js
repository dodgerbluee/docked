import { useCallback } from "react";
import {
  CONTENT_TABS,
  STAT_TYPE_TO_CONTENT_TAB,
  // STAT_TYPES is not currently used but kept for potential future use
} from "../constants/summaryPage";

/**
 * Custom hook to consolidate navigation handlers for SummaryPage
 * Reduces code duplication and provides consistent navigation behavior
 *
 * @param {Object} handlers - Navigation handler functions
 * @param {Function} handlers.onNavigateToContainers - Navigate to Containers tab
 * @param {Function} handlers.onNavigateToTrackedApps - Navigate to Tracked Apps tab
 * @param {Function} handlers.onSetSelectedSourceInstances - Set selected source instances
 * @param {Function} handlers.onSetContentTab - Set content tab
 * @returns {Object} Navigation handler functions
 */
export const useNavigationHandlers = ({
  onNavigateToContainers,
  onNavigateToTrackedApps,
  onSetSelectedSourceInstances,
  onSetContentTab,
}) => {
  // Handler for source stat card clicks
  const handleSourceStatClick = useCallback(
    (contentTab) => {
      if (onNavigateToContainers) {
        onNavigateToContainers();
      }
      if (onSetSelectedSourceInstances) {
        onSetSelectedSourceInstances(new Set());
      }
      if (onSetContentTab && contentTab) {
        // Map CONTENT_TABS to CONTAINERS_CONTENT_TABS
        const containersTabMap = {
          [CONTENT_TABS.UPDATES]: "updates",
          [CONTENT_TABS.CURRENT]: "current",
          [CONTENT_TABS.UNUSED]: "unused",
        };
        const containersTab = containersTabMap[contentTab] || contentTab;
        onSetContentTab(containersTab);
      }
    },
    [onNavigateToContainers, onSetSelectedSourceInstances, onSetContentTab]
  );

  // Handler for source instance header clicks
  const handleInstanceClick = useCallback(
    (instanceName) => {
      if (onNavigateToContainers) {
        onNavigateToContainers();
      }
      if (onSetSelectedSourceInstances) {
        onSetSelectedSourceInstances(new Set([instanceName]));
      }
      if (onSetContentTab) {
        onSetContentTab("updates");
      }
    },
    [onNavigateToContainers, onSetSelectedSourceInstances, onSetContentTab]
  );

  // Handler for source instance stat clicks
  const handleInstanceStatClick = useCallback(
    (instanceName, statType) => {
      // statType can be either a STAT_TYPES constant or a content tab string
      const contentTab =
        STAT_TYPE_TO_CONTENT_TAB[statType] ||
        (Object.values(CONTENT_TABS).includes(statType) ? statType : CONTENT_TABS.UPDATES);

      // Map CONTENT_TABS to CONTAINERS_CONTENT_TABS
      const containersTabMap = {
        [CONTENT_TABS.UPDATES]: "updates",
        [CONTENT_TABS.CURRENT]: "current",
        [CONTENT_TABS.UNUSED]: "unused",
      };
      const containersTab = containersTabMap[contentTab] || contentTab || "updates";

      if (onNavigateToContainers) {
        onNavigateToContainers();
      }
      if (onSetSelectedSourceInstances) {
        onSetSelectedSourceInstances(new Set([instanceName]));
      }
      if (onSetContentTab) {
        onSetContentTab(containersTab);
      }
    },
    [onNavigateToContainers, onSetSelectedSourceInstances, onSetContentTab]
  );

  // Handler for Tracked Apps navigation
  const handleTrackedAppsClick = useCallback(() => {
    if (onNavigateToTrackedApps) {
      onNavigateToTrackedApps();
    }
  }, [onNavigateToTrackedApps]);

  return {
    handleSourceStatClick,
    handleInstanceClick,
    handleInstanceStatClick,
    handleTrackedAppsClick,
  };
};
