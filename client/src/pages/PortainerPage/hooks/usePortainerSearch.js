/**
 * Hook for managing Portainer page search functionality
 */

import { useState, useMemo } from "react";
import { useDebounce } from "../../../hooks/useDebounce";
import { PORTAINER_IMAGE_SOURCE_FILTERS } from "../../../constants/portainerPage";

/**
 * Hook to manage search query and filtered results
 * @param {Array} groupedStacks - Grouped container stacks
 * @param {Set} selectedImageSourceFilters - Selected image source filters
 * @returns {Object} Search state and filtered results
 */
export const usePortainerSearch = (groupedStacks, selectedImageSourceFilters = new Set()) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce search query to avoid excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter containers based on image source and search query
  const filteredGroupedStacks = useMemo(() => {
    let filtered = groupedStacks;

    // Filter by image source
    if (selectedImageSourceFilters.size > 0) {
      filtered = filtered
        .map((stack) => ({
          ...stack,
          containers: stack.containers.filter((container) => {
            const provider = container.provider;
            
            // Map provider to filter values
            if (provider === "dockerhub") {
              return selectedImageSourceFilters.has(PORTAINER_IMAGE_SOURCE_FILTERS.DOCKERHUB);
            } else if (provider === "ghcr" || provider === "github-releases") {
              return selectedImageSourceFilters.has(PORTAINER_IMAGE_SOURCE_FILTERS.GITHUB);
            } else if (provider === "gitlab") {
              return selectedImageSourceFilters.has(PORTAINER_IMAGE_SOURCE_FILTERS.GITLAB);
            } else if (provider === "gcr") {
              return selectedImageSourceFilters.has(PORTAINER_IMAGE_SOURCE_FILTERS.GOOGLE);
            }
            
            // If provider is not set or unknown, only show if no filters are selected
            // (when filters are active, hide unknown providers)
            return selectedImageSourceFilters.size === 0;
          }),
        }))
        .filter((stack) => stack.containers.length > 0);
    }

    // Filter by search query
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      filtered = filtered
        .map((stack) => ({
          ...stack,
          containers: stack.containers.filter((container) => {
            const name = container.name?.toLowerCase() || "";
            const image = container.image?.toLowerCase() || "";
            const stackName = stack.stackName?.toLowerCase() || "";
            return name.includes(query) || image.includes(query) || stackName.includes(query);
          }),
        }))
        .filter((stack) => stack.containers.length > 0);
    }

    return filtered;
  }, [groupedStacks, debouncedSearchQuery, selectedImageSourceFilters]);

  return {
    searchQuery,
    setSearchQuery,
    filteredGroupedStacks,
  };
};
