/**
 * Hook for managing Portainer page search functionality
 */

import { useState, useMemo } from "react";
import { useDebounce } from "../../../hooks/useDebounce";

/**
 * Hook to manage search query and filtered results
 * @param {Array} groupedStacks - Grouped container stacks
 * @returns {Object} Search state and filtered results
 */
export const usePortainerSearch = (groupedStacks) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce search query to avoid excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter containers based on search query
  const filteredGroupedStacks = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return groupedStacks;
    }

    const query = debouncedSearchQuery.toLowerCase().trim();
    return groupedStacks
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
  }, [groupedStacks, debouncedSearchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    filteredGroupedStacks,
  };
};

