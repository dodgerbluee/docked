/**
 * Hook for filtering tracked apps by source and search
 */

import { useMemo } from "react";
import {
  TRACKED_APPS_CONTENT_TABS,
  TRACKED_APPS_SOURCE_FILTERS,
} from "../../../constants/trackedAppsPage";

/**
 * Hook to filter tracked apps by source type and search query
 * @param {Array} trackedImages - All tracked images
 * @param {Set} selectedSourceFilters - Selected source filters
 * @param {string} searchQuery - Search query
 * @param {string} contentTab - Current content tab
 * @returns {Object} Filtered apps and computed arrays
 */
export const useTrackedAppsFiltering = (
  trackedImages,
  selectedSourceFilters,
  searchQuery,
  contentTab
) => {
  // Filter by source type
  const filteredBySource = useMemo(() => {
    if (selectedSourceFilters.size === 0) {
      return trackedImages;
    }
    return trackedImages.filter((img) => {
      const sourceType = img.source_type || "docker";
      if (sourceType === "docker") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.DOCKERHUB);
      } else if (sourceType === "github") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.GITHUB);
      } else if (sourceType === "gitlab") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.GITLAB);
      }
      return false;
    });
  }, [trackedImages, selectedSourceFilters]);

  // Filter by search query
  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) {
      return filteredBySource;
    }

    const query = searchQuery.toLowerCase().trim();
    return filteredBySource.filter((img) => {
      const name = img.name?.toLowerCase() || "";
      const imageName = img.image_name?.toLowerCase() || "";
      const githubRepo = img.github_repo?.toLowerCase() || "";
      const currentVersion = img.current_version?.toLowerCase() || "";
      const latestVersion = img.latest_version?.toLowerCase() || "";
      return (
        name.includes(query) ||
        imageName.includes(query) ||
        githubRepo.includes(query) ||
        currentVersion.includes(query) ||
        latestVersion.includes(query)
      );
    });
  }, [filteredBySource, searchQuery]);

  // Memoize filtered arrays based on content tab
  const appsWithUpdates = useMemo(
    () => filteredBySearch.filter((img) => img.has_update),
    [filteredBySearch]
  );
  const appsWithoutUpdates = useMemo(
    () => filteredBySearch.filter((img) => !img.has_update),
    [filteredBySearch]
  );

  // Get apps to display based on content tab
  const displayedApps = useMemo(() => {
    if (contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES) {
      return appsWithUpdates;
    } else if (contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE) {
      return appsWithoutUpdates;
    } else {
      // ALL tab - combine both, with updates first
      return [...appsWithUpdates, ...appsWithoutUpdates];
    }
  }, [contentTab, appsWithUpdates, appsWithoutUpdates]);

  return {
    filteredBySource,
    filteredBySearch,
    appsWithUpdates,
    appsWithoutUpdates,
    displayedApps,
  };
};

