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

        if (data.success && !(data.errors || []).length) {
          updateLastImageDeleteTime();
          // Image ids repeat across runners, so the row is matched by host as
          // well as id; matching by id alone removed a different runner's
          // identical image from the list.
          setUnusedImages((prev) =>
            prev.filter((img) => !(img.id === image.id && img.runnerId === image.runnerId))
          );
          setUnusedImagesCount((prev) => Math.max(0, prev - 1));
          setSelectedImages((prev) => {
            const next = new Set(prev);
            next.delete(image.id);
            return next;
          });
        } else {
          // success=true is the transport verdict, not the per-image one: the
          // mutation reports it even when the delete itself failed.
          throw new Error(data.errors?.[0]?.error || data.error || "image delete failed");
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
          // Partial success is real: the mutation answers success=true with an
          // errors[] entry per image it could not remove. Dropping every
          // selected row anyway left the list disagreeing with the registry,
          // and matching by id alone also removed other runners' identical ids.
          const failed = data.errors || [];
          const deleteKey = (id, runnerId) => `${String(id)}|${String(runnerId ?? "")}`;
          const failedKeys = new Set();
          const failedBareIds = new Set();
          failed.forEach((e) => {
            if (e.runnerId == null || e.runnerId === "") failedBareIds.add(String(e.id));
            else failedKeys.add(deleteKey(e.id, e.runnerId));
          });
          const isFailure = (img) =>
            failedKeys.has(deleteKey(img.id, img.runnerId)) || failedBareIds.has(String(img.id));
          const deleted = imagesToDelete.filter((img) => !isFailure(img));
          const deletedKeys = new Set(deleted.map((img) => deleteKey(img.id, img.runnerId)));

          setUnusedImages((prev) => prev.filter((img) => !deletedKeys.has(deleteKey(img.id, img.runnerId))));
          setUnusedImagesCount((prev) => Math.max(0, prev - deletedKeys.size));
          setSelectedImages((prev) => {
            const next = new Set(prev);
            deleted.forEach((img) => next.delete(img.id));
            return next;
          });
          if (failed.length > 0) {
            console.error("Images that could not be deleted:", failed);
            alert(
              `Deleted ${deleted.length} image(s); ${failed.length} could not be deleted: ${failed[0]?.error || "unknown error"}`
            );
          }
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
