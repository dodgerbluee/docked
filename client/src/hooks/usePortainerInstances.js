import { useMemo } from "react";
import { buildContainersByPortainer } from "../utils/containerHelpers";

/**
 * Custom hook for managing Portainer instances
 * Merges API instances with container data and provides sorted, filtered instances
 * 
 * @param {Object} params - Hook parameters
 * @param {Array} params.portainerInstancesFromAPI - Portainer instances from API response
 * @param {Array} params.containers - Array of containers to merge with instances
 * @returns {Object} Hook return value
 * @returns {Array} return.portainerInstances - Merged and sorted Portainer instances
 * @returns {Object} return.containersByPortainer - Containers grouped by Portainer URL
 * 
 * @example
 * const { portainerInstances, containersByPortainer } = usePortainerInstances({
 *   portainerInstancesFromAPI: instances,
 *   containers: allContainers
 * });
 */
export const usePortainerInstances = ({
  portainerInstancesFromAPI,
  containers,
}) => {
  // Build containersByPortainer map for rendering (always needed)
  // Use URL as the key instead of name, since URL is stable and doesn't change when renamed
  const containersByPortainer = useMemo(
    () => buildContainersByPortainer(containers),
    [containers]
  );

  // Merge API instances with container data
  const portainerInstances = useMemo(() => {
    let instances = [];

    if (portainerInstancesFromAPI && portainerInstancesFromAPI.length > 0) {
      // Merge API instances with container data to ensure all properties are present
      // Match by URL instead of name, since URL is stable and doesn't change when renamed
      instances = portainerInstancesFromAPI
        .filter((apiInst) => apiInst != null && apiInst.url) // Filter out invalid entries
        .map((apiInst) => {
          // Match by URL instead of name
          const containerData = containersByPortainer[apiInst.url];
          if (containerData) {
            // Merge API instance data with container data
            // Use the API instance name (which may have been updated) but keep container data
            return {
              ...apiInst,
              name: apiInst.name, // Use the updated name from API
              containers: containerData.containers || apiInst.containers || [],
              withUpdates: containerData.withUpdates || apiInst.withUpdates || [],
              upToDate: containerData.upToDate || apiInst.upToDate || [],
            };
          }
          // If no container data yet, ensure properties are initialized
          return {
            ...apiInst,
            containers: apiInst.containers || [],
            withUpdates: apiInst.withUpdates || [],
            upToDate: apiInst.upToDate || [],
          };
        });
    } else {
      // Fallback: Use containersByPortainer
      instances = Object.values(containersByPortainer || {});
    }

    // Ensure instances is always an array
    if (!Array.isArray(instances)) {
      instances = [];
    }

    // Sort Portainer instances alphabetically by name
    return instances.sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [portainerInstancesFromAPI, containersByPortainer]);

  return {
    portainerInstances,
    containersByPortainer,
  };
};

