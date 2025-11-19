/**
 * Hook for managing container upgrade operations
 */

import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { toast } from "../../../utils/toast";

/**
 * Hook to manage container upgrade operations (single and batch)
 * @param {Object} options
 * @param {Object} options.successfullyUpdatedContainersRef - Ref to track updated containers
 * @param {Function} options.onContainersUpdate - Callback to update containers
 * @param {Function} options.fetchContainers - Function to refresh containers
 * @returns {Object} Upgrade state and handlers
 */
export const usePortainerUpgrade = ({
  successfullyUpdatedContainersRef,
  onContainersUpdate,
  fetchContainers,
}) => {
  const [upgrading, setUpgrading] = useState({});
  const [batchUpgrading, setBatchUpgrading] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState({
    isOpen: false,
    container: null,
  });
  const [batchUpgradeModal, setBatchUpgradeModal] = useState({
    isOpen: false,
    containers: [],
  });

  // Open upgrade modal
  const handleUpgrade = useCallback((container) => {
    // Always reopen modal, even if it was just closed (allows clicking card again)
    setUpgradeModal({
      isOpen: true,
      container,
    });
  }, []);

  // Close upgrade modal (but keep container reference so it can be reopened)
  const closeUpgradeModal = useCallback(() => {
    setUpgradeModal((prev) => ({
      isOpen: false,
      container: prev.container, // Keep container reference so clicking card again works
    }));
  }, []);

  // Execute the actual upgrade (called by the modal)
  const executeUpgrade = useCallback(async () => {
    const container = upgradeModal.container;
    if (!container) return;

    try {
      setUpgrading((prev) => ({ ...prev, [container.id]: true }));
      const response = await axios.post(`${API_BASE_URL}/api/containers/${container.id}/upgrade`, {
        endpointId: container.endpointId,
        imageName: container.image,
        portainerUrl: container.portainerUrl,
      });

      if (response.data.success) {
        // Add both old and new container IDs to the ref
        // After upgrade, container gets a new ID, so we need to track both
        successfullyUpdatedContainersRef.current.add(container.id);
        if (response.data.newContainerId) {
          successfullyUpdatedContainersRef.current.add(response.data.newContainerId);
        }

        // Update local state immediately so UI reflects the change right away
        if (onContainersUpdate) {
          onContainersUpdate((prevContainers) =>
            prevContainers.map((c) => {
              // Match by old ID or new ID
              const matchesId =
                c.id === container.id ||
                c.id === response.data.newContainerId ||
                c.id?.substring(0, 12) === container.id?.substring(0, 12) ||
                (response.data.newContainerId &&
                  c.id?.substring(0, 12) === response.data.newContainerId?.substring(0, 12));
              // Also match by name as fallback
              const matchesName = c.name === container.name;
              if (matchesId || matchesName) {
                return { ...c, hasUpdate: false };
              }
              return c;
            })
          );
        }

        // Refresh from server to get updated data (cache is already updated on backend)
        if (fetchContainers) {
          fetchContainers();
        }
      }
    } catch (err) {
      // Error will be handled by the modal
      throw err;
    } finally {
      setUpgrading((prev) => ({ ...prev, [container.id]: false }));
    }
  }, [
    upgradeModal.container,
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    fetchContainers,
  ]);

  // Handle upgrade success callback
  const handleUpgradeSuccess = useCallback(() => {
    const container = upgradeModal.container;
    if (container) {
      // Show success toast notification (stays longer for better visibility)
      toast.success(`Container ${container.name} upgraded successfully!`, 8000);

      // Refresh containers to get updated data (especially important after reconnection)
      if (fetchContainers) {
        fetchContainers();
      }
    }
  }, [upgradeModal.container, fetchContainers]);

  // Open batch upgrade modal
  const handleBatchUpgrade = useCallback(
    (selectedContainers, aggregatedContainers) => {
      if (selectedContainers.size === 0) {
        toast.warning("Please select at least one container to upgrade");
        return null;
      }

      const containersToUpgrade = aggregatedContainers.all.filter((c) =>
        selectedContainers.has(c.id)
      );

      setBatchUpgradeModal({
        isOpen: true,
        containers: containersToUpgrade,
      });

      return {
        containerCount: containersToUpgrade.length,
        containers: containersToUpgrade,
      };
    },
    []
  );

  // Close batch upgrade modal
  const closeBatchUpgradeModal = useCallback(() => {
    setBatchUpgradeModal({
      isOpen: false,
      containers: [],
    });
  }, []);

  // Execute batch upgrade (called by the modal)
  const executeBatchUpgrade = useCallback(
    async (setSelectedContainers) => {
      const containersToUpgrade = batchUpgradeModal.containers;
      if (!containersToUpgrade || containersToUpgrade.length === 0) {
        throw new Error("No containers to upgrade");
      }

      const upgradingState = {};
      containersToUpgrade.forEach((c) => {
        upgradingState[c.id] = true;
      });
      setUpgrading((prev) => ({ ...prev, ...upgradingState }));

      try {
        setBatchUpgrading(true);

        const response = await axios.post(`${API_BASE_URL}/api/containers/batch-upgrade`, {
          containers: containersToUpgrade.map((c) => ({
            containerId: c.id,
            endpointId: c.endpointId,
            imageName: c.image,
            containerName: c.name,
            portainerUrl: c.portainerUrl,
          })),
        });

        // Extract both old and new container IDs from results
        // After upgrade, containers get new IDs, so we need to track both
        const successfulIds = new Set();
        const successfulNewIds = new Set();
        const successfulNames = new Set();
        response.data.results?.forEach((r) => {
          if (r.containerId) {
            successfulIds.add(r.containerId);
            successfullyUpdatedContainersRef.current.add(r.containerId);
          }
          if (r.newContainerId) {
            successfulNewIds.add(r.newContainerId);
            successfullyUpdatedContainersRef.current.add(r.newContainerId);
          }
          if (r.containerName) {
            successfulNames.add(r.containerName);
          }
        });

        // Update local state immediately so UI reflects the change right away
        if (onContainersUpdate) {
          onContainersUpdate((prevContainers) =>
            prevContainers.map((c) => {
              // Match by old ID, new ID, or name
              const matchesId =
                successfulIds.has(c.id) ||
                successfulNewIds.has(c.id) ||
                Array.from(successfulIds).some(
                  (id) => c.id?.substring(0, 12) === id?.substring(0, 12)
                ) ||
                Array.from(successfulNewIds).some(
                  (id) => c.id?.substring(0, 12) === id?.substring(0, 12)
                );
              const matchesName = successfulNames.has(c.name);
              if (matchesId || matchesName) {
                return { ...c, hasUpdate: false };
              }
              return c;
            })
          );
        }

        if (setSelectedContainers) {
          setSelectedContainers((prev) => {
            const next = new Set(prev);
            successfulIds.forEach((id) => next.delete(id));
            successfulNewIds.forEach((id) => next.delete(id));
            return next;
          });
        }

        // Refresh from server to get updated data (cache is already updated on backend)
        if (fetchContainers) {
          fetchContainers();
        }

        // Return response for the modal to process
        return response;
      } catch (err) {
        // Error will be handled by the modal
        throw err;
      } finally {
        setBatchUpgrading(false);
        const clearedState = {};
        containersToUpgrade.forEach((c) => {
          clearedState[c.id] = false;
        });
        setUpgrading((prev) => ({ ...prev, ...clearedState }));
      }
    },
    [
      batchUpgradeModal.containers,
      successfullyUpdatedContainersRef,
      onContainersUpdate,
      fetchContainers,
    ]
  );

  // Handle batch upgrade success callback
  const handleBatchUpgradeSuccess = useCallback((response) => {
    const successCount = response.data?.results?.length || 0;
    const errorCount = response.data?.errors?.length || 0;

    if (errorCount === 0) {
      toast.success(`Batch upgrade completed! Successfully upgraded ${successCount} container(s).`);
    } else if (successCount > 0) {
      toast.success(`Successfully upgraded ${successCount} container(s).`);
    }
  }, []);

  return {
    upgrading,
    batchUpgrading,
    upgradeModal,
    closeUpgradeModal,
    executeUpgrade,
    handleUpgradeSuccess,
    handleUpgrade,
    batchUpgradeModal,
    closeBatchUpgradeModal,
    executeBatchUpgrade,
    handleBatchUpgradeSuccess,
    handleBatchUpgrade,
  };
};

