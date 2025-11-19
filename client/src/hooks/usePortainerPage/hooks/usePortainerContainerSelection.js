/**
 * Hook for managing container selection
 */

import { useState, useCallback } from "react";

/**
 * Hook to manage container selection state
 * @returns {Object} Selection state and handlers
 */
export const usePortainerContainerSelection = () => {
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
      const allSelected = selectableContainers.every((c) => selectedContainers.has(c.id));
      if (allSelected) {
        setSelectedContainers(new Set());
      } else {
        setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
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

