/**
 * Hook for managing container image information and URLs
 */

import { useMemo, useCallback } from "react";
import {
  extractVersion,
  extractImageName,
  getGitHubContainerUrl,
  getGitLabRepoUrl,
  getDockerHubUrl,
} from "../utils/containerImageParsing";
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

  // Handle version click - copy to clipboard
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

  // Handle image name click - open registry URL
  const handleImageClick = useCallback(
    async (e) => {
      e.stopPropagation();
      let url = null;
      const fullImageName = imageNameWithoutVersion;

      if (fullImageName.startsWith("ghcr.io/")) {
        url = getGitHubContainerUrl(container.image);
      } else if (fullImageName.startsWith("registry.gitlab.com/")) {
        url = getGitLabRepoUrl(container.image);
      } else {
        // Assume Docker Hub for others
        url = getDockerHubUrl(container.image);
      }

      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        showToast("Unable to determine image registry URL", "error");
      }
    },
    [imageNameWithoutVersion, container.image]
  );

  return {
    imageVersion,
    imageNameWithoutVersion,
    handleVersionClick,
    handleImageClick,
  };
};
