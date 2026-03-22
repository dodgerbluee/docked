import { useMemo } from "react";
import { buildContainersBySource } from "../utils/containerHelpers";

/**
 * Custom hook for managing source instances
 * Merges API instances with container data and provides sorted, filtered instances
 *
 * @param {Object} params - Hook parameters
 * @param {Array} params.sourceInstancesFromAPI - Source instances from API response
 * @param {Array} params.containers - Array of containers to merge with instances
 * @returns {Object} Hook return value
 * @returns {Array} return.sourceInstances - Merged and sorted source instances
 * @returns {Object} return.containersBySource - Containers grouped by source URL
 *
 * @example
 * const { sourceInstances, containersBySource } = useSourceInstances({
 *   sourceInstancesFromAPI: instances,
 *   containers: allContainers
 * });
 */
export const useSourceInstances = ({ sourceInstancesFromAPI, containers }) => {
  // Build containersBySource map for rendering (always needed)
  // Use URL as the key instead of name, since URL is stable and doesn't change when renamed
  const containersBySource = useMemo(() => buildContainersBySource(containers), [containers]);

  // Merge API instances with container data
  const sourceInstances = useMemo(() => {
    let instances;

    if (sourceInstancesFromAPI && sourceInstancesFromAPI.length > 0) {
      // Merge API instances with container data to ensure all properties are present
      // Match by URL instead of name, since URL is stable and doesn't change when renamed
      instances = sourceInstancesFromAPI
        .filter((apiInst) => apiInst != null && apiInst.url) // Filter out invalid entries
        .map((apiInst) => {
          // Match by URL instead of name
          const containerData = containersBySource[apiInst.url];
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
      // Fallback: Use containersBySource
      instances = Object.values(containersBySource || {});
    }

    // Ensure instances is always an array
    if (!Array.isArray(instances)) {
      instances = [];
    }

    // Append synthetic runner instances from containersBySource
    const runnerInstances = Object.entries(containersBySource)
      .filter(([key]) => key.startsWith("runner:"))
      .map(([key, data]) => ({
        name: data.name,
        url: key,
        isRunner: true,
        runnerId: data.runnerId,
        containers: data.containers || [],
        withUpdates: data.withUpdates || [],
        upToDate: data.upToDate || [],
      }));

    // Sort all instances (source + runner) alphabetically by name
    return [...instances, ...runnerInstances].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [sourceInstancesFromAPI, containersBySource]);

  return {
    sourceInstances,
    containersBySource,
  };
};
