/**
 * Registry Manager
 *
 * Centralized registry management with automatic provider selection,
 * fallback strategies, and unified API for all registry operations.
 *
 * Features:
 * - Automatic provider detection based on image repository
 * - Fallback chain: Primary Registry → GitHub Releases → Cached Data
 * - Rate limit handling and retry logic
 * - Comprehensive error handling
 * - Caching and performance optimization
 */

const DockerHubProvider = require("./providers/DockerHubProvider");
const GHCRProvider = require("./providers/GHCRProvider");
const GitLabProvider = require("./providers/GitLabProvider");
const GCRProvider = require("./providers/GCRProvider");
const GitHubReleasesProvider = require("./providers/GitHubReleasesProvider");
const logger = require("../../utils/logger");

class RegistryManager {
  constructor() {
    // Register all providers (order matters - more specific first)
    this.providers = [
      new GHCRProvider(), // ghcr.io - most specific
      new GitLabProvider(), // registry.gitlab.com - specific
      new GCRProvider(), // gcr.io - specific (with Docker Hub fallback)
      new DockerHubProvider(), // docker.io or plain repos - default/catch-all
    ];

    // Fallback provider (used when primary fails)
    this.fallbackProvider = new GitHubReleasesProvider();

    // Provider cache: imageRepo -> provider
    this.providerCache = new Map();
  }

  /**
   * Get the appropriate provider for an image repository
   * @param {string} imageRepo - Image repository
   * @returns {RegistryProvider|null} - Provider or null if none found
   */
  getProvider(imageRepo) {
    // Check cache first
    if (this.providerCache.has(imageRepo)) {
      return this.providerCache.get(imageRepo);
    }

    // Find provider that can handle this image
    for (const provider of this.providers) {
      if (provider.canHandle(imageRepo)) {
        this.providerCache.set(imageRepo, provider);
        return provider;
      }
    }

    // Default to Docker Hub if no specific provider found
    const dockerHubProvider = this.providers.find((p) => p.getName() === "dockerhub");
    if (dockerHubProvider) {
      this.providerCache.set(imageRepo, dockerHubProvider);
      return dockerHubProvider;
    }

    return null;
  }

  /**
   * Process result from primary provider
   * @param {Object|null} result - Provider result
   * @param {RegistryProvider} provider - Provider instance
   * @param {string} tag - Image tag
   * @returns {Object|null} - Processed result
   */
  _processProviderResult(result, provider, tag) {
    if (result) {
      const resultProvider = result.provider || provider.getName();
      return {
        ...result,
        provider: resultProvider,
        isFallback: result.isFallback || false,
      };
    }

    const providerName = provider.getName();
    if (providerName) {
      return {
        digest: null,
        tag,
        provider: providerName,
        isFallback: false,
      };
    }
    return null;
  }

  /**
   * Handle provider error and try fallback if needed
   * @param {Error} error - Error object
   * @param {RegistryProvider} provider - Provider instance
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {Object} options - Options
   * @returns {Promise<Object|null>} - Fallback result or throws error
   */
  async _handleProviderError(error, provider, imageRepo, tag, options) {
    const handledError = provider.handleError(error);
    const { useFallback = true, userId, githubRepo } = options;

    if (useFallback && (provider.isRateLimitError(handledError) || handledError)) {
      logger.debug(`Primary provider failed for ${imageRepo}:${tag}, trying fallback`, {
        provider: provider.getName(),
        error: handledError.message,
      });
      return this._tryFallback(imageRepo, tag, { userId, githubRepo });
    }

    throw handledError;
  }

  /**
   * Get latest image digest with automatic fallback
   *
   * Fallback strategy:
   * 1. Try primary registry provider
   * 2. If rate limited or fails, try GitHub Releases (if repo mapping exists)
   * 3. Return null if all fail
   *
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag (default: 'latest')
   * @param {Object} options - Options
   * @param {number} options.userId - User ID for authentication
   * @param {string} options.githubRepo - GitHub repo for fallback (e.g., 'owner/repo')
   * @param {boolean} options.useFallback - Whether to use GitHub Releases fallback (default: true)
   * @returns {Promise<Object|null>} - { digest: string, tag: string, isFallback?: boolean } or null
   */
  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const provider = this.getProvider(imageRepo);
    if (!provider) {
      logger.warn(`No provider found for image: ${imageRepo}`);
      return null;
    }

