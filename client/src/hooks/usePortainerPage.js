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
    ? (controlledContentTab !== undefined ? controlledContentTab : PORTAINER_CONTENT_TABS.UPDATES)
    : internalContentTab;
  
  const setContentTab = useCallback((value) => {
    if (isContentTabControlled) {
      // If controlled, call the parent's setter
      onSetContentTab(value);
    } else {
      // If uncontrolled, use internal state
      if (typeof value === 'function') {
        setInternalContentTab(value);
      } else {
        setInternalContentTab(value);
      }
    }
  }, [isContentTabControlled, onSetContentTab]);
  
  // Instance filter state - use controlled if setter is provided, otherwise use internal state
  const [internalSelectedPortainerInstances, setInternalSelectedPortainerInstances] = useState(new Set());
  const isSelectedInstancesControlled = onSetSelectedPortainerInstances !== undefined;
  const selectedPortainerInstances = isSelectedInstancesControlled
    ? (controlledSelectedPortainerInstances !== undefined ? controlledSelectedPortainerInstances : new Set())
    : internalSelectedPortainerInstances;
  
  const setSelectedPortainerInstances = useCallback((value) => {
    if (isSelectedInstancesControlled) {
      // If controlled, call the parent's setter
      onSetSelectedPortainerInstances(value);
    } else {
      // If uncontrolled, use internal state
      if (typeof value === 'function') {
        setInternalSelectedPortainerInstances(value);
      } else {
        setInternalSelectedPortainerInstances(value);
      }
    }
  }, [isSelectedInstancesControlled, onSetSelectedPortainerInstances]);
  
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

  // Sort Portainer instances alphabetically
  const sortedPortainerInstances = useMemo(() => {
    return [...portainerInstances].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [portainerInstances]);

  // Get selected instances to show
  const instancesToShow = useMemo(() => {
    return selectedPortainerInstances.size > 0
      ? sortedPortainerInstances.filter((inst) => selectedPortainerInstances.has(inst.name))
      : sortedPortainerInstances;
  }, [selectedPortainerInstances, sortedPortainerInstances]);

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
    return (
      imageName.includes("portainer") || containerName.includes("portainer")
    );
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
  const handleSelectAll = useCallback((containersToSelect) => {
    const selectableContainers = containersToSelect.filter(
      (c) => !isPortainerContainer(c)
    );
    const allSelected = selectableContainers.every((c) =>
      selectedContainers.has(c.id)
    );
    if (allSelected) {
      setSelectedContainers(new Set());
    } else {
      setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
    }
  }, [isPortainerContainer, selectedContainers]);

  // Upgrade single container
  const handleUpgrade = useCallback(async (container) => {
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
        
        if (onContainersUpdate) {
          onContainersUpdate((prevContainers) =>
            prevContainers.map((c) =>
              c.id === container.id ? { ...c, hasUpdate: false } : c
            )
          );
        }
        
        setSelectedContainers((prev) => {
          const next = new Set(prev);
          next.delete(container.id);
          return next;
        });
        
        const oldImage = response.data.oldImage || container.image;
        const newImage = response.data.newImage || container.image;
        toast.success(
          `Container ${container.name} upgraded successfully! From: ${oldImage} To: ${newImage}`
        );
        
        if (fetchContainers) {
          fetchContainers();
        }
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || "Unknown error";
      const errorDetails = err.response?.data?.details || err.stack || null;
      
      // Show error modal instead of toast
      setErrorModal({
        isOpen: true,
        title: "Container Upgrade Failed",
        message: errorMessage,
        containerName: container.name,
        details: errorDetails,
      });
      
      console.error("Error upgrading container:", err);
    } finally {
      setUpgrading((prev) => ({ ...prev, [container.id]: false }));
    }
  }, [successfullyUpdatedContainersRef, onContainersUpdate, fetchContainers, setErrorModal]);

  // Batch upgrade - returns data for confirmation dialog
  const handleBatchUpgrade = useCallback(() => {
    if (selectedContainers.size === 0) {
      toast.warning("Please select at least one container to upgrade");
      return null;
    }

    const containersToUpgrade = aggregatedContainers.all.filter((c) =>
      selectedContainers.has(c.id)
    );

    return {
      containerCount: containersToUpgrade.length,
      containers: containersToUpgrade,
    };
  }, [selectedContainers, aggregatedContainers.all]);

  // Execute batch upgrade after confirmation
  const executeBatchUpgrade = useCallback(async (containersToUpgrade) => {
    const upgradingState = {};
    containersToUpgrade.forEach((c) => {
      upgradingState[c.id] = true;
    });
    setUpgrading((prev) => ({ ...prev, ...upgradingState }));

    try {
      setBatchUpgrading(true);

      const response = await axios.post(
        `${API_BASE_URL}/api/containers/batch-upgrade`,
        {
          containers: containersToUpgrade.map((c) => ({
            containerId: c.id,
            endpointId: c.endpointId,
            imageName: c.image,
            containerName: c.name,
            portainerUrl: c.portainerUrl,
          })),
        }
      );

      const successfulIds = new Set(
        response.data.results?.map((r) => r.containerId) || []
      );
      
      successfulIds.forEach((containerId) => {
        successfullyUpdatedContainersRef.current.add(containerId);
      });
      
      if (onContainersUpdate) {
        onContainersUpdate((prevContainers) =>
          prevContainers.map((c) =>
            successfulIds.has(c.id) ? { ...c, hasUpdate: false } : c
          )
        );
      }
      
      setSelectedContainers((prev) => {
        const next = new Set(prev);
        successfulIds.forEach((id) => next.delete(id));
        return next;
      });

      const successCount = response.data.results?.length || 0;
      const errorCount = response.data.errors?.length || 0;

      if (errorCount > 0) {
        // Show errors in modal
        const errorDetails = response.data.errors
          .map((err) => `${err.containerName}: ${err.error}`)
          .join("\n");
        const errorSummary = response.data.errors
          .map((err) => `${err.containerName}: ${err.error}`)
          .join(", ");
        
        setErrorModal({
          isOpen: true,
          title: "Batch Upgrade Completed with Errors",
          message: `${successCount} container(s) upgraded successfully, but ${errorCount} container(s) failed:\n\n${errorSummary}`,
          containerName: null, // Multiple containers, so no single name
          details: errorDetails,
        });
        
        // Still show success toast for successful ones
        if (successCount > 0) {
          toast.success(`Successfully upgraded ${successCount} container(s).`);
        }
      } else {
        toast.success(`Batch upgrade completed! Successfully upgraded ${successCount} container(s).`);
      }
      setSelectedContainers(new Set());

      if (fetchContainers) {
        fetchContainers();
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || "Unknown error";
      const errorDetails = err.response?.data?.details || err.stack || null;
      
      console.log("🔴 Setting error modal for batch upgrade failure:", { errorMessage, errorDetails });
      
      // Show error modal instead of toast
      setErrorModal({
        isOpen: true,
        title: "Batch Upgrade Failed",
        message: errorMessage,
        containerName: null, // Batch operation, no single container
        details: errorDetails,
      });
      
      console.error("Error in batch upgrade:", err);
    } finally {
      setBatchUpgrading(false);
      const clearedState = {};
      containersToUpgrade.forEach((c) => {
        clearedState[c.id] = false;
      });
      setUpgrading((prev) => ({ ...prev, ...clearedState }));
    }
  }, [successfullyUpdatedContainersRef, onContainersUpdate, fetchContainers, setErrorModal]);

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
  const executeDeleteImage = useCallback(async (image) => {

    try {
      setDeletingImages(true);
      const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
        images: [{
          id: image.id,
          portainerUrl: image.portainerUrl,
          endpointId: image.endpointId,
        }],
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
  }, [onUnusedImagesUpdate, onUnusedImagesCountUpdate, fetchContainers]);

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
  const executeDeleteImages = useCallback(async (imagesToDelete) => {
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
          onUnusedImagesUpdate((prev) =>
            prev.filter((img) => !deletedIds.has(img.id))
          );
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
  }, [onUnusedImagesUpdate, onUnusedImagesCountUpdate, fetchContainers]);

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

