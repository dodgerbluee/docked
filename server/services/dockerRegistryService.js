/**
 * Docker Registry Service
 * Handles digest extraction from running containers.
 *
 * Note: For fetching latest digests from registries, use the new registry service
 * (server/services/registry) which uses crane/skopeo and supports multiple providers.
 */

const Cache = require("../utils/cache");
const logger = require("../utils/logger");

// Cache for image digests
const digestCache = new Cache();

/**
 * Detect registry type from image repository
 * @param {string} imageRepo - Image repository name
 * @returns {Object} - Registry info with type and repo
 */
function detectRegistry(imageRepo) {
  if (imageRepo.startsWith("ghcr.io/")) {
    return { type: "ghcr", repo: imageRepo.replace("ghcr.io/", "") };
  }
  if (imageRepo.startsWith("docker.io/")) {
    return { type: "dockerhub", repo: imageRepo.replace("docker.io/", "") };
  }
  if (imageRepo.startsWith("registry.gitlab.com/")) {
    return {
      type: "gitlab",
      repo: imageRepo.replace("registry.gitlab.com/", ""),
    };
  }
  if (imageRepo.startsWith("gcr.io/")) {
    return { type: "gcr", repo: imageRepo.replace("gcr.io/", "") };
  }
  if (imageRepo.startsWith("lscr.io/")) {
    return { type: "lscr", repo: imageRepo.replace("lscr.io/", "") };
  }
  if (imageRepo.includes("/")) {
    // Assume Docker Hub if it has a slash (user/repo format)
    return { type: "dockerhub", repo: imageRepo };
  }
  // Default: Docker Hub official image
  return { type: "dockerhub", repo: imageRepo };
}

/**
 * Get current image digest from container details.
 * Only the digest embedded in the image reference (@sha256:...) is available
 * from a runner's container inspect; remote image inspection is not performed.
 *
 * @param {Object} containerDetails - Container inspect details
 * @returns {Promise<string|null>} - Image digest or null
 */
async function getCurrentImageDigest(containerDetails) {
  const configImage = containerDetails.Config?.Image;
  if (configImage && configImage.includes("@sha256:")) {
    const digest = configImage.split("@sha256:")[1];
    if (process.env.DEBUG) {
      logger.debug(`      ✅ Found digest in image name: sha256:${digest.substring(0, 12)}...`);
    }
    return `sha256:${digest}`;
  }
  return null;
}

/**
 * Clear digest cache for a specific image
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 */
function clearDigestCache(imageRepo, tag) {
  const registry = detectRegistry(imageRepo);
  if (registry.type === "dockerhub") {
    const cacheKey = `${registry.repo}:${tag}`;
    digestCache.delete(cacheKey);
  }
}

/**
 * Clear all digest cache entries
 * Used when force refreshing to ensure fresh registry data
 */
function clearAllDigestCache() {
  digestCache.clear();
  logger.debug("Cleared all registry digest cache entries");
}

module.exports = {
  detectRegistry,
  getCurrentImageDigest,
  clearDigestCache,
  clearAllDigestCache,
};
