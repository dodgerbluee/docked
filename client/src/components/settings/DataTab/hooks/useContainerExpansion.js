/**
 * Hook for managing container expansion state
 */

import { useState, useCallback } from "react";

/**
 * Hook to manage container expansion state
 * @param {Array} dataEntries - Data entries to calculate expansion state from
 * @returns {Object} Expansion state and handlers
 */
export const useContainerExpansion = (dataEntries) => {
  const [expandedContainers, setExpandedContainers] = useState(new Set());

  const toggleContainerExpansion = useCallback((entryKey, containerName) => {
    const containerKey = `${entryKey}:${containerName}`;
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerKey)) {
        next.delete(containerKey);
      } else {
        next.add(containerKey);
      }
      return next;
    });
  }, []);

  const expandAllContainers = useCallback(() => {
    const allContainerKeys = new Set();
    dataEntries.forEach((entry) => {
      const containerNames = entry.containerNames || [];
      const containers = entry.data?.containers || [];
      const containersToDisplay =
        containerNames.length > 0
          ? containerNames
          : containers.map((c) => c.name || c.id || `Container`);
      containersToDisplay.forEach((name) => {
        const containerKey = `${entry.key}:${name}`;
        allContainerKeys.add(containerKey);
      });
    });
    setExpandedContainers(allContainerKeys);
  }, [dataEntries]);

  const collapseAllContainers = useCallback(() => {
    setExpandedContainers(new Set());
  }, []);

  const areAllExpanded = useCallback(() => {
    if (dataEntries.length === 0) return false;
    let totalContainers = 0;
    let expandedCount = 0;
    dataEntries.forEach((entry) => {
      const containerNames = entry.containerNames || [];
      const containers = entry.data?.containers || [];
      const containersToDisplay =
        containerNames.length > 0
          ? containerNames
          : containers.map((c) => c.name || c.id || `Container`);
      containersToDisplay.forEach((name) => {
        totalContainers++;
        const containerKey = `${entry.key}:${name}`;
        if (expandedContainers.has(containerKey)) {
          expandedCount++;
        }
      });
    });
    return totalContainers > 0 && expandedCount === totalContainers;
  }, [dataEntries, expandedContainers]);

  return {
    expandedContainers,
    toggleContainerExpansion,
    expandAllContainers,
    collapseAllContainers,
    areAllExpanded,
  };
};
