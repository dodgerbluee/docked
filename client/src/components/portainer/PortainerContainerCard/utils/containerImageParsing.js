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
  return (
    imageName &&
    imageName.startsWith("ghcr.io/") &&
    existsInDockerHub === false
  );
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

