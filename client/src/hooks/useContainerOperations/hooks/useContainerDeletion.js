/**
 * Hook for container image deletion operations
 */

import { useState, useCallback } from "react";
import { deleteImages } from "../../../graphql/imageOps";
import { showContainerError } from "../utils/containerErrorHandling";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";

/** Map an unused-image row to the deleteImages mutation payload contract
 *  (same shape as useContainersPage/hooks/useImageDeletion). */
const toDeletePayload = (image) => ({
  id: image.id,
  runnerId: image.runnerId,
});

/**
 * Hook for container image deletion operations
 * @param {Object} params - Parameters
 * @param {Array} params.unusedImages - Unused images array
 * @param {Function} params.setUnusedImages - Set unused images function
 * @param {Function} params.setUnusedImagesCount - Set unused images count function
 * @param {Function} params.setSelectedImages - Set selected images function
 * @param {Function} params.updateLastImageDeleteTime - Update last image delete time function
 * @param {Function} params.setDeletingImagesProp - Set deleting images prop function
 * @returns {Object} Deletion state and handlers
 */
export const useContainerDeletion = ({
  unusedImages,
  setUnusedImages,
  setUnusedImagesCount,
  setSelectedImages,
  updateLastImageDeleteTime,
  setDeletingImagesProp,
}) => {
  const [deletingImages, setDeletingImages] = useState(false);
  const setDeletingImagesState = setDeletingImagesProp || setDeletingImages;

  const handleDeleteImage = useCallback(
    async (image) => {
      // A login/logout mid-flight makes this completion belong to a dead
      // session: it must not filter the new session's image list, decrement
      // its counts, or raise an alert for it.
      const gen = getSessionGeneration();
      try {
        setDeletingImages(true);
        const data = await deleteImages([toDeletePayload(image)]);
        if (isSessionStale(gen)) return;

        if (data.success) {
          updateLastImageDeleteTime();
          setUnusedImages((prev) => prev.filter((img) => img.id !== image.id));
          setUnusedImagesCount((prev) => Math.max(0, prev - 1));
          setSelectedImages((prev) => {
            const next = new Set(prev);
            next.delete(image.id);
            return next;
          });
        } else {
          throw new Error(data.error || "image delete failed");
        }
      } catch (err) {
        if (isSessionStale(gen)) return;
        console.error("Error deleting image:", err);
        showContainerError("delete", "image", err);
      } finally {
        if (!isSessionStale(gen)) setDeletingImagesState(false);
      }
    },
    [
      setUnusedImages,
      setUnusedImagesCount,
      setSelectedImages,
      updateLastImageDeleteTime,
      setDeletingImagesState,
    ]
  );

  const handleDeleteImages = useCallback(
    async (selectedImages) => {
      if (selectedImages.size === 0) {
        alert("Please select at least one image to delete");
        return;
      }

      const imagesToDelete = Array.from(selectedImages)
        .map((id) => {
          const image = unusedImages.find((img) => img.id === id);
          return image;
        })
        .filter(Boolean);

      if (
        !window.confirm(
          `Delete ${imagesToDelete.length} selected image(s)? This action cannot be undone.`
        )
      ) {
        return;
      }

      const gen = getSessionGeneration();
      try {
        setDeletingImagesState(true);
        updateLastImageDeleteTime();

        const data = await deleteImages(imagesToDelete.map(toDeletePayload));
        if (isSessionStale(gen)) return;

        if (data.success) {
          const deletedIds = new Set(imagesToDelete.map((img) => img.id));
          setUnusedImages((prev) => prev.filter((img) => !deletedIds.has(img.id)));
          setUnusedImagesCount((prev) =>
            Math.max(0, prev - (data.deleted || imagesToDelete.length))
          );
          setSelectedImages(new Set());
        } else {
          throw new Error(data.error || "image delete failed");
        }
      } catch (err) {
        if (isSessionStale(gen)) return;
        console.error("Error deleting images:", err);
        showContainerError("delete", "image", err);
      } finally {
        if (!isSessionStale(gen)) setDeletingImagesState(false);
      }
    },
    [
      unusedImages,
      setUnusedImages,
      setUnusedImagesCount,
      setSelectedImages,
      updateLastImageDeleteTime,
      setDeletingImagesState,
    ]
  );

  return {
    deletingImages,
    handleDeleteImage,
    handleDeleteImages,
  };
};
