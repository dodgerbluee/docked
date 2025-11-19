/**
 * Hook for managing tracked apps selection
 */

import { useState, useCallback } from "react";

/**
 * Hook to manage app selection state
 * @returns {Object} Selection state and handlers
 */
export const useTrackedAppsSelection = () => {
  const [selectedApps, setSelectedApps] = useState(new Set());

  const handleToggleSelect = useCallback((appId) => {
    setSelectedApps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback((appsWithUpdates) => {
    const allAppIds = appsWithUpdates.map((app) => app.id);
    const allSelected = allAppIds.length > 0 && allAppIds.every((id) => selectedApps.has(id));

    if (allSelected) {
      // Deselect all
      setSelectedApps(new Set());
    } else {
      // Select all
      setSelectedApps(new Set(allAppIds));
    }
  }, [selectedApps]);

  const allAppsWithUpdatesSelected = useCallback(
    (appsWithUpdates) => {
      if (appsWithUpdates.length === 0) return false;
      return appsWithUpdates.every((app) => selectedApps.has(app.id));
    },
    [selectedApps]
  );

  return {
    selectedApps,
    setSelectedApps,
    handleToggleSelect,
    handleSelectAll,
    allAppsWithUpdatesSelected,
  };
};

