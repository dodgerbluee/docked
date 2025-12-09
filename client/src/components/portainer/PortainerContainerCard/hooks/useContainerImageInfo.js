/**
 * Hook for managing container image information and URLs
 */

import { useMemo, useCallback } from "react";
import {
  extractVersion,
  extractImageName,
  isGitHubContainer,
  getGitHubContainerUrl,
  isGitLabContainer,
  getGitLabContainerUrl,
  getGitLabRepoUrl,
} from "../utils/containerImageParsing";
import { getDockerHubRepoUrl } from "../../../../utils/formatters";
import { showToast } from "../../../../utils/toast";
import { computeHasUpdate } from "../../../../utils/containerUpdateHelpers";

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

  const isGoogle = useMemo(() => {
    // Primary: Use provider field if available
    if (container.provider === "gcr") {
      return true;
    }
    // Fallback: Check image name pattern for gcr.io
    if (container.provider === null || container.provider === undefined) {
      return container.image && container.image.startsWith("gcr.io/");
    }
    return false;
  }, [container.provider, container.image]);

  const isDocker = useMemo(() => {
    // Primary: Use provider field if available
    if (container.provider === "dockerhub") {
      return !isGitHub && !isGitLab && !isGoogle;
    }
    // Fallback: Only if provider is not set, use image name pattern
    // Don't show Docker Hub icon if it's GitHub, GitLab, or Google
    if (container.provider === null || container.provider === undefined) {
      if (isGitHub || isGitLab || isGoogle) {
        return false;
      }
      // If existsInDockerHub is true or not set, assume Docker Hub
      return container.existsInDockerHub !== false;
    }
    return false;
  }, [container.provider, container.existsInDockerHub, isGitHub, isGitLab, isGoogle]);

  // Compute hasUpdate on-the-fly
  const hasUpdate = useMemo(() => computeHasUpdate(container), [container]);

  // Construct GitHub URL based on provider or tracked app info
  const githubUrl = useMemo(() => {
    // If update is from GitHub-tracked app, use the tracked app's GitHub repo URL
    if (
      hasUpdate &&
      container.updateSourceType === "github" &&
      container.updateGitHubRepo
    ) {
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
  }, [
    hasUpdate,
    container.updateSourceType,
    container.updateGitHubRepo,
    container.provider,
    container.image,
  ]);

  // Construct GitLab URL based on provider or tracked app info
  const gitlabUrl = useMemo(() => {
    // If update is from GitLab-tracked app, use the tracked app's GitLab repo URL
    if (
      hasUpdate &&
      container.updateSourceType === "gitlab" &&
      container.updateGitLabRepo
    ) {
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
  }, [
    hasUpdate,
    container.updateSourceType,
    container.updateGitLabRepo,
    container.provider,
    container.image,
  ]);

  const dockerHubUrl = useMemo(
    () => (container.image ? getDockerHubRepoUrl(container.image) : null),
    [container.image]
  );

  // Construct Google Container Registry / Artifact Registry URL
  const googleUrl = useMemo(() => {
    if (!container.image || !isGoogle) {
      return null;
    }
    // Extract repo from image name (e.g., "gcr.io/project/repo:tag" -> "project/repo")
    const imageParts = container.image.split(":");
    const repo = imageParts[0];
    if (repo.startsWith("gcr.io/")) {
      const normalizedRepo = repo.replace("gcr.io/", "");
      const parts = normalizedRepo.split("/");
      const project = parts[0];
      // Use Artifact Registry console (GCR is deprecated, but gcr.io URLs still work)
      // Try to construct a link to Artifact Registry for the project
      return `https://console.cloud.google.com/artifacts/docker/${project}?project=${project}`;
    }
    return null;
  }, [container.image, isGoogle]);

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
        } else if (isGoogle && googleUrl) {
          window.open(googleUrl, "_blank", "noopener,noreferrer");
        } else if (isDocker && dockerHubUrl) {
          window.open(dockerHubUrl, "_blank", "noopener,noreferrer");
        }
      }
    },
    [
      container.image,
      isGitHub,
      isGitLab,
      isGoogle,
      isDocker,
      githubUrl,
      gitlabUrl,
      googleUrl,
      dockerHubUrl,
    ]
  );

  return {
    imageVersion,
    imageNameWithoutVersion,
    isGitHub,
    isGitLab,
    isGoogle,
    isDocker,
    githubUrl,
    gitlabUrl,
    googleUrl,
    dockerHubUrl,
    handleVersionClick,
    handleImageNameClick,
  };
};
