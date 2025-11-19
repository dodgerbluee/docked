/**
 * Hook for managing image selection
 */

import { useState, useCallback } from "react";

/**
 * Hook to manage image selection state
 * @returns {Object} Selection state and handlers
 */
export const usePortainerImageSelection = () => {
  const [selectedImages, setSelectedImages] = useState(new Set());

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

  return {
    selectedImages,
    setSelectedImages,
    handleToggleImageSelect,
  };
};
