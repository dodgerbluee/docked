/**
 * Hook for managing image deletion operations
 */

import { useState, useCallback } from "react";
import axios from "axios";
import { getImageKey } from "../../../utils/imageHelpers";
import { API_BASE_URL } from "../../../utils/api";
import { toast } from "../../../utils/toast";

/**
 * Hook to manage image deletion operations (single and batch)
 * @param {Object} options
 * @param {Function} options.onUnusedImagesUpdate - Callback to update unused images
 * @param {Function} options.onUnusedImagesCountUpdate - Callback to update unused images count
 * @param {Function} options.fetchUnusedImages - Function to refresh unused images
 * @param {Function} options.setSelectedImages - Function to update selected images
 * @returns {Object} Deletion state and handlers
 */
export const usePortainerImageDeletion = ({
  onUnusedImagesUpdate,
  onUnusedImagesCountUpdate,
  fetchUnusedImages,
  setSelectedImages,
}) => {
  const [deletingImages, setDeletingImages] = useState(false);

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
    [onUnusedImagesUpdate, onUnusedImagesCountUpdate, setSelectedImages]
  );

  // Delete multiple images
  // Returns data for confirmation dialog
  const handleDeleteImages = useCallback((selectedImages, portainerUnusedImages) => {
    if (selectedImages.size === 0) {
      toast.warning("Please select at least one image to delete");
      return null;
    }
    return {
      count: selectedImages.size,
      images: portainerUnusedImages.filter((img) => selectedImages.has(getImageKey(img))),
    };
  }, []);

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
