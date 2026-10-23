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

        if (data.success && !(data.errors || []).length) {
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
          // The mutation reports success=true even when the one image it was
          // aimed at could not be removed, so the per-image errors are the only
          // verdict that means anything here.
          const reason = data.errors?.[0]?.error || "unknown error";
          toast.error(`Failed to delete image: ${reason}`);
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
    // Only the images actually visible for the current source can be deleted,
    // so the confirmation has to count those. Counting the whole selection
    // promised more deletions than the request would carry whenever the user
    // had selected on one host and then filtered to another.
    const images = sourceUnusedImages.filter((img) => selectedImages.has(getImageKey(img)));
    if (images.length === 0) {
      toast.warning(
        "The selected images belong to a host that is not currently shown. Clear the filters and try again."
      );
      return null;
    }
    return { count: images.length, images };
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
          // Partial success is real: the server returns success=true with an
          // errors[] entry per image it could not remove. Removing every
          // selected row anyway hid those failures and left the local list
          // disagreeing with the registry.
          const failed = data.errors || [];
          // Image ids are only unique within one host, so a failure is matched
          // back to its row by (id, runnerId). Matching by id alone also dropped
          // a different runner's identical id from the list, as though a row
          // that had just been deleted had failed instead.
          const deleteKey = (id, runnerId) => `${String(id)}|${String(runnerId ?? "")}`;
          const failedKeys = new Set();
          const failedBareIds = new Set();
          failed.forEach((e) => {
            if (e.runnerId == null || e.runnerId === "") {
              // A failure row without a host falls back to id-only matching,
              // which is conservative: every row carrying that id is kept.
              failedBareIds.add(String(e.id));
            } else {
              failedKeys.add(deleteKey(e.id, e.runnerId));
            }
          });
          const deletedKeys = new Set(
            uniqueImages
              .filter(
                (img) =>
                  !failedKeys.has(deleteKey(img.id, img.runnerId)) &&
                  !failedBareIds.has(String(img.id))
              )
              .map((img) => getImageKey(img))
          );
          const deletedCount = deletedKeys.size;

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
          if (failed.length > 0) {
            const reason = failed[0]?.error || "unknown error";
            toast.warning(
              `Deleted ${deletedCount} image(s), ${failed.length} could not be deleted: ${reason}`
            );
          } else {
            toast.info(`Successfully deleted ${deletedCount} image(s).`);
          }
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
