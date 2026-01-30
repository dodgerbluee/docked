/**
 * Hook for managing container upgrade operations
 */

import { useState, useCallback, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { toast } from "../../../utils/toast";
import { getUpgradeSteps } from "../../../utils/upgradeSteps";
import { TIMING } from "../../../constants/timing";

/** Auto-dismiss completed (success/error) items after this many ms (10 min) */
const COMPLETED_AUTO_DISMISS_MS = 10 * 60 * 1000;

/**
 * @typedef {Object} ActiveUpgrade
 * @property {string} key - Unique key for the upgrade (e.g. containerId-timestamp)
 * @property {Object} container - Container object
 * @property {'in_progress'|'success'|'error'} status
 * @property {number} currentStep - Current step index
 * @property {Array<{ label: string, duration: number }>} steps
 * @property {string|null} errorMessage
 * @property {number} [completedAt] - Timestamp when status became success/error (for auto-dismiss)
 */

/**
 * Hook to manage container upgrade operations (single and batch)
 * Single upgrades use a banner above the body; batch upgrades keep the modal.
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
  const [upgradeConfirmContainer, setUpgradeConfirmContainer] = useState(null);
  const [activeUpgrades, setActiveUpgrades] = useState(/** @type {ActiveUpgrade[]} */ ([]));
  const [upgradeModal, setUpgradeModal] = useState({
    isOpen: false,
    container: null,
  });
  const [batchUpgradeModal, setBatchUpgradeModal] = useState({
    isOpen: false,
    containers: [],
  });
  // Batch: show confirm dialog, then add each container to banner (no modal)
  const [batchUpgradeConfirmContainers, setBatchUpgradeConfirmContainers] = useState([]);

  // Dismiss a single upgrade from the section (by key). Only completed items are dismissible.
  const dismissActiveUpgrade = useCallback((key) => {
    setActiveUpgrades((prev) => prev.filter((a) => a.key !== key));
  }, []);

  // Auto-dismiss completed (success/error) items after 10 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      setActiveUpgrades((prev) =>
        prev.filter((a) => {
          if (a.status !== "success" && a.status !== "error") return true;
          if (!a.completedAt) return true;
          return now - a.completedAt < COMPLETED_AUTO_DISMISS_MS;
        })
      );
    }, 60 * 1000); // check every minute
    return () => clearInterval(intervalId);
  }, []);

  // Open upgrade confirm (single container) – shows confirm dialog, then banner
  const handleUpgrade = useCallback((container) => {
    setUpgradeConfirmContainer(container);
  }, []);

  const closeUpgradeConfirm = useCallback(() => {
    setUpgradeConfirmContainer(null);
  }, []);

  // Execute upgrade API call for a given container (shared logic)
  const executeUpgradeForContainer = useCallback(
    async (container) => {
      setUpgrading((prev) => ({ ...prev, [container.id]: true }));
      try {
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
          if (response.data.newContainerId) {
            successfullyUpdatedContainersRef.current.add(response.data.newContainerId);
          }
          if (onContainersUpdate) {
            onContainersUpdate((prevContainers) =>
              prevContainers.map((c) => {
                const matchesId =
                  c.id === container.id ||
                  c.id === response.data.newContainerId ||
                  c.id?.substring(0, 12) === container.id?.substring(0, 12) ||
                  (response.data.newContainerId &&
                    c.id?.substring(0, 12) ===
                      response.data.newContainerId?.substring(0, 12));
                const matchesName = c.name === container.name;
                if (matchesId || matchesName) return { ...c, hasUpdate: false };
                return c;
              })
            );
          }
          if (fetchContainers) fetchContainers();
        }
        return response;
      } finally {
        setUpgrading((prev) => ({ ...prev, [container.id]: false }));
      }
    },
    [successfullyUpdatedContainersRef, onContainersUpdate, fetchContainers]
  );

  // Run upgrade in banner (add to list + step progress + API). Used by single confirm and batch.
  const startUpgrade = useCallback(
    async (container) => {
      if (!container) return;
      const key = `${container.id}-${Date.now()}`;
      const steps = getUpgradeSteps(container);
      const containerName = container.name;

      setActiveUpgrades((prev) => [
        ...prev,
        {
          key,
          container,
          status: "in_progress",
          currentStep: 0,
          steps,
          errorMessage: null,
        },
      ]);

      await new Promise((r) => setTimeout(r, TIMING.INITIAL_RENDER_DELAY));

      const isNginx =
        containerName?.toLowerCase().includes("nginx-proxy-manager") ||
        containerName?.toLowerCase().includes("npm") ||
        container.image?.toLowerCase().includes("nginx-proxy-manager");

      const updateActive = (patch) => {
        setActiveUpgrades((prev) =>
          prev.map((a) => (a.key === key ? { ...a, ...patch } : a))
        );
      };

      const apiPromise = executeUpgradeForContainer(container);
      const apiCompletedRef = { current: false };
      let apiError = null;
      apiPromise.catch((err) => {
        apiCompletedRef.current = true;
        apiError = err;
      });

      for (let i = 0; i < steps.length; i++) {
        updateActive({ currentStep: i });
        const stepDuration = steps[i].duration;
        const minStep = TIMING.MIN_STEP_DURATION;
        const stepStart = Date.now();
        await new Promise((resolve) => {
          const id = setInterval(() => {
            const elapsed = Date.now() - stepStart;
            if (elapsed < minStep) return;
            if (apiCompletedRef.current || elapsed >= stepDuration) {
              clearInterval(id);
              resolve();
            }
          }, 100);
        });
      }
      updateActive({ currentStep: steps.length - 1 });
      await new Promise((r) => setTimeout(r, TIMING.FINAL_STEP_DELAY));

      try {
        await apiPromise;
        updateActive({ status: "success", completedAt: Date.now() });
        toast.success(`Container ${containerName} upgraded successfully!`, 8000);
        if (fetchContainers) fetchContainers();
      } catch (err) {
        if (apiError && isNginx) {
          const isNetworkError =
            apiError.code === "ECONNREFUSED" ||
            apiError.code === "ETIMEDOUT" ||
            apiError.code === "ERR_NETWORK" ||
            apiError.message?.includes("Network Error") ||
            apiError.message?.includes("Failed to fetch") ||
            !apiError.response;
          if (isNetworkError) {
            const maxWait = TIMING.RECONNECT_MAX_WAIT;
            const pollInterval = TIMING.RECONNECT_POLL_INTERVAL;
            const start = Date.now();
            while (Date.now() - start < maxWait) {
              await new Promise((r) => setTimeout(r, pollInterval));
              try {
                const res = await axios.get(
                  `${API_BASE_URL}/api/containers?portainerOnly=true`
                );
                let list = [];
                if (res.data?.grouped && res.data?.containers) list = res.data.containers;
                else if (Array.isArray(res.data)) list = res.data;
                else if (Array.isArray(res.data?.containers)) list = res.data.containers;
                const found = list.find(
                  (c) => c.name === containerName || c.name === container?.name
                );
                if (found) {
                  updateActive({ status: "success", completedAt: Date.now() });
                  toast.success(`Container ${containerName} upgraded successfully!`, 8000);
                  if (fetchContainers) fetchContainers();
                  return;
                }
              } catch {
                // keep polling
              }
            }
            updateActive({
              status: "error",
              errorMessage:
                "Upgrade may have completed, but we couldn't verify. Refresh the page to check.",
              completedAt: Date.now(),
            });
            return;
          }
        }
        updateActive({
          status: "error",
          errorMessage:
            err.response?.data?.error || err.message || "Unknown error occurred",
          completedAt: Date.now(),
        });
      }
    },
    [executeUpgradeForContainer, fetchContainers]
  );

  // Confirm single upgrade and start it (close confirm dialog, then run in banner)
  const confirmAndStartUpgrade = useCallback(
    async (container) => {
      if (!container) return;
      closeUpgradeConfirm();
      await startUpgrade(container);
    },
    [closeUpgradeConfirm, startUpgrade]
  );

  // Legacy: execute upgrade used by modal (kept for batch or any remaining modal usage)
  const executeUpgrade = useCallback(async () => {
    const container = upgradeModal.container;
    if (!container) return;
    return executeUpgradeForContainer(container);
  }, [upgradeModal.container, executeUpgradeForContainer]);

  // Legacy: close upgrade modal (no longer used for single upgrade; keep for API compat)
  const closeUpgradeModal = useCallback(() => {
    setUpgradeModal((prev) => ({ ...prev, isOpen: false, container: prev.container }));
  }, []);

  const handleUpgradeSuccess = useCallback(
    (container) => {
      if (container) {
        toast.success(`Container ${container.name} upgraded successfully!`, 8000);
        if (fetchContainers) fetchContainers();
      }
    },
    [fetchContainers]
  );

  // Open batch upgrade confirm (show "Upgrade N containers?" then add each to banner)
  const handleBatchUpgrade = useCallback((selectedContainers, aggregatedContainers) => {
    if (selectedContainers.size === 0) {
      toast.warning("Please select at least one container to upgrade");
      return null;
    }

    const containersToUpgrade = aggregatedContainers.all.filter((c) =>
      selectedContainers.has(c.id)
    );

    setBatchUpgradeConfirmContainers(containersToUpgrade);

    return {
      containerCount: containersToUpgrade.length,
      containers: containersToUpgrade,
    };
  }, []);

  const closeBatchUpgradeConfirm = useCallback(() => {
    setBatchUpgradeConfirmContainers([]);
  }, []);

  // Legacy: close batch modal (no longer used; kept for return API compat)
  const closeBatchUpgradeModal = useCallback(() => {
    setBatchUpgradeModal({ isOpen: false, containers: [] });
  }, []);

  // Confirm batch: clear selection, add each container to section and run upgrades SEQUENTIALLY.
  // Related containers (e.g. Immich app + redis + ML) must be upgraded one after another so
  // dependencies (e.g. redis) are up before the app starts; parallel upgrades can let the app
  // pass readiness then exit when redis isn't ready yet.
  const confirmAndStartBatchUpgrade = useCallback(
    async (containersToUpgrade, setSelectedContainers) => {
      if (!containersToUpgrade?.length) return;
      setBatchUpgradeConfirmContainers([]);
      if (setSelectedContainers) {
        setSelectedContainers(new Set());
      }
      for (const container of containersToUpgrade) {
        await startUpgrade(container);
      }
    },
    [startUpgrade]
  );

  // Legacy: execute batch upgrade (kept for API compat; no longer used by UI)
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
  const handleBatchUpgradeSuccess = useCallback(
    (response) => {
      const successCount = response.data?.results?.length || 0;
      const errorCount = response.data?.errors?.length || 0;

      // Extract successfully upgraded container names and IDs for filtering
      const successfulContainerNames = new Set();
      const successfulContainerIds = new Set();
      const successfulNewContainerIds = new Set();

      response.data?.results?.forEach((r) => {
        if (r.containerName) {
          successfulContainerNames.add(r.containerName);
        }
        if (r.containerId) {
          successfulContainerIds.add(r.containerId);
        }
        if (r.newContainerId) {
          successfulNewContainerIds.add(r.newContainerId);
        }
      });

      // Remove successfully upgraded containers from the page
      // Match by name (which stays the same) or by old/new container IDs
      // This ensures containers are removed from the UI when the modal closes, similar to single upgrades
      if (
        onContainersUpdate &&
        (successfulContainerNames.size > 0 ||
          successfulContainerIds.size > 0 ||
          successfulNewContainerIds.size > 0)
      ) {
        onContainersUpdate((prevContainers) =>
          prevContainers.filter((c) => {
            // Check if this container was successfully upgraded
            const matchesName = successfulContainerNames.has(c.name);
            const matchesOldId = successfulContainerIds.has(c.id);
            const matchesNewId = successfulNewContainerIds.has(c.id);
            const matchesIdPrefix =
              Array.from(successfulContainerIds).some(
                (id) => c.id?.substring(0, 12) === id?.substring(0, 12)
              ) ||
              Array.from(successfulNewContainerIds).some(
                (id) => c.id?.substring(0, 12) === id?.substring(0, 12)
              );

            // Filter out successfully upgraded containers (they'll reappear with new IDs after refresh)
            return !(matchesName || matchesOldId || matchesNewId || matchesIdPrefix);
          })
        );
      }

      if (errorCount === 0) {
        toast.success(
          `Batch upgrade completed! Successfully upgraded ${successCount} container(s).`
        );
      } else if (successCount > 0) {
        toast.success(`Successfully upgraded ${successCount} container(s).`);
      }
    },
    [onContainersUpdate]
  );

  return {
    upgrading,
    batchUpgrading,
    upgradeConfirmContainer,
    closeUpgradeConfirm,
    confirmAndStartUpgrade,
    startUpgrade,
    activeUpgrades,
    dismissActiveUpgrade,
    batchUpgradeConfirmContainers,
    closeBatchUpgradeConfirm,
    confirmAndStartBatchUpgrade,
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
