/**
 * Hook for managing container image information and URLs
 */

import { useMemo, useCallback } from "react";
import {
  extractVersion,
  extractImageName,
  isGitHubContainer,
  isDockerHub,
  getGitHubContainerUrl,
} from "../utils/containerImageParsing";
import { getDockerHubRepoUrl } from "../../../../utils/formatters";
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

  const isGitHub = useMemo(
    () => isGitHubContainer(container.image, container.existsInDockerHub),
    [container.image, container.existsInDockerHub]
  );

  const isDocker = useMemo(
    () => isDockerHub(container.existsInDockerHub, isGitHub),
    [container.existsInDockerHub, isGitHub]
  );

  const githubUrl = useMemo(() => getGitHubContainerUrl(container.image), [container.image]);

  const dockerHubUrl = useMemo(
    () => (container.image ? getDockerHubRepoUrl(container.image) : null),
    [container.image]
  );

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

  const handleImageNameClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (container.image) {
        if (isGitHub && githubUrl) {
          window.open(githubUrl, "_blank", "noopener,noreferrer");
        } else if (isDocker && dockerHubUrl) {
          window.open(dockerHubUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    [container.image, isGitHub, isDocker, githubUrl, dockerHubUrl]
  );

  return {
    imageVersion,
    imageNameWithoutVersion,
    isGitHub,
    isDocker,
    githubUrl,
    dockerHubUrl,
    handleVersionClick,
    handleImageNameClick,
  };
};
