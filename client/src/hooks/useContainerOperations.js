import { useState } from "react";
import { useContainerUpgrade } from "./useContainerOperations/hooks/useContainerUpgrade";
import { useContainerDeletion } from "./useContainerOperations/hooks/useContainerDeletion";
import { useContainerPull } from "./useContainerOperations/hooks/useContainerPull";
import { useContainerClear } from "./useContainerOperations/hooks/useContainerClear";

/**
 * Custom hook for container operations (upgrade, delete, clear, pull)
 * Handles all container-related actions and state management
 */
export const useContainerOperations = ({
  containers,
  unusedImages,
  setContainers,
  setStacks,
  setUnusedImages,
  setUnusedImagesCount,
  setSelectedContainers,
  setSelectedImages,
  setDockerHubDataPulled,
  setDataFetched,
  setError,
  setPulling,
  setPullSuccess,
  setPullError,
  setClearing: setClearingProp,
  setDeletingImages: setDeletingImagesProp,
  successfullyUpdatedContainersRef,
  fetchContainers,
  fetchUnusedImages,
  updateLastImageDeleteTime,
}) => {
  // Use local state if prop setters are not provided
  // eslint-disable-next-line no-unused-vars
  const [clearing, setClearing] = useState(false);
  const setClearingState = setClearingProp || setClearing;
  const setDeletingImagesState = setDeletingImagesProp || (() => {});

  // Use extracted hooks
  const { upgrading, batchUpgrading, handleUpgrade, handleBatchUpgrade } = useContainerUpgrade({
    containers,
    setContainers,
    setSelectedContainers,
    successfullyUpdatedContainersRef,
    fetchContainers,
  });

  const { deletingImages, handleDeleteImage, handleDeleteImages } = useContainerDeletion({
    unusedImages,
    setUnusedImages,
    setUnusedImagesCount,
    setSelectedImages,
    updateLastImageDeleteTime,
    setDeletingImagesProp: setDeletingImagesState,
  });

  const handlePull = useContainerPull({
    setPulling,
    setError,
    setPullError,
    setPullSuccess,
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setDockerHubDataPulled,
    setDataFetched,
    fetchUnusedImages,
    successfullyUpdatedContainersRef,
  });

  const handleClear = useContainerClear({
    setClearingState,
    setError,
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setUnusedImages,
    setSelectedContainers,
    setSelectedImages,
    setDockerHubDataPulled,
    setDataFetched,
    fetchContainers,
  });

  return {
    upgrading,
    batchUpgrading,
    handleUpgrade,
    handleBatchUpgrade,
    handleDeleteImage,
    handleDeleteImages,
    handleClear,
    handlePull,
    deletingImages,
  };
};