    try {
      const result = await provider.getLatestDigest(imageRepo, tag, {
        userId: options.userId,
        imageRepo,
      });
      return this._processProviderResult(result, provider, tag);
    } catch (error) {
      return this._handleProviderError(error, provider, imageRepo, tag, options);
    }
  }

  /**
   * Try fallback provider (GitHub Releases)
   * @private
   */
  async _tryFallback(imageRepo, tag, options = {}) {
    const { userId, githubRepo } = options;

    // Check if fallback provider can handle this
    if (!this.fallbackProvider.canHandle(imageRepo, { githubRepo })) {
      return null;
    }

    try {
      const result = await this.fallbackProvider.getLatestDigest(imageRepo, tag, {
        userId,
        githubRepo,
      });

      if (result) {
        logger.info(`Using GitHub Releases fallback for ${imageRepo}:${tag}`, {
          latestVersion: result.tag,
        });

        return {
          ...result,
          provider: this.fallbackProvider.getName(),
          isFallback: true,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`Fallback provider also failed for ${imageRepo}:${tag}:`, error.message);
      return null;
    }
  }

  /**
   * Get tag publish date with fallback
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {Object} options - Options
   * @returns {Promise<string|null>} - ISO date string or null
   */
  async getTagPublishDate(imageRepo, tag, options = {}) {
    const { userId, githubRepo } = options;
    const provider = this.getProvider(imageRepo);

    if (!provider) {
      return null;
    }

    try {
      const date = await provider.getTagPublishDate(imageRepo, tag, { userId });
      if (date) {
        return date;
      }

      // Try fallback if primary doesn't support it
      if (this.fallbackProvider.canHandle(imageRepo, { githubRepo })) {
        return this.fallbackProvider.getTagPublishDate(imageRepo, tag, {
          userId,
          githubRepo,
        });
      }

      return null;
    } catch (error) {
      logger.debug(`Failed to get publish date for ${imageRepo}:${tag}:`, error.message);
      return null;
    }
  }

  /**
   * Check if image exists in registry
   * @param {string} imageRepo - Image repository
   * @param {Object} options - Options
   * @returns {Promise<boolean>} - True if image exists
   */
  async imageExists(imageRepo, options = {}) {
    const { userId } = options;
    const provider = this.getProvider(imageRepo);

    if (!provider) {
      return false;
    }

    try {
      return provider.imageExists(imageRepo, { userId });
    } catch (error) {
      logger.debug(`Failed to check if image exists: ${imageRepo}:`, error.message);
      return false;
    }
  }

  /**
   * Compare current and latest digests/versions to determine if update is available
   *
   * @param {string} currentDigest - Current image digest (or tag if digest unavailable)
   * @param {string} currentTag - Current image tag
   * @param {Object} latestInfo - Latest info from getLatestDigest
   * @returns {boolean} - True if update is available
   */
  hasUpdate(currentDigest, currentTag, latestInfo) {
    if (!latestInfo) {
      return false;
    }

    // If using fallback (GitHub Releases), use version comparison
    if (latestInfo.isFallback) {
      return this.fallbackProvider.hasUpdate(currentTag, latestInfo.tag);
    }

    // Primary method: compare digests
    if (currentDigest && latestInfo.digest) {
      const normalizeDigest = (digest) => {
        if (!digest) return null;
        return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
      };

      const normalizedCurrent = normalizeDigest(currentDigest);
      const normalizedLatest = normalizeDigest(latestInfo.digest);

      return normalizedCurrent !== normalizedLatest;
    }

    // Fallback: compare tags if digests unavailable
    if (currentTag && latestInfo.tag) {
      return currentTag !== latestInfo.tag;
    }

    return false;
  }

  /**
   * Clear cache for a specific image
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   */
  clearCache(imageRepo, tag) {
    const provider = this.getProvider(imageRepo);
    if (provider && typeof provider.clearCache === "function") {
      provider.clearCache(imageRepo, tag);
    }
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    for (const provider of this.providers) {
      if (typeof provider.clearAllCache === "function") {
        provider.clearAllCache();
      }
    }
    this.providerCache.clear();
  }

  /**
   * Get provider information for an image
   * @param {string} imageRepo - Image repository
   * @returns {Object} - Provider info { name: string, supportsDigest: boolean }
   */
  getProviderInfo(imageRepo) {
    const provider = this.getProvider(imageRepo);
    if (!provider) {
      return null;
    }

    return {
      name: provider.getName(),
      supportsDigest: true, // All registry providers support digests
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton RegistryManager instance
 * @returns {RegistryManager} - RegistryManager instance
 */
function getRegistryManager() {
  if (!instance) {
    instance = new RegistryManager();
  }
  return instance;
}

module.exports = {
  RegistryManager,
  getRegistryManager,
};
