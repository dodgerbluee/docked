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

  // Determine icon based on provider field (primary source of truth)
  const isGitHub = useMemo(() => {
    // Primary: Use provider field if available
    if (container.provider === "ghcr" || container.provider === "github-releases") {
      return true;
    }
    // Fallback: Only if provider is not set, use image name pattern
    if (container.provider === null || container.provider === undefined) {
      return isGitHubContainer(container.image, container.existsInDockerHub);
    }
    return false;
  }, [container.provider, container.image, container.existsInDockerHub]);

  const isDocker = useMemo(() => {
    // ONLY show Docker Hub icon if provider is explicitly "dockerhub"
    return container.provider === "dockerhub";
  }, [container.provider]);

  // Construct GitHub URL based on provider or tracked app info
  const githubUrl = useMemo(() => {
    // If update is from GitHub-tracked app, use the tracked app's GitHub repo URL
    if (container.hasUpdate && container.updateSourceType === "github" && container.updateGitHubRepo) {
      const repo = container.updateGitHubRepo;
      // Handle both full URLs and owner/repo format
      if (repo.startsWith("http")) {
        return repo;
      }
      return `https://github.com/${repo}`;
    }
    // If provider is ghcr, construct GitHub Container Registry URL
    if (container.provider === "ghcr") {
      return getGitHubContainerUrl(container.image);
    }
    // Otherwise, try to get from container image (ghcr.io pattern)
    return getGitHubContainerUrl(container.image);
  }, [container.hasUpdate, container.updateSourceType, container.updateGitHubRepo, container.provider, container.image]);

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
