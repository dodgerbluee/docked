/**
 * Utilities for parsing container image names and extracting information
 */

/**
 * Split an image reference into [name, tag].
 *
 * Only a colon that appears after the last "/" separates a tag, so a registry
 * port (registry.example.com:5000/app) and a digest pin (repo@sha256:abc) stay
 * intact instead of being chopped at the wrong colon.
 */
const splitImageTag = (imageName) => {
  const lastSlash = imageName.lastIndexOf("/");
  const colon = imageName.indexOf(":", lastSlash + 1);
  if (colon === -1) return [imageName, ""];
  // A digest is not a tag: keep "@sha256:..." with the name.
  if (imageName.lastIndexOf("@") > lastSlash) return [imageName, ""];
  return [imageName.slice(0, colon), imageName.slice(colon + 1)];
};

/**
 * Extract version/tag from image name
 * @param {string} imageName - Full image name (e.g., "nginx:1.21" or "ghcr.io/user/repo:tag")
 * @returns {string} Version/tag or "latest" if not found
 */
export const extractVersion = (imageName) => {
  if (!imageName) return "latest";
  const [, tag] = splitImageTag(imageName);
  return tag || "latest"; // No version specified, default to "latest"
};

/**
 * Extract image name without version/tag
 * @param {string} imageName - Full image name (e.g., "nginx:1.21" or "ghcr.io/user/repo:tag")
 * @returns {string} Image name without version/tag
 */
export const extractImageName = (imageName) => {
  if (!imageName) return imageName;
  const [name] = splitImageTag(imageName);
  return name; // No version, return as-is
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
 * Get Docker Hub URL
 * @param {string} imageName - Full image name
 * @returns {string|null} Docker Hub URL or null
 */
export const getDockerHubUrl = (imageName) => {
  if (!imageName) return null;
  // Remove version/tag if present
  const imageWithoutVersion = extractImageName(imageName);
  // Remove docker.io/ prefix if present
  const imageWithoutRegistry = imageWithoutVersion.replace(/^docker\.io\//, "");
  // For Docker Hub, official images are under /_/, user images under /r/
  const path = imageWithoutRegistry.includes("/") ? "r" : "_";
  return `https://hub.docker.com/${path}/${imageWithoutRegistry}`;
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
