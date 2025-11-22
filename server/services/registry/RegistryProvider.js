/**
 * Base Registry Provider Interface
 *
 * All registry providers must implement this interface to ensure
 * consistent behavior across different container registries.
 *
 * This abstract class defines the contract for:
 * - Fetching image digests
 * - Getting tag information
 * - Handling authentication
 * - Rate limiting
 */

const logger = require("../../utils/logger");

class RegistryProvider {
  /**
   * Get the provider name (e.g., 'dockerhub', 'ghcr', 'gitlab')
   * @returns {string} - Provider identifier
   */
  getName() {
    throw new Error("getName() must be implemented by subclass");
  }

  /**
   * Check if this provider can handle the given image repository
   * @param {string} imageRepo - Image repository (e.g., 'library/nginx', 'ghcr.io/owner/repo')
   * @returns {boolean} - True if this provider can handle the image
   */
  canHandle(imageRepo) {
    throw new Error("canHandle() must be implemented by subclass");
  }

  /**
   * Get the latest image digest for a specific tag
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag (default: 'latest')
   * @param {Object} options - Additional options
   * @param {number} options.userId - User ID for authentication
   * @returns {Promise<Object|null>} - { digest: string, tag: string } or null if not found
   */
  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    throw new Error("getLatestDigest() must be implemented by subclass");
  }

  /**
   * Get the publish date for a specific tag
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {Object} options - Additional options
   * @param {number} options.userId - User ID for authentication
   * @returns {Promise<string|null>} - ISO date string or null
   */
  async getTagPublishDate(imageRepo, tag, options = {}) {
    throw new Error("getTagPublishDate() must be implemented by subclass");
  }

  /**
   * Check if an image exists in this registry
   * @param {string} imageRepo - Image repository
   * @param {Object} options - Additional options
   * @param {number} options.userId - User ID for authentication
   * @returns {Promise<boolean>} - True if image exists
   */
  async imageExists(imageRepo, options = {}) {
    throw new Error("imageExists() must be implemented by subclass");
  }

  /**
   * Get authentication credentials for this registry
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - { username?: string, token?: string, password?: string }
   */
  async getCredentials(userId) {
    // Default: no credentials
    return {};
  }

  /**
   * Check if this provider requires authentication
   * @returns {boolean} - True if authentication is required
   */
  requiresAuth() {
    return false;
  }

  /**
   * Get rate limit delay in milliseconds
   * @param {Object} options - Options including userId for credential check
   * @returns {Promise<number>} - Delay in milliseconds
   */
  async getRateLimitDelay(options = {}) {
    // Default: 1000ms delay
    return 1000;
  }

  /**
   * Normalize image repository for this provider
   * @param {string} imageRepo - Image repository
   * @returns {string} - Normalized repository name
   */
  normalizeRepo(imageRepo) {
    return imageRepo;
  }

  /**
   * Handle provider-specific errors
   * @param {Error} error - Error to handle
   * @returns {Error} - Transformed error or original error
   */
  handleError(error) {
    // Default: return error as-is
    return error;
  }

  /**
   * Check if an error is a rate limit error
   * @param {Error} error - Error to check
   * @returns {boolean} - True if error is rate limit related
   */
  isRateLimitError(error) {
    return (
      error.response?.status === 429 ||
      error.isRateLimitExceeded === true ||
      error.message?.toLowerCase().includes("rate limit")
    );
  }

  /**
   * Log provider operation (for debugging)
   * @param {string} operation - Operation name
   * @param {string} imageRepo - Image repository
   * @param {Object} metadata - Additional metadata
   */
  logOperation(operation, imageRepo, metadata = {}) {
    if (process.env.DEBUG) {
      logger.debug(`[${this.getName()}] ${operation} for ${imageRepo}`, {
        provider: this.getName(),
        operation,
        imageRepo,
        ...metadata,
      });
    }
  }
}

module.exports = RegistryProvider;
