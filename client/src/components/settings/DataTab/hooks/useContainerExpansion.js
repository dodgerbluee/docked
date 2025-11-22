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
    // Handle correlated records view keys (format: "correlated-{imageKey}")
    // For correlated records, the containerName is the full key we want to track
    let containerKey;
    if (entryKey === "correlated" && containerName && containerName.startsWith("correlated-")) {
      // For correlated records, use the containerName directly as the key
      containerKey = containerName;
    } else {
      // For old format (if still used), use entryKey:containerName
      containerKey = `${entryKey}:${containerName}`;
    }
    
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
    // Check if we're using correlated records view
    // If the first entry has correlatedRecords, expand those instead
    if (dataEntries.length > 0 && dataEntries[0]?.correlatedRecords) {
      const correlatedRecords = dataEntries[0].correlatedRecords;
      const allContainerKeys = new Set();
      Object.keys(correlatedRecords).forEach((imageKey) => {
        const recordKey = `correlated-${imageKey}`;
        allContainerKeys.add(recordKey);
      });
      setExpandedContainers(allContainerKeys);
      return;
    }
    
    // Fallback to old format (shouldn't be used anymore)
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
    // Check if we're using correlated records view
    // If the first entry has correlatedRecords, count those instead
    if (dataEntries.length > 0 && dataEntries[0]?.correlatedRecords) {
      const correlatedRecords = dataEntries[0].correlatedRecords;
      const imageKeys = Object.keys(correlatedRecords);
      if (imageKeys.length === 0) return false;
      
      let expandedCount = 0;
      imageKeys.forEach((imageKey) => {
        const recordKey = `correlated-${imageKey}`;
        if (expandedContainers.has(recordKey)) {
          expandedCount++;
        }
      });
      return expandedCount === imageKeys.length;
    }
    
    // Fallback to old format counting (shouldn't be used anymore)
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
