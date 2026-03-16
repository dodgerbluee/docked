import { useCallback } from "react";
import { TAB_NAMES } from "../constants/apiConstants";

/**
 * Custom hook for navigation handlers
 * Centralizes navigation logic for consistent behavior
 */
export const useNavigation = ({ setActiveTab, setContentTab, setSelectedSourceInstances }) => {
  const handleNavigateToSummary = useCallback(() => {
    setActiveTab(TAB_NAMES.SUMMARY);
  }, [setActiveTab]);

  const handleNavigateToContainers = useCallback(
    (container = null) => {
      setActiveTab(TAB_NAMES.CONTAINERS);

      if (container) {
        const sourceUrl = container.sourceUrl;
        if (sourceUrl) {
          setSelectedSourceInstances(new Set([container.sourceName || sourceUrl]));
        }
        if (container.hasUpdate) {
          setContentTab("updates");
        }
      }
    },
    [setActiveTab, setSelectedSourceInstances, setContentTab]
  );

  const handleNavigateToTrackedApps = useCallback(() => {
    setActiveTab(TAB_NAMES.TRACKED_APPS);
  }, [setActiveTab]);

  const handleNavigateToSettings = useCallback(() => {
    setActiveTab("settings");
  }, [setActiveTab]);

  const handleNavigateToBatch = useCallback(() => {
    setActiveTab("batch-logs");
  }, [setActiveTab]);

  return {
    handleNavigateToSummary,
    handleNavigateToContainers,
    handleNavigateToTrackedApps,
    handleNavigateToSettings,
    handleNavigateToBatch,
  };
};
