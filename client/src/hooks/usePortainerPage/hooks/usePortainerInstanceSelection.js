/**
 * Hook for managing Portainer instance selection/filtering
 */

import { useState, useMemo, useCallback } from "react";

/**
 * Hook to manage Portainer instance selection (controlled or uncontrolled)
 * @param {Object} options
 * @param {Set} options.controlledSelectedPortainerInstances - Controlled selection
 * @param {Function} options.onSetSelectedPortainerInstances - Controlled setter
 * @param {Array} options.portainerInstances - All Portainer instances
 * @returns {Object} Selection state, setter, and filtered instances
 */
export const usePortainerInstanceSelection = ({
  controlledSelectedPortainerInstances,
  onSetSelectedPortainerInstances,
  portainerInstances = [],
}) => {
  const [internalSelectedPortainerInstances, setInternalSelectedPortainerInstances] = useState(
    new Set()
  );
  const isSelectedInstancesControlled = onSetSelectedPortainerInstances !== undefined;
  const selectedPortainerInstances = useMemo(
    () =>
      isSelectedInstancesControlled
        ? controlledSelectedPortainerInstances !== undefined
          ? controlledSelectedPortainerInstances
          : new Set()
        : internalSelectedPortainerInstances,
    [
      isSelectedInstancesControlled,
      controlledSelectedPortainerInstances,
      internalSelectedPortainerInstances,
    ]
  );

  const setSelectedPortainerInstances = useCallback(
    (value) => {
      if (isSelectedInstancesControlled) {
        // If controlled, call the parent's setter
        onSetSelectedPortainerInstances(value);
      } else {
        // If uncontrolled, use internal state
        if (typeof value === "function") {
          setInternalSelectedPortainerInstances(value);
        } else {
          setInternalSelectedPortainerInstances(value);
        }
      }
    },
    [isSelectedInstancesControlled, onSetSelectedPortainerInstances]
  );

  // Sort Portainer instances alphabetically
  const sortedPortainerInstances = useMemo(() => {
    return [...portainerInstances].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [portainerInstances]);

  // Memoize selectedPortainerInstances to avoid dependency issues
  const memoizedSelectedInstances = useMemo(
    () => selectedPortainerInstances,
    [selectedPortainerInstances]
  );

  // Get selected instances to show
  const instancesToShow = useMemo(() => {
    return memoizedSelectedInstances.size > 0
      ? sortedPortainerInstances.filter((inst) => memoizedSelectedInstances.has(inst.name))
      : sortedPortainerInstances;
  }, [memoizedSelectedInstances, sortedPortainerInstances]);

  return {
    selectedPortainerInstances,
    setSelectedPortainerInstances,
    sortedPortainerInstances,
    instancesToShow,
  };
};
