/**
 * Hook for managing image deletion operations
 */

import { useState, useCallback } from "react";
import { getImageKey } from "../../../utils/imageHelpers";
import { deleteImages } from "../../../graphql/imageOps";
import { toast } from "../../../utils/toast";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";

/**
 * Hook to manage image deletion operations (single and batch)
 * @param {Object} options
 * @param {Function} options.onUnusedImagesUpdate - Callback to update unused images
 * @param {Function} options.onUnusedImagesCountUpdate - Callback to update unused images count
 * @param {Function} options.fetchUnusedImages - Function to refresh unused images
 * @param {Function} options.setSelectedImages - Function to update selected images
 * @returns {Object} Deletion state and handlers
 */
export const useImageDeletion = ({
  onUnusedImagesUpdate,
  onUnusedImagesCountUpdate,
  fetchUnusedImages,
  setSelectedImages,
}) => {
  const [deletingImages, setDeletingImages] = useState(false);

  // Delete single image
  // Returns image data for confirmation dialog
  const handleDeleteImage = useCallback((image) => {
    const firstTag = image.repoTags?.[0];
    const imageName = firstTag ? firstTag.replace(/:<none>$/, "") : "<none>";
    return { image, imageName };
  }, []);

  // Execute delete after confirmation
  const executeDeleteImage = useCallback(
    async (image) => {
      // A login/logout mid-flight makes this completion belong to a dead
      // session: it must not mutate the new session's image list/counts or
      // toast for it (the deleted image may not even exist in the new list).
      const gen = getSessionGeneration();
      try {
        setDeletingImages(true);
        const data = await deleteImages([
          {
            id: image.id,
            runnerId: image.runnerId,
          },
        ]);
        if (isSessionStale(gen)) return;

        if (data.success) {
          const imageKey = getImageKey(image);
          if (onUnusedImagesUpdate) {
            onUnusedImagesUpdate((prev) => prev.filter((img) => getImageKey(img) !== imageKey));
          }
          if (onUnusedImagesCountUpdate) {
            onUnusedImagesCountUpdate((prev) => Math.max(0, prev - 1));
          }
          if (setSelectedImages) {
            setSelectedImages((prev) => {
              const next = new Set(prev);
              next.delete(imageKey);
              return next;
            });
          }
          toast.info(`Image ${image.repoTags?.[0] || image.id} deleted successfully.`);
          // Don't refetch: optimistic update already removed the image; refetch can re-add it if server is stale
        } else {
          toast.error("Failed to delete image. Check console for details.");
          console.error("Delete errors:", data.errors);
        }
      } catch (err) {
        if (isSessionStale(gen)) return;
        const errorMessage = err.response?.data?.error || err.message || "Unknown error";
        toast.error(`Failed to delete image: ${errorMessage}`);
        console.error("Error deleting image:", err);
      } finally {
        if (!isSessionStale(gen)) setDeletingImages(false);
      }
    },
    [onUnusedImagesUpdate, onUnusedImagesCountUpdate, setSelectedImages]
  );

  // Delete multiple images
  // Returns data for confirmation dialog
  const handleDeleteImages = useCallback((selectedImages, sourceUnusedImages) => {
    if (selectedImages.size === 0) {
      toast.warning("Please select at least one image to delete");
      return null;
    }
    return {
      count: selectedImages.size,
      images: sourceUnusedImages.filter((img) => selectedImages.has(getImageKey(img))),
    };
  }, []);

  // Execute batch delete after confirmation
  const executeDeleteImages = useCallback(
    async (imagesToDelete) => {
      // Same session-staleness guard as executeDeleteImage: a completion from
      // a dead session must not filter the new session's list, decrement its
      // count, or toast.
      const gen = getSessionGeneration();
      try {
        setDeletingImages(true);

        const uniqueImages = [];
        const seenKeys = new Set();
        for (const img of imagesToDelete) {
          const key = `${img.id}-${img.runnerId}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueImages.push(img);
          }
        }

        const data = await deleteImages(
          uniqueImages.map((img) => ({
            id: img.id,
            runnerId: img.runnerId,
          }))
        );
        if (isSessionStale(gen)) return;

        if (data.success) {
          const deletedCount = data.deleted || uniqueImages.length;
          const deletedKeys = new Set(uniqueImages.map((img) => getImageKey(img)));

          if (onUnusedImagesUpdate) {
            onUnusedImagesUpdate((prev) =>
              prev.filter((img) => !deletedKeys.has(getImageKey(img)))
            );
          }
          if (onUnusedImagesCountUpdate) {
            onUnusedImagesCountUpdate((prev) => Math.max(0, prev - deletedCount));
          }
          if (setSelectedImages) {
            setSelectedImages((prev) => {
              const next = new Set(prev);
              deletedKeys.forEach((key) => next.delete(key));
              return next;
            });
          }
          toast.info(`Successfully deleted ${deletedCount} image(s).`);
          // Don't refetch: optimistic update already removed the images; refetch can re-add them if server is stale
        } else {
          toast.error("Failed to delete images. Check console for details.");
          console.error("Delete errors:", data.errors);
        }
      } catch (err) {
        if (isSessionStale(gen)) return;
        const errorMessage = err.response?.data?.error || err.message || "Unknown error";
        toast.error(`Failed to delete images: ${errorMessage}`);
        console.error("Error deleting images:", err);
      } finally {
        if (!isSessionStale(gen)) setDeletingImages(false);
      }
    },
    [onUnusedImagesUpdate, onUnusedImagesCountUpdate, setSelectedImages]
  );

  return {
    deletingImages,
    handleDeleteImage,
    executeDeleteImage,
    handleDeleteImages,
    executeDeleteImages,
  };
};
