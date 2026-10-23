import { useMemo } from "react";
import { buildContainersBySource } from "../utils/containerHelpers";

/**
 * Custom hook for managing sources
 * Builds the runner instance list from the runner rows and attaches the
 * per-runner container groupings to them.
 *
 * @param {Object} params - Hook parameters
 * @param {Array} params.containers - Array of containers to group by source
 * @param {Array} params.runners - Runner rows from containerGroup (id/name/url/enabled/dockerEnabled)
 * @returns {Object} Hook return value
 * @returns {Array} return.sourceInstances - Runner instances sorted by name
 * @returns {Object} return.containersBySource - Containers grouped by source URL
 *
 * @example
 * const { sourceInstances, containersBySource } = useSourceInstances({
 *   containers: allContainers,
 *   runners: allRunners,
 * });
 */
export const useSourceInstances = ({ containers, runners = [] }) => {
  // Build containersBySource map for rendering (always needed)
  // Use URL as the key instead of name, since URL is stable and doesn't change when renamed
  const containersBySource = useMemo(() => buildContainersBySource(containers), [containers]);

  // Runner instances come from the runner rows, not from the container
  // groupings: a runner that currently reports no containers still has unused
  // images to manage and still belongs in the source picker. The groupings
  // then fill in each source's container buckets.
  const sourceInstances = useMemo(() => {
    const byKey = new Map();

    for (const runner of runners) {
      const runnerId = Number(runner?.id);
      if (!Number.isFinite(runnerId)) continue;
      // Only runners that can actually serve container data are sources.
      // A runner with Docker turned off (a bare agent on a Proxmox host, say)
      // has no containers and no images to manage, so it stays out of the
      // picker instead of adding an empty tab.
      if (runner.enabled === false || runner.dockerEnabled === false) continue;
      const key = `runner:${runnerId}`;
      byKey.set(key, {
        name: runner.name || "Runner",
        url: key,
        isRunner: true,
        runnerId,
        containers: [],
        withUpdates: [],
        upToDate: [],
      });
    }

    for (const [key, data] of Object.entries(containersBySource)) {
      if (!key.startsWith("runner:")) continue;
      byKey.set(key, {
        name: data.name,
        url: key,
        isRunner: true,
        runnerId: data.runnerId,
        containers: data.containers || [],
        withUpdates: data.withUpdates || [],
        upToDate: data.upToDate || [],
      });
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [runners, containersBySource]);

  return {
    sourceInstances,
    containersBySource,
  };
};
