import { useState, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import {
  SOURCE_INSTANCES_QUERY,
  REORDER_SOURCE_INSTANCES_MUTATION,
} from "../graphql/queries";

/**
 * useTabReordering Hook
 * Manages source instance tab reordering (drag and drop)
 */
export function useTabReordering(fetchContainers) {
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);

  const handleReorderTabs = useCallback(
    async (fromIndex, toIndex) => {
      // Get current instances from the graph to ensure we have IDs
      try {
        const instancesResult = await graphqlClient.query(SOURCE_INSTANCES_QUERY).toPromise();
        const apiInstances = instancesResult.data?.sourceInstances || [];

        if (apiInstances.length === 0) return;

        // Create new order array based on current API instances
        const newOrder = [...apiInstances];
        const [moved] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, moved);

        // Build orders array for the mutation
        const instances = newOrder.map((instance, index) => ({
          id: instance.id,
          order: index,
        }));

        await graphqlClient.mutation(REORDER_SOURCE_INSTANCES_MUTATION, { instances }).toPromise();
        // Refresh containers to get updated order
        fetchContainers();
      } catch (err) {
        console.error("Error reordering tabs:", err);
      }
    },
    [fetchContainers]
  );

  return {
    draggedTabIndex,
    setDraggedTabIndex,
    handleReorderTabs,
  };
}
