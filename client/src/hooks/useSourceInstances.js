import { useMemo } from "react";
import { buildContainersBySource } from "../utils/containerHelpers";

/**
 * Custom hook for managing sources
 * Derives per-source container groupings and the synthetic runner instance
 * list from the flat container list.
 *
 * @param {Object} params - Hook parameters
 * @param {Array} params.containers - Array of containers to group by source
 * @returns {Object} Hook return value
 * @returns {Array} return.sourceInstances - Runner instances sorted by name
 * @returns {Object} return.containersBySource - Containers grouped by source URL
 *
 * @example
 * const { sourceInstances, containersBySource } = useSourceInstances({
 *   containers: allContainers
 * });
 */
export const useSourceInstances = ({ containers }) => {
  // Build containersBySource map for rendering (always needed)
  // Use URL as the key instead of name, since URL is stable and doesn't change when renamed
  const containersBySource = useMemo(() => buildContainersBySource(containers), [containers]);

  // Synthetic runner instances derived from the container groupings.
  const sourceInstances = useMemo(() => {
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

    return runnerInstances.sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [containersBySource]);

  return {
    sourceInstances,
    containersBySource,
  };
};
