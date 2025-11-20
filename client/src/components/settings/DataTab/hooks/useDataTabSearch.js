/**
 * Hook for managing Data tab search functionality
 */

import { useState, useMemo } from "react";
import { useDebounce } from "../../../../hooks/useDebounce";

/**
 * Hook to manage search query and filtered results for Data tab
 * @param {Array} dataEntries - Array of data entries
 * @returns {Object} Search state and filtered results
 */
export const useDataTabSearch = (dataEntries) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce search query to avoid excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter data entries based on search query
  // Also search within JSON content by stringifying the data
  const filteredDataEntries = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return dataEntries;
    }

    const query = debouncedSearchQuery.toLowerCase().trim();

    return dataEntries
      .map((entry) => {
        // Search in entry key
        const entryKey = entry.key?.toLowerCase() || "";
        const matchesEntryKey = entryKey.includes(query);

        // Search in Portainer instance name
        const instanceName = entry.data?.instanceName?.toLowerCase() || "";
        const matchesInstanceName = instanceName.includes(query);

        // Search in Portainer instance URL
        const instanceUrl = entry.data?.instanceUrl?.toLowerCase() || "";
        const matchesInstanceUrl = instanceUrl.includes(query);

        // Search in container names
        const containerNames = entry.containerNames || [];
        const matchingContainerNames = containerNames.filter((name) =>
          name?.toLowerCase().includes(query)
        );

        // Search in container data (names, images, IDs, and JSON content)
        const containers = entry.data?.containers || [];
        const matchingContainers = containers.filter((container) => {
          const containerName = container.name?.toLowerCase() || "";
          const containerImage = container.image?.toLowerCase() || "";
          const containerId = container.id?.toLowerCase() || "";
          
          // Check name, image, or ID match
          if (
            containerName.includes(query) ||
            containerImage.includes(query) ||
            containerId.includes(query)
          ) {
            return true;
          }
          
          // Check if container's JSON content matches
          try {
            const containerJsonString = JSON.stringify(container || {}).toLowerCase();
            if (containerJsonString.includes(query)) {
              return true;
            }
          } catch (e) {
            // If JSON stringify fails, skip
          }
          
          return false;
        });

        // Search in JSON content by stringifying the entire data object
        let matchesJsonContent = false;
        try {
          const jsonString = JSON.stringify(entry.data || {}).toLowerCase();
          matchesJsonContent = jsonString.includes(query);
        } catch (e) {
          // If JSON stringify fails, skip JSON content search
        }

        // Entry matches if any of the above match
        const entryMatches =
          matchesEntryKey ||
          matchesInstanceName ||
          matchesInstanceUrl ||
          matchingContainerNames.length > 0 ||
          matchingContainers.length > 0 ||
          matchesJsonContent;

        if (!entryMatches) {
          return null; // Filter out this entry
        }

        // If entry matches, return it with filtered container information
        // This allows ContainerDataEntry to show only matching containers
        return {
          ...entry,
          _searchQuery: query, // Pass search query to component for container-level filtering
          _matchingContainerNames: matchingContainerNames,
          _matchingContainers: matchingContainers,
        };
      })
      .filter((entry) => entry !== null);
  }, [dataEntries, debouncedSearchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    filteredDataEntries,
  };
};

