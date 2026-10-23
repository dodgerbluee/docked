/**
 * Hook for managing container selection
 */

import { useState, useCallback } from "react";
import { getContainerKey } from "../../../utils/containerHelpers";

/**
 * Hook to manage container selection state
 * @returns {Object} Selection state and handlers
 */
export const useContainerSelection = () => {
  const [selectedContainers, setSelectedContainers] = useState(new Set());

  // Toggle container selection
  const handleToggleSelect = useCallback((containerId) => {
    setSelectedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) {
        next.delete(containerId);
      } else {
        next.add(containerId);
      }
      return next;
    });
  }, []);

  // Select all containers
  const handleSelectAll = useCallback(
    (containersToSelect, isPortainerContainer) => {
      const selectableContainers = containersToSelect.filter((c) => !isPortainerContainer(c));
      const allSelected = selectableContainers.every((c) =>
        selectedContainers.has(getContainerKey(c))
      );
      if (allSelected) {
        setSelectedContainers(new Set());
      } else {
        setSelectedContainers(new Set(selectableContainers.map((c) => getContainerKey(c))));
      }
    },
    [selectedContainers]
  );

  return {
    selectedContainers,
    setSelectedContainers,
    handleToggleSelect,
    handleSelectAll,
  };
};
