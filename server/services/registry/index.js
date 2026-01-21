/**
 * Registry Service - Public API
 *
 * Unified interface for all container registry operations.
 * Provides automatic provider selection, fallback strategies,
 * and consistent error handling.
 */

const { getRegistryManager } = require("./RegistryManager");

/**
 * Get latest image digest with automatic fallback
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag (default: 'latest')
 * @param {Object} options - Options
 * @returns {Promise<Object|null>} - Digest info or null
 */
async function getLatestDigest(imageRepo, tag = "latest", options = {}) {
  const manager = getRegistryManager();
  return manager.getLatestDigest(imageRepo, tag, options);
}

/**
 * Get tag publish date
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 * @param {Object} options - Options
 * @returns {Promise<string|null>} - ISO date string or null
 */
async function getTagPublishDate(imageRepo, tag, options = {}) {
  const manager = getRegistryManager();
  return manager.getTagPublishDate(imageRepo, tag, options);
}

/**
 * Check if image exists in registry
 * @param {string} imageRepo - Image repository
 * @param {Object} options - Options
 * @returns {Promise<boolean>} - True if exists
 */
async function imageExists(imageRepo, options = {}) {
  const manager = getRegistryManager();
  return manager.imageExists(imageRepo, options);
}

/**
 * Check if update is available
 * @param {string} currentDigest - Current digest (or tag)
 * @param {string} currentTag - Current tag
 * @param {Object} latestInfo - Latest info from getLatestDigest
 * @param {Array<string>} repoDigests - Optional array of RepoDigests from container
 * @returns {boolean} - True if update available
 */
function hasUpdate(currentDigest, currentTag, latestInfo, repoDigests = null) {
  const manager = getRegistryManager();
  return manager.hasUpdate(currentDigest, currentTag, latestInfo, repoDigests);
}

/**
 * Clear cache for an image
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 */
function clearCache(imageRepo, tag) {
  const manager = getRegistryManager();
  manager.clearCache(imageRepo, tag);
}

/**
 * Clear all caches
 */
function clearAllCaches() {
  const manager = getRegistryManager();
  manager.clearAllCaches();
}

/**
 * Get provider info for an image
 * @param {string} imageRepo - Image repository
 * @returns {Object|null} - Provider info
 */
function getProviderInfo(imageRepo) {
  const manager = getRegistryManager();
  return manager.getProviderInfo(imageRepo);
}

module.exports = {
  getLatestDigest,
  getTagPublishDate,
  imageExists,
  hasUpdate,
  clearCache,
  clearAllCaches,
  getProviderInfo,
  // Export manager for advanced usage
  getRegistryManager,
};
