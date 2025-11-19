import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * useTabReordering Hook
 * Manages Portainer instance tab reordering (drag and drop)
 */
export function useTabReordering(fetchContainers) {
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);

  const handleReorderTabs = useCallback(
    async (fromIndex, toIndex) => {
      // Get current instances from API to ensure we have IDs
      try {
        const instancesResponse = await axios.get(`${API_BASE_URL}/api/portainer/instances`);
        const apiInstances = instancesResponse.data.instances || [];

        if (apiInstances.length === 0) return;

        // Create new order array based on current API instances
        const newOrder = [...apiInstances];
        const [moved] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, moved);

        // Build orders array for API
        const orders = newOrder.map((instance, index) => ({
          id: instance.id,
          display_order: index,
        }));

        await axios.post(`${API_BASE_URL}/api/portainer/instances/reorder`, {
          orders,
        });
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
