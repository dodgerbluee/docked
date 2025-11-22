/**
 * Utilities for parsing container image names and extracting information
 */

/**
 * Extract version/tag from image name
 * @param {string} imageName - Full image name (e.g., "nginx:1.21" or "ghcr.io/user/repo:tag")
 * @returns {string} Version/tag or "latest" if not found
 */
export const extractVersion = (imageName) => {
  if (!imageName) return "latest";
  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    return parts[parts.length - 1]; // Get the last part after the last colon
  }
  return "latest"; // No version specified, default to "latest"
};

/**
 * Extract image name without version/tag
 * @param {string} imageName - Full image name (e.g., "nginx:1.21" or "ghcr.io/user/repo:tag")
 * @returns {string} Image name without version/tag
 */
export const extractImageName = (imageName) => {
  if (!imageName) return imageName;
  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    return parts.slice(0, -1).join(":"); // Get everything except the last part
  }
  return imageName; // No version, return as-is
};

/**
 * Check if image is from GitHub Container Registry
 * @param {string} imageName - Full image name
 * @param {boolean} existsInDockerHub - Whether image exists in Docker Hub
 * @returns {boolean} True if image is from GitHub Container Registry
 */
export const isGitHubContainer = (imageName, existsInDockerHub) => {
  return imageName && imageName.startsWith("ghcr.io/") && existsInDockerHub === false;
};

/**
 * Check if image is from Docker Hub
 * @param {string} imageName - Full image name
 * @param {boolean} existsInDockerHub - Whether image exists in Docker Hub
 * @param {boolean} isGitHubContainer - Whether image is from GitHub Container Registry
 * @returns {boolean} True if image is from Docker Hub
 */
export const isDockerHub = (existsInDockerHub, isGitHubContainer) => {
  return existsInDockerHub !== false && !isGitHubContainer;
};

/**
 * Get GitHub Container Registry URL
 * @param {string} imageName - Full image name
 * @returns {string|null} GitHub Container Registry URL or null
 */
export const getGitHubContainerUrl = (imageName) => {
  if (!imageName || !imageName.startsWith("ghcr.io/")) return null;
  // Remove version/tag if present
  const imageWithoutVersion = extractImageName(imageName);
  return `https://${imageWithoutVersion}`;
};

/**
 * Check if image is from GitLab Container Registry
 * @param {string} imageName - Full image name
 * @returns {boolean} True if image is from GitLab Container Registry
 */
export const isGitLabContainer = (imageName) => {
  return imageName && imageName.startsWith("registry.gitlab.com/");
};

/**
 * Get GitLab Container Registry URL
 * @param {string} imageName - Full image name
 * @returns {string|null} GitLab Container Registry URL or null
 */
export const getGitLabContainerUrl = (imageName) => {
  if (!imageName || !imageName.startsWith("registry.gitlab.com/")) return null;
  // Remove version/tag if present
  const imageWithoutVersion = extractImageName(imageName);
  return `https://${imageWithoutVersion}`;
};

/**
 * Get GitLab repository URL from image name or repo string
 * @param {string} imageName - Image name or GitLab repo string (e.g., "owner/repo" or "https://gitlab.com/owner/repo")
 * @returns {string|null} GitLab repository URL or null
 */
export const getGitLabRepoUrl = (imageName) => {
  if (!imageName) return null;

  // If it's already a full URL, return it
  if (imageName.startsWith("http")) {
    return imageName;
  }

  // If it's a GitLab Container Registry image, extract the repo
  if (imageName.startsWith("registry.gitlab.com/")) {
    const imageWithoutVersion = extractImageName(imageName);
    const repoPath = imageWithoutVersion.replace("registry.gitlab.com/", "");
    return `https://gitlab.com/${repoPath}`;
  }

  // If it's in owner/repo format, construct the URL
  if (imageName.includes("/")) {
    return `https://gitlab.com/${imageName}`;
  }

  return null;
};
