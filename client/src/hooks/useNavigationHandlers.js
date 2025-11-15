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
 * @param {Function} handlers.onNavigateToPortainer - Navigate to Portainer tab
 * @param {Function} handlers.onNavigateToTrackedApps - Navigate to Tracked Apps tab
 * @param {Function} handlers.onSetSelectedPortainerInstances - Set selected Portainer instances
 * @param {Function} handlers.onSetContentTab - Set content tab
 * @returns {Object} Navigation handler functions
 */
export const useNavigationHandlers = ({
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onSetSelectedPortainerInstances,
  onSetContentTab,
}) => {
  // Handler for Portainer stat card clicks
  const handlePortainerStatClick = useCallback(
    (contentTab) => {
      if (onNavigateToPortainer) {
        onNavigateToPortainer();
      }
      if (onSetSelectedPortainerInstances) {
        onSetSelectedPortainerInstances(new Set());
      }
      if (onSetContentTab && contentTab) {
        // Map CONTENT_TABS to PORTAINER_CONTENT_TABS
        const portainerTabMap = {
          [CONTENT_TABS.UPDATES]: "updates",
          [CONTENT_TABS.CURRENT]: "current",
          [CONTENT_TABS.UNUSED]: "unused",
        };
        const portainerTab = portainerTabMap[contentTab] || contentTab;
        onSetContentTab(portainerTab);
      }
    },
    [onNavigateToPortainer, onSetSelectedPortainerInstances, onSetContentTab]
  );

  // Handler for Portainer instance header clicks
  const handleInstanceClick = useCallback(
    (instanceName) => {
      if (onNavigateToPortainer) {
        onNavigateToPortainer();
      }
      if (onSetSelectedPortainerInstances) {
        onSetSelectedPortainerInstances(new Set([instanceName]));
      }
      if (onSetContentTab) {
        onSetContentTab("updates");
      }
    },
    [onNavigateToPortainer, onSetSelectedPortainerInstances, onSetContentTab]
  );

  // Handler for Portainer instance stat clicks
  const handleInstanceStatClick = useCallback(
    (instanceName, statType) => {
      // statType can be either a STAT_TYPES constant or a content tab string
      const contentTab =
        STAT_TYPE_TO_CONTENT_TAB[statType] ||
        (Object.values(CONTENT_TABS).includes(statType) ? statType : CONTENT_TABS.UPDATES);

      // Map CONTENT_TABS to PORTAINER_CONTENT_TABS
      const portainerTabMap = {
        [CONTENT_TABS.UPDATES]: "updates",
        [CONTENT_TABS.CURRENT]: "current",
        [CONTENT_TABS.UNUSED]: "unused",
      };
      const portainerTab = portainerTabMap[contentTab] || contentTab || "updates";

      if (onNavigateToPortainer) {
        onNavigateToPortainer();
      }
      if (onSetSelectedPortainerInstances) {
        onSetSelectedPortainerInstances(new Set([instanceName]));
      }
      if (onSetContentTab) {
        onSetContentTab(portainerTab);
      }
    },
    [onNavigateToPortainer, onSetSelectedPortainerInstances, onSetContentTab]
  );

  // Handler for Tracked Apps navigation
  const handleTrackedAppsClick = useCallback(() => {
    if (onNavigateToTrackedApps) {
      onNavigateToTrackedApps();
    }
  }, [onNavigateToTrackedApps]);

  return {
    handlePortainerStatClick,
    handleInstanceClick,
    handleInstanceStatClick,
    handleTrackedAppsClick,
  };
};
