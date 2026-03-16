/**
 * Hook for managing source instance selection/filtering
 */

import { useState, useMemo, useCallback } from "react";

/**
 * Hook to manage source instance selection (controlled or uncontrolled)
 * @param {Object} options
 * @param {Set} options.controlledSelectedSourceInstances - Controlled selection
 * @param {Function} options.onSetSelectedSourceInstances - Controlled setter
 * @param {Array} options.sourceInstances - All source instances
 * @returns {Object} Selection state, setter, and filtered instances
 */
export const useSourceInstanceSelection = ({
  controlledSelectedSourceInstances,
  onSetSelectedSourceInstances,
  sourceInstances = [],
}) => {
  const [internalSelectedSourceInstances, setInternalSelectedSourceInstances] = useState(
    new Set()
  );
  const isSelectedInstancesControlled = onSetSelectedSourceInstances !== undefined;
  const selectedSourceInstances = useMemo(
    () =>
      isSelectedInstancesControlled
        ? controlledSelectedSourceInstances !== undefined
          ? controlledSelectedSourceInstances
          : new Set()
        : internalSelectedSourceInstances,
    [
      isSelectedInstancesControlled,
      controlledSelectedSourceInstances,
      internalSelectedSourceInstances,
    ]
  );

  const setSelectedSourceInstances = useCallback(
    (value) => {
      if (isSelectedInstancesControlled) {
        // If controlled, call the parent's setter
        onSetSelectedSourceInstances(value);
      } else {
        // If uncontrolled, use internal state
        if (typeof value === "function") {
          setInternalSelectedSourceInstances(value);
        } else {
          setInternalSelectedSourceInstances(value);
        }
      }
    },
    [isSelectedInstancesControlled, onSetSelectedSourceInstances]
  );

  // Sort source instances alphabetically
  const sortedSourceInstances = useMemo(() => {
    return [...sourceInstances].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [sourceInstances]);

  // Memoize selectedSourceInstances to avoid dependency issues
  const memoizedSelectedInstances = useMemo(
    () => selectedSourceInstances,
    [selectedSourceInstances]
  );

  // Get selected instances to show
  const instancesToShow = useMemo(() => {
    return memoizedSelectedInstances.size > 0
      ? sortedSourceInstances.filter((inst) => memoizedSelectedInstances.has(inst.name))
      : sortedSourceInstances;
  }, [memoizedSelectedInstances, sortedSourceInstances]);

  return {
    selectedSourceInstances,
    setSelectedSourceInstances,
    sortedSourceInstances,
    instancesToShow,
  };
};
