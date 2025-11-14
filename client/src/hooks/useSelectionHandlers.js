import { useCallback } from "react";
import { isPortainerContainer } from "../utils/containerHelpers";

/**
 * Custom hook for selection handlers (containers and images)
 * Provides reusable selection logic for UI components
 */
export const useSelectionHandlers = ({
  selectedContainers,
  setSelectedContainers,
  selectedImages,
  setSelectedImages,
  unusedImages = [],
}) => {
  const handleToggleSelect = useCallback(
    (containerId) => {
      setSelectedContainers((prev) => {
        const next = new Set(prev);
        if (next.has(containerId)) {
          next.delete(containerId);
        } else {
          next.add(containerId);
        }
        return next;
      });
    },
    [setSelectedContainers]
  );

  const handleSelectAll = useCallback(
    (containersToSelect) => {
      const selectableContainers = containersToSelect.filter(
        (c) => !isPortainerContainer(c)
      );
      const allSelected = selectableContainers.every((c) =>
        selectedContainers.has(c.id)
      );
      if (allSelected) {
        setSelectedContainers(new Set());
      } else {
        setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
      }
    },
    [selectedContainers, setSelectedContainers]
  );

  const handleToggleStackSelect = useCallback(
    (e, containersInStack) => {
      e.stopPropagation();
      const selectableContainers = containersInStack.filter(
        (c) => !isPortainerContainer(c) && c.hasUpdate
      );
      if (selectableContainers.length === 0) return;

      const allSelected = selectableContainers.every((c) =>
        selectedContainers.has(c.id)
      );

      setSelectedContainers((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          selectableContainers.forEach((c) => next.delete(c.id));
        } else {
          selectableContainers.forEach((c) => next.add(c.id));
        }
        return next;
      });
    },
    [selectedContainers, setSelectedContainers]
  );

  const handleToggleImageSelect = useCallback(
    (imageId) => {
      setSelectedImages((prev) => {
        const next = new Set(prev);
        if (next.has(imageId)) {
          next.delete(imageId);
        } else {
          next.add(imageId);
        }
        return next;
      });
    },
    [setSelectedImages]
  );

  const handleSelectAllImages = useCallback(() => {
    if (selectedImages.size === unusedImages.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(unusedImages.map((img) => img.id)));
    }
  }, [selectedImages.size, unusedImages, setSelectedImages]);

  return {
    handleToggleSelect,
    handleSelectAll,
    handleToggleStackSelect,
    handleToggleImageSelect,
    handleSelectAllImages,
  };
};

