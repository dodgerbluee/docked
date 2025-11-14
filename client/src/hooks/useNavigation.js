import { useCallback } from "react";

/**
 * Custom hook for navigation handlers
 * Centralizes navigation logic for consistent behavior
 */
export const useNavigation = ({
  setActiveTab,
  setContentTab,
  setSelectedPortainerInstances,
}) => {
  const handleNavigateToSummary = useCallback(() => {
    setActiveTab("summary");
  }, [setActiveTab]);

  const handleNavigateToPortainer = useCallback(
    (container = null) => {
      setActiveTab("portainer");

      if (container) {
        const portainerUrl = container.portainerUrl;
        if (portainerUrl) {
          setSelectedPortainerInstances(new Set([container.portainerName || portainerUrl]));
        }
        if (container.hasUpdate) {
          setContentTab("updates");
        }
      }
    },
    [setActiveTab, setSelectedPortainerInstances, setContentTab]
  );

  const handleNavigateToTrackedApps = useCallback(() => {
    setActiveTab("tracked-apps");
  }, [setActiveTab]);

  const handleNavigateToSettings = useCallback(() => {
    setActiveTab("settings");
  }, [setActiveTab]);

  const handleNavigateToBatch = useCallback(() => {
    setActiveTab("batch-logs");
  }, [setActiveTab]);

  return {
    handleNavigateToSummary,
    handleNavigateToPortainer,
    handleNavigateToTrackedApps,
    handleNavigateToSettings,
    handleNavigateToBatch,
  };
};

