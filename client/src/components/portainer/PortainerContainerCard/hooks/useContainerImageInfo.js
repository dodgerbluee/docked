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
  isGitLabContainer,
  getGitLabContainerUrl,
  getGitLabRepoUrl,
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

  const isGitLab = useMemo(() => {
    // Primary: Use provider field if available
    if (container.provider === "gitlab") {
      return true;
    }
    // Check updateSourceType for GitLab-tracked apps
    if (container.updateSourceType === "gitlab") {
      return true;
    }
    // Fallback: Only if provider is not set, use image name pattern
    if (container.provider === null || container.provider === undefined) {
      return isGitLabContainer(container.image);
    }
    return false;
  }, [container.provider, container.updateSourceType, container.image]);

  const isDocker = useMemo(() => {
    // ONLY show Docker Hub icon if provider is explicitly "dockerhub"
    // and not GitHub or GitLab
    return container.provider === "dockerhub" && !isGitHub && !isGitLab;
  }, [container.provider, isGitHub, isGitLab]);

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

  // Construct GitLab URL based on provider or tracked app info
  const gitlabUrl = useMemo(() => {
    // If update is from GitLab-tracked app, use the tracked app's GitLab repo URL
    if (container.hasUpdate && container.updateSourceType === "gitlab" && container.updateGitLabRepo) {
      return getGitLabRepoUrl(container.updateGitLabRepo);
    }
    // If provider is gitlab, construct GitLab Container Registry URL or repo URL
    if (container.provider === "gitlab") {
      // Try to get repo URL from image name
      const repoUrl = getGitLabRepoUrl(container.image);
      if (repoUrl) {
        return repoUrl;
      }
      // Fallback to container registry URL
      return getGitLabContainerUrl(container.image);
    }
    // Otherwise, try to get from container image (registry.gitlab.com pattern)
    return getGitLabContainerUrl(container.image);
  }, [container.hasUpdate, container.updateSourceType, container.updateGitLabRepo, container.provider, container.image]);

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
        } else if (isGitLab && gitlabUrl) {
          window.open(gitlabUrl, "_blank", "noopener,noreferrer");
        } else if (isDocker && dockerHubUrl) {
          window.open(dockerHubUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    [container.image, isGitHub, isGitLab, isDocker, githubUrl, gitlabUrl, dockerHubUrl]
  );

  return {
    imageVersion,
    imageNameWithoutVersion,
    isGitHub,
    isGitLab,
    isDocker,
    githubUrl,
    gitlabUrl,
    dockerHubUrl,
    handleVersionClick,
    handleImageNameClick,
  };
};
