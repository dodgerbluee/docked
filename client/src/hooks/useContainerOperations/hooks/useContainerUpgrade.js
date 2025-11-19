/**
 * Hook for container upgrade operations
 */

import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";
import { showUpgradeSuccess, showContainerError, formatBatchUpgradeMessage } from "../utils/containerErrorHandling";

/**
 * Hook for container upgrade operations
 * @param {Object} params - Parameters
 * @param {Array} params.containers - Containers array
 * @param {Function} params.setContainers - Set containers function
 * @param {Function} params.setSelectedContainers - Set selected containers function
 * @param {Object} params.successfullyUpdatedContainersRef - Ref for successfully updated containers
 * @param {Function} params.fetchContainers - Fetch containers function
 * @returns {Object} Upgrade state and handlers
 */
export const useContainerUpgrade = ({
  containers,
  setContainers,
  setSelectedContainers,
  successfullyUpdatedContainersRef,
  fetchContainers,
}) => {
  const [upgrading, setUpgrading] = useState({});
  const [batchUpgrading, setBatchUpgrading] = useState(false);

  const handleUpgrade = useCallback(
    async (container) => {
      try {
        setUpgrading((prev) => ({ ...prev, [container.id]: true }));
        const response = await axios.post(
          `${API_BASE_URL}/api/containers/${container.id}/upgrade`,
          {
            endpointId: container.endpointId,
            imageName: container.image,
            portainerUrl: container.portainerUrl,
          }
        );

        if (response.data.success) {
          successfullyUpdatedContainersRef.current.add(container.id);

          setContainers((prevContainers) =>
            prevContainers.map((c) => (c.id === container.id ? { ...c, hasUpdate: false } : c))
          );

          setSelectedContainers((prev) => {
            const next = new Set(prev);
            next.delete(container.id);
            return next;
          });

          const oldImage = response.data.oldImage || container.image;
          const newImage = response.data.newImage || container.image;
          showUpgradeSuccess(container.name, oldImage, newImage);

          fetchContainers();
        }
      } catch (err) {
        showContainerError("upgrade", container.name, err);
      } finally {
        setUpgrading((prev) => ({ ...prev, [container.id]: false }));
      }
    },
    [setContainers, setSelectedContainers, successfullyUpdatedContainersRef, fetchContainers]
  );

  const handleBatchUpgrade = useCallback(
    async (selectedContainers) => {
      if (selectedContainers.size === 0) {
        alert("Please select at least one container to upgrade");
        return;
      }

      const containersToUpgrade = containers.filter((c) => selectedContainers.has(c.id));

      if (!window.confirm(`Upgrade ${containersToUpgrade.length} selected container(s)?`)) {
        return;
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

        const successfulIds = new Set(response.data.results?.map((r) => r.containerId) || []);

        successfulIds.forEach((containerId) => {
          successfullyUpdatedContainersRef.current.add(containerId);
        });

        setContainers((prevContainers) =>
          prevContainers.map((c) => (successfulIds.has(c.id) ? { ...c, hasUpdate: false } : c))
        );

        setSelectedContainers((prev) => {
          const next = new Set(prev);
          successfulIds.forEach((id) => next.delete(id));
          return next;
        });

        const successCount = response.data.results?.length || 0;
        const errorCount = response.data.errors?.length || 0;

        const message = formatBatchUpgradeMessage(successCount, errorCount, response.data.errors || []);
        alert(message);
        setSelectedContainers(new Set());
        fetchContainers();
      } catch (err) {
        alert(`Batch upgrade failed: ${err.response?.data?.error || err.message}`);
        console.error("Error in batch upgrade:", err);
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
      containers,
      setContainers,
      setSelectedContainers,
      successfullyUpdatedContainersRef,
      fetchContainers,
    ]
  );

  return {
    upgrading,
    batchUpgrading,
    handleUpgrade,
    handleBatchUpgrade,
  };
};

