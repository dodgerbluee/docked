/**
 * Hook for container image deletion operations
 */

import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../constants/api";
import { showContainerError } from "../utils/containerErrorHandling";

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
      try {
        setDeletingImages(true);
        const response = await axios.delete(`${API_BASE_URL}/api/images/${image.id}`, {
          data: {
            portainerUrl: image.portainerUrl,
          },
        });

        if (response.data.success) {
          updateLastImageDeleteTime();
          setUnusedImages((prev) => prev.filter((img) => img.id !== image.id));
          setUnusedImagesCount((prev) => Math.max(0, prev - 1));
          setSelectedImages((prev) => {
            const next = new Set(prev);
            next.delete(image.id);
            return next;
          });
        }
      } catch (err) {
        console.error("Error deleting image:", err);
        showContainerError("delete", "image", err);
      } finally {
        setDeletingImagesState(false);
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

      try {
        setDeletingImagesState(true);
        updateLastImageDeleteTime();

        const deletePromises = imagesToDelete.map((image) =>
          axios.delete(`${API_BASE_URL}/api/images/${image.id}`, {
            data: {
              portainerUrl: image.portainerUrl,
            },
          })
        );

        const results = await Promise.allSettled(deletePromises);
        const successful = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r) => r.status === "rejected");

        if (successful.length > 0) {
          const deletedIds = new Set(successful.map((r, idx) => imagesToDelete[idx].id));
          setUnusedImages((prev) => prev.filter((img) => !deletedIds.has(img.id)));
          setUnusedImagesCount((prev) => Math.max(0, prev - successful.length));
          setSelectedImages(new Set());
        }

        if (failed.length > 0) {
          alert(`Failed to delete ${failed.length} image(s). Please try again.`);
        }
      } catch (err) {
        console.error("Error deleting images:", err);
      } finally {
        setDeletingImagesState(false);
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
