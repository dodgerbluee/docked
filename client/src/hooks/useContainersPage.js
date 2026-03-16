import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import {
  PORTAINER_CONTAINER_MESSAGE,
  BLOCKLISTED_CONTAINER_MESSAGE,
} from "../constants/containersPage";
import { formatBytes as formatBytesUtil } from "../utils/formatters";
import { useContainersTabs } from "./useContainersPage/hooks/useContainersTabs";
import { useSourceInstanceSelection } from "./useContainersPage/hooks/useSourceInstanceSelection";
import { useContainerSelection } from "./useContainersPage/hooks/useContainerSelection";
import { useImageSelection } from "./useContainersPage/hooks/useImageSelection";
import { useContainerUpgrade } from "./useContainersPage/hooks/useContainerUpgrade";
import { useImageDeletion } from "./useContainersPage/hooks/useImageDeletion";

/**
 * useContainersPage Hook
 * Manages all state and logic for the Sources page
 */
export function useContainersPage({
  sourceInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  containersBySource = {},
  loadingInstances = new Set(),
  dockerHubDataPulled = false,
  lastPullTime = null,
  successfullyUpdatedContainersRef,
  onContainersUpdate,
  onUnusedImagesUpdate,
  onUnusedImagesCountUpdate,
  fetchContainers,
  fetchUnusedImages,
  selectedSourceInstances: controlledSelectedSourceInstances,
  onSetSelectedSourceInstances,
  contentTab: controlledContentTab,
  onSetContentTab,
  /** When provided, use this instead of calling useContainerUpgrade (lifts state to parent for persistence across tab switch) */
  containerUpgradeFromProps = null,
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
  const { contentTab, setContentTab } = useContainersTabs({
    controlledContentTab,
    onSetContentTab,
  });

  const {
    selectedSourceInstances,
    setSelectedSourceInstances,
    sortedSourceInstances,
    instancesToShow,
  } = useSourceInstanceSelection({
    controlledSelectedSourceInstances,
    onSetSelectedSourceInstances,
    sourceInstances,
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
  } = useContainerSelection();

  const { selectedImages, setSelectedImages, handleToggleImageSelect } = useImageSelection();

  // Use extracted upgrade hook (or injected from parent when lifting state for tab persistence)
  const upgradeOperationsFromHook = useContainerUpgrade({
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    fetchContainers,
  });
  const upgradeOperations = containerUpgradeFromProps ?? upgradeOperationsFromHook;

  // Use extracted image deletion hook
  const imageDeletion = useImageDeletion({
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
      const sourceUrl = instance?.url;
      const sourceData = sourceUrl ? containersBySource[sourceUrl] : null;
      if (sourceData) {
        allContainersWithUpdates = allContainersWithUpdates.concat(sourceData.withUpdates || []);
        allContainersUpToDate = allContainersUpToDate.concat(sourceData.upToDate || []);
        allContainers = allContainers.concat(sourceData.containers || []);
      }
      if (sourceUrl && loadingInstances.has(sourceUrl)) {
        isLoading = true;
      }
    });

    return {
      withUpdates: allContainersWithUpdates,
      upToDate: allContainersUpToDate,
      all: allContainers,
      isLoading,
    };
  }, [instancesToShow, containersBySource, loadingInstances]);

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

  // Filter unused images for selected source instances
  const sourceUnusedImages = useMemo(() => {
    const selectedUrls = new Set(instancesToShow.map((inst) => inst?.url).filter(Boolean));
    return unusedImages.filter((img) => selectedUrls.has(img.sourceUrl));
  }, [instancesToShow, unusedImages]);

  // Fetch the upgrade blocklist so we can grey-out blocked containers
  const [blockedNames, setBlockedNames] = useState(new Set());
  const [defaultPatterns, setDefaultPatterns] = useState([]);
  const blockedFetched = useRef(false);

  useEffect(() => {
    if (blockedFetched.current) return;
    blockedFetched.current = true;
    axios
      .get(`${API_BASE_URL}/api/settings/disallowed-containers`)
      .then(({ data }) => {
        const list = data.containers;
        if (Array.isArray(list) && list.length > 0) {
          setBlockedNames(new Set(list.map((n) => n.toLowerCase())));
        } else if (list === null && Array.isArray(data.defaultPatterns)) {
          // Never saved — use default patterns for greying out infra containers
          setDefaultPatterns(data.defaultPatterns);
        }
      })
      .catch(() => {
        // Ignore — fallback to no blocklist
      });
  }, []);

  // Check if container is Portainer OR on the upgrade blocklist
  const isPortainerContainer = useCallback(
    (container) => {
      const imageName = container.image?.toLowerCase() || "";
      const containerName = container.name?.toLowerCase() || "";
      if (imageName.includes("portainer") || containerName.includes("portainer")) {
        return true;
      }
      if (blockedNames.has(containerName)) {
        return true;
      }
      // When no blocklist has been saved, apply default patterns
      if (defaultPatterns.length > 0) {
        return defaultPatterns.some((p) => containerName.includes(p) || imageName.includes(p));
      }
      return false;
    },
    [blockedNames, defaultPatterns]
  );

  // Return the appropriate disabled tooltip message for a container
  const getBlockedMessage = useCallback(
    (container) => {
      const imageName = container.image?.toLowerCase() || "";
      const containerName = container.name?.toLowerCase() || "";
      if (imageName.includes("portainer") || containerName.includes("portainer")) {
        return PORTAINER_CONTAINER_MESSAGE;
      }
      if (blockedNames.has(containerName)) {
        return BLOCKLISTED_CONTAINER_MESSAGE;
      }
      // When no blocklist has been saved, check default patterns
      if (defaultPatterns.length > 0) {
        if (defaultPatterns.some((p) => containerName.includes(p) || imageName.includes(p))) {
          return BLOCKLISTED_CONTAINER_MESSAGE;
        }
      }
      return undefined;
    },
    [blockedNames, defaultPatterns]
  );

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

  // Wrapper for handleDeleteImages that includes sourceUnusedImages
  const handleDeleteImages = useCallback(() => {
    return imageDeletion.handleDeleteImages(selectedImages, sourceUnusedImages);
  }, [imageDeletion, selectedImages, sourceUnusedImages]);

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
    selectedSourceInstances,
    setSelectedSourceInstances,
    collapsedStacks,
    collapsedUnusedImages,
    setCollapsedUnusedImages,
    selectedContainers,
    setSelectedContainers,
    selectedImages,
    upgrading: upgradeOperations.upgrading,
    batchUpgrading: upgradeOperations.batchUpgrading,
    deletingImages: imageDeletion.deletingImages,

    // Error modal
    errorModal,
    closeErrorModal,

    // Single upgrade: confirm dialog + progress banner
    upgradeConfirmContainer: upgradeOperations.upgradeConfirmContainer,
    closeUpgradeConfirm: upgradeOperations.closeUpgradeConfirm,
    confirmAndStartUpgrade: upgradeOperations.confirmAndStartUpgrade,
    activeUpgrades: upgradeOperations.activeUpgrades,
    dismissActiveUpgrade: upgradeOperations.dismissActiveUpgrade,

    // Batch upgrade: confirm dialog + progress banner (no modal)
    batchUpgradeConfirmContainers: upgradeOperations.batchUpgradeConfirmContainers,
    closeBatchUpgradeConfirm: upgradeOperations.closeBatchUpgradeConfirm,
    confirmAndStartBatchUpgrade: upgradeOperations.confirmAndStartBatchUpgrade,

    // Legacy
    upgradeModal: upgradeOperations.upgradeModal,
    closeUpgradeModal: upgradeOperations.closeUpgradeModal,
    executeUpgrade: upgradeOperations.executeUpgrade,
    handleUpgradeSuccess: upgradeOperations.handleUpgradeSuccess,
    batchUpgradeModal: upgradeOperations.batchUpgradeModal,
    closeBatchUpgradeModal: upgradeOperations.closeBatchUpgradeModal,
    executeBatchUpgrade,
    handleBatchUpgradeSuccess: upgradeOperations.handleBatchUpgradeSuccess,

    // Computed data
    sortedSourceInstances,
    instancesToShow,
    aggregatedContainers,
    groupedStacks,
    sourceUnusedImages,

    // Helpers
    isPortainerContainer,
    getBlockedMessage,
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
