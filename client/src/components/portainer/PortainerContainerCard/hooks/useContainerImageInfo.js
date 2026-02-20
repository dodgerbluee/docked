/**
 * Hook for managing container image information and URLs
 */

import { useMemo, useCallback } from "react";
import { extractVersion, extractImageName } from "../utils/containerImageParsing";
import { showToast } from "../../../../utils/toast";

/**
 * Hook to manage container image information
 * @param {Object} container - Container object
 * @returns {Object} Image info and handlers
 */
export const useContainerImageInfo = (container) => {
  const imageVersion = useMemo(() => extractVersion(container.image), [container.image]);
  const imageNameWithoutVersion = useMemo(
    () => extractImageName(container.image),
    [container.image]
  );

  // Determine icon based on provider field (primary source of truth)
  const handleVersionClick = useCallback(
    async (e) => {
      e.stopPropagation();
      if (imageVersion) {
        try {
          await navigator.clipboard.writeText(imageVersion);
          showToast("Version text copied", "info");
        } catch (err) {
          console.error("Failed to copy version to clipboard:", err);
          showToast("Failed to copy version", "error");
        }
      }
    },
    [imageVersion]
  );

  return {
    imageVersion,
    imageNameWithoutVersion,
    handleVersionClick,
  };
};
