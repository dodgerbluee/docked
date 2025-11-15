import { useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { formatBytes as formatBytesUtil } from "../utils/formatters";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";
import { toast } from "../utils/toast";

/**
 * usePortainerPage Hook
 * Manages all state and logic for the Portainer Instances page
 */
export function usePortainerPage({
  portainerInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  containersByPortainer = {},
  loadingInstances = new Set(),
  dockerHubDataPulled = false,
  lastPullTime = null,
  successfullyUpdatedContainersRef,
  onContainersUpdate,
  onUnusedImagesUpdate,
  onUnusedImagesCountUpdate,
  fetchContainers,
  fetchUnusedImages,
  selectedPortainerInstances: controlledSelectedPortainerInstances,
  onSetSelectedPortainerInstances,
  contentTab: controlledContentTab,
  onSetContentTab,
}) {
  // Error modal state
  const [errorModal, setErrorModal] = useState({
    isOpen: false,
    title: null,
    message: null,
    containerName: null,
    details: null,
  });
  // Content tab state - use controlled if setter is provided, otherwise use internal state
  const [internalContentTab, setInternalContentTab] = useState(PORTAINER_CONTENT_TABS.UPDATES);
  const isContentTabControlled = onSetContentTab !== undefined;
  const contentTab = isContentTabControlled
    ? controlledContentTab !== undefined
      ? controlledContentTab
      : PORTAINER_CONTENT_TABS.UPDATES
    : internalContentTab;

  const setContentTab = useCallback(
    (value) => {
      if (isContentTabControlled) {
        // If controlled, call the parent's setter
        onSetContentTab(value);
      } else {
        // If uncontrolled, use internal state
        if (typeof value === "function") {
          setInternalContentTab(value);
        } else {
          setInternalContentTab(value);
        }
      }
    },
    [isContentTabControlled, onSetContentTab]
  );

  // Instance filter state - use controlled if setter is provided, otherwise use internal state
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

  // Collapsed stacks state
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [collapsedUnusedImages, setCollapsedUnusedImages] = useState(false);

  // Selection state
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());

  // Action states
  const [upgrading, setUpgrading] = useState({});
  const [batchUpgrading, setBatchUpgrading] = useState(false);
  const [deletingImages, setDeletingImages] = useState(false);

  // Upgrade modal state
  const [upgradeModal, setUpgradeModal] = useState({
    isOpen: false,
    container: null,
  });

  // Batch upgrade modal state
  const [batchUpgradeModal, setBatchUpgradeModal] = useState({
    isOpen: false,
    containers: [],
  });

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

  // Aggregate containers from selected instances
  const aggregatedContainers = useMemo(() => {
    let allContainersWithUpdates = [];
    let allContainersUpToDate = [];
    let allContainers = [];
    let isLoading = false;

    instancesToShow.forEach((instance) => {
      const portainerUrl = instance?.url;
      const portainerData = portainerUrl ? containersByPortainer[portainerUrl] : null;
      if (portainerData) {
        allContainersWithUpdates = allContainersWithUpdates.concat(portainerData.withUpdates || []);
        allContainersUpToDate = allContainersUpToDate.concat(portainerData.upToDate || []);
        allContainers = allContainers.concat(portainerData.containers || []);
      }
      if (portainerUrl && loadingInstances.has(portainerUrl)) {
        isLoading = true;
      }
    });

    return {
      withUpdates: allContainersWithUpdates,
      upToDate: allContainersUpToDate,
      all: allContainers,
      isLoading,
    };
  }, [instancesToShow, containersByPortainer, loadingInstances]);

  // Group containers by stack
  const groupedStacks = useMemo(() => {
    const instanceStacks = aggregatedContainers.all.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    const groups = Object.keys(instanceStacks).map((stackName) => ({
      stackName: stackName,
      containers: instanceStacks[stackName],
    }));

    groups.sort((a, b) => {
      if (a.stackName === "Standalone") return 1;
      if (b.stackName === "Standalone") return -1;
      return a.stackName.localeCompare(b.stackName);
    });

    return groups;
  }, [aggregatedContainers.all]);

  // Filter unused images for selected portainers
  const portainerUnusedImages = useMemo(() => {
    const selectedUrls = new Set(instancesToShow.map((inst) => inst?.url).filter(Boolean));
    return unusedImages.filter((img) => selectedUrls.has(img.portainerUrl));
  }, [instancesToShow, unusedImages]);

  // Check if container is Portainer
  const isPortainerContainer = useCallback((container) => {
    const imageName = container.image?.toLowerCase() || "";
    const containerName = container.name?.toLowerCase() || "";
    return imageName.includes("portainer") || containerName.includes("portainer");
  }, []);

  // Toggle stack collapse
  const toggleStack = useCallback((stackKey) => {
    setCollapsedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(stackKey)) {
        next.delete(stackKey);
      } else {
        next.add(stackKey);
      }
      return next;
    });
  }, []);

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
    (containersToSelect) => {
      const selectableContainers = containersToSelect.filter((c) => !isPortainerContainer(c));
      const allSelected = selectableContainers.every((c) => selectedContainers.has(c.id));
      if (allSelected) {
        setSelectedContainers(new Set());
      } else {
        setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
      }
    },
    [isPortainerContainer, selectedContainers]
  );

  // Open upgrade modal
  const handleUpgrade = useCallback((container) => {
    setUpgradeModal({
      isOpen: true,
      container,
    });
  }, []);

  // Close upgrade modal
  const closeUpgradeModal = useCallback(() => {
    setUpgradeModal({
      isOpen: false,
      container: null,
    });
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

        setSelectedContainers((prev) => {
          const next = new Set(prev);
          next.delete(container.id);
          if (response.data.newContainerId) {
            next.delete(response.data.newContainerId);
          }
          return next;
        });

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
      const oldImage = container.image;
      // The new image info would come from the response, but we'll use the container's image
      toast.success(`Container ${container.name} upgraded successfully!`);

      // Refresh containers to get updated data (especially important after reconnection)
      if (fetchContainers) {
        fetchContainers();
      }
    }
  }, [upgradeModal.container, fetchContainers]);

  // Open batch upgrade modal
  const handleBatchUpgrade = useCallback(() => {
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
  }, [selectedContainers, aggregatedContainers.all]);

  // Close batch upgrade modal
  const closeBatchUpgradeModal = useCallback(() => {
    setBatchUpgradeModal({
      isOpen: false,
      containers: [],
    });
  }, []);

  // Execute batch upgrade (called by the modal)
  const executeBatchUpgrade = useCallback(async () => {
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

      setSelectedContainers((prev) => {
        const next = new Set(prev);
        successfulIds.forEach((id) => next.delete(id));
        successfulNewIds.forEach((id) => next.delete(id));
        return next;
      });

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
  }, [
    batchUpgradeModal.containers,
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    fetchContainers,
  ]);

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

  // Toggle image selection
  const handleToggleImageSelect = useCallback((imageId) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  // Delete single image
  // Returns image data for confirmation dialog
  const handleDeleteImage = useCallback((image) => {
    return {
      image,
      imageName: image.repoTags?.[0] || image.id,
    };
  }, []);

  // Execute delete after confirmation
  const executeDeleteImage = useCallback(
    async (image) => {
      try {
        setDeletingImages(true);
        const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
          images: [
            {
              id: image.id,
              portainerUrl: image.portainerUrl,
              endpointId: image.endpointId,
            },
          ],
        });

        if (response.data.success) {
          if (onUnusedImagesUpdate) {
            onUnusedImagesUpdate((prev) => prev.filter((img) => img.id !== image.id));
          }
          if (onUnusedImagesCountUpdate) {
            onUnusedImagesCountUpdate((prev) => Math.max(0, prev - 1));
          }
          setSelectedImages((prev) => {
            const next = new Set(prev);
            next.delete(image.id);
            return next;
          });
          toast.success(`Image ${image.repoTags?.[0] || image.id} deleted successfully.`);
          if (fetchContainers) {
            fetchContainers().catch(() => {});
          }
        } else {
          toast.error("Failed to delete image. Check console for details.");
          console.error("Delete errors:", response.data.errors);
        }
      } catch (err) {
        const errorMessage = err.response?.data?.error || err.message || "Unknown error";
        toast.error(`Failed to delete image: ${errorMessage}`);
        console.error("Error deleting image:", err);
      } finally {
        setDeletingImages(false);
      }
    },
    [onUnusedImagesUpdate, onUnusedImagesCountUpdate, fetchContainers]
  );

  // Delete multiple images
  // Returns data for confirmation dialog
  const handleDeleteImages = useCallback(() => {
    if (selectedImages.size === 0) {
      toast.warning("Please select at least one image to delete");
      return null;
    }
    return {
      count: selectedImages.size,
      images: portainerUnusedImages.filter((img) => selectedImages.has(img.id)),
    };
  }, [selectedImages, portainerUnusedImages]);

  // Execute batch delete after confirmation
  const executeDeleteImages = useCallback(
    async (imagesToDelete) => {
      try {
        setDeletingImages(true);

        const uniqueImages = [];
        const seenKeys = new Set();
        for (const img of imagesToDelete) {
          const key = `${img.id}-${img.portainerUrl}-${img.endpointId}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueImages.push(img);
          }
        }

        const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
          images: uniqueImages.map((img) => ({
            id: img.id,
            portainerUrl: img.portainerUrl,
            endpointId: img.endpointId,
          })),
        });

        if (response.data.success) {
          const deletedCount = response.data.deleted || uniqueImages.length;
          const deletedIds = new Set(uniqueImages.map((img) => img.id));

          if (onUnusedImagesUpdate) {
            onUnusedImagesUpdate((prev) => prev.filter((img) => !deletedIds.has(img.id)));
          }
          if (onUnusedImagesCountUpdate) {
            onUnusedImagesCountUpdate((prev) => Math.max(0, prev - deletedCount));
          }
          setSelectedImages((prev) => {
            const next = new Set(prev);
            deletedIds.forEach((id) => next.delete(id));
            return next;
          });
          toast.success(`Successfully deleted ${deletedCount} image(s).`);
          if (fetchContainers) {
            fetchContainers().catch(() => {});
          }
        } else {
          toast.error("Failed to delete images. Check console for details.");
          console.error("Delete errors:", response.data.errors);
        }
      } catch (err) {
        const errorMessage = err.response?.data?.error || err.message || "Unknown error";
        toast.error(`Failed to delete images: ${errorMessage}`);
        console.error("Error deleting images:", err);
      } finally {
        setDeletingImages(false);
      }
    },
    [onUnusedImagesUpdate, onUnusedImagesCountUpdate, fetchContainers]
  );

  const closeErrorModal = () => {
    setErrorModal({
      isOpen: false,
      title: null,
      message: null,
      containerName: null,
      details: null,
    });
  };

  return {
    // State
    contentTab,
    setContentTab,
    selectedPortainerInstances,
    setSelectedPortainerInstances,
    collapsedStacks,
    collapsedUnusedImages,
    setCollapsedUnusedImages,
    selectedContainers,
    selectedImages,
    upgrading,
    batchUpgrading,
    deletingImages,

    // Error modal
    errorModal,
    closeErrorModal,

    // Upgrade modal
    upgradeModal,
    closeUpgradeModal,
    executeUpgrade,
    handleUpgradeSuccess,

    // Batch upgrade modal
    batchUpgradeModal,
    closeBatchUpgradeModal,
    executeBatchUpgrade,
    handleBatchUpgradeSuccess,

    // Computed data
    sortedPortainerInstances,
    instancesToShow,
    aggregatedContainers,
    groupedStacks,
    portainerUnusedImages,

    // Helpers
    isPortainerContainer,
    formatBytes: formatBytesUtil,

    // Actions
    toggleStack,
    handleToggleSelect,
    handleSelectAll,
    handleUpgrade,
    handleBatchUpgrade,
    executeBatchUpgrade,
    handleToggleImageSelect,
    handleDeleteImage,
    executeDeleteImage,
    handleDeleteImages,
    executeDeleteImages,

    // Props pass-through
    dockerHubDataPulled,
    lastPullTime,
  };
}
