import { useState, useCallback, useMemo } from "react";
import { formatBytes as formatBytesUtil } from "../utils/formatters";
import { usePortainerTabs } from "./usePortainerPage/hooks/usePortainerTabs";
import { usePortainerInstanceSelection } from "./usePortainerPage/hooks/usePortainerInstanceSelection";
import { usePortainerContainerSelection } from "./usePortainerPage/hooks/usePortainerContainerSelection";
import { usePortainerImageSelection } from "./usePortainerPage/hooks/usePortainerImageSelection";
import { usePortainerUpgrade } from "./usePortainerPage/hooks/usePortainerUpgrade";
import { usePortainerImageDeletion } from "./usePortainerPage/hooks/usePortainerImageDeletion";

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

  // Use extracted hooks
  const { contentTab, setContentTab } = usePortainerTabs({
    controlledContentTab,
    onSetContentTab,
  });

  const {
    selectedPortainerInstances,
    setSelectedPortainerInstances,
    sortedPortainerInstances,
    instancesToShow,
  } = usePortainerInstanceSelection({
    controlledSelectedPortainerInstances,
    onSetSelectedPortainerInstances,
    portainerInstances,
  });

  // Collapsed stacks state
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [collapsedUnusedImages, setCollapsedUnusedImages] = useState(false);

  // Use extracted selection hooks
  const {
    selectedContainers,
    setSelectedContainers,
    handleToggleSelect,
    handleSelectAll: handleSelectAllContainers,
  } = usePortainerContainerSelection();

  const { selectedImages, setSelectedImages, handleToggleImageSelect } =
    usePortainerImageSelection();

  // Use extracted upgrade hook
  const upgradeOperations = usePortainerUpgrade({
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    fetchContainers,
  });

  // Use extracted image deletion hook
  const imageDeletion = usePortainerImageDeletion({
    onUnusedImagesUpdate,
    onUnusedImagesCountUpdate,
    fetchUnusedImages,
    setSelectedImages,
  });

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

  // Wrapper for handleSelectAll that includes isPortainerContainer
  const handleSelectAll = useCallback(
    (containersToSelect) => {
      handleSelectAllContainers(containersToSelect, isPortainerContainer);
    },
    [handleSelectAllContainers, isPortainerContainer]
  );

  // Wrapper for handleBatchUpgrade that includes aggregatedContainers
  const handleBatchUpgrade = useCallback(() => {
    return upgradeOperations.handleBatchUpgrade(selectedContainers, aggregatedContainers);
  }, [upgradeOperations, selectedContainers, aggregatedContainers]);

  // Wrapper for executeBatchUpgrade that includes setSelectedContainers
  const executeBatchUpgrade = useCallback(async () => {
    return upgradeOperations.executeBatchUpgrade(setSelectedContainers);
  }, [upgradeOperations, setSelectedContainers]);

  // Wrapper for handleDeleteImages that includes portainerUnusedImages
  const handleDeleteImages = useCallback(() => {
    return imageDeletion.handleDeleteImages(selectedImages, portainerUnusedImages);
  }, [imageDeletion, selectedImages, portainerUnusedImages]);

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
    upgrading: upgradeOperations.upgrading,
    batchUpgrading: upgradeOperations.batchUpgrading,
    deletingImages: imageDeletion.deletingImages,

    // Error modal
    errorModal,
    closeErrorModal,

    // Upgrade modal
    upgradeModal: upgradeOperations.upgradeModal,
    closeUpgradeModal: upgradeOperations.closeUpgradeModal,
    executeUpgrade: upgradeOperations.executeUpgrade,
    handleUpgradeSuccess: upgradeOperations.handleUpgradeSuccess,

    // Batch upgrade modal
    batchUpgradeModal: upgradeOperations.batchUpgradeModal,
    closeBatchUpgradeModal: upgradeOperations.closeBatchUpgradeModal,
    executeBatchUpgrade,
    handleBatchUpgradeSuccess: upgradeOperations.handleBatchUpgradeSuccess,

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
    handleUpgrade: upgradeOperations.handleUpgrade,
    handleBatchUpgrade,
    handleToggleImageSelect,
    handleDeleteImage: imageDeletion.handleDeleteImage,
    executeDeleteImage: imageDeletion.executeDeleteImage,
    handleDeleteImages,
    executeDeleteImages: imageDeletion.executeDeleteImages,

    // Props pass-through
    dockerHubDataPulled,
    lastPullTime,
  };
}
