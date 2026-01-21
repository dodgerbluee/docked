/**
 * Container Registry Provider (docker.io compatible)
 *
 * Implements OCI Distribution Spec registry protocol for fetching image digests
 * and metadata. Supports both anonymous and authenticated requests.
 * Works with docker.io registry and other OCI-compliant registries.
 */

const RegistryProvider = require("../RegistryProvider");
const config = require("../../../config");
const Cache = require("../../../utils/cache");
const logger = require("../../../utils/logger");

// Cache for digests (shared across instances)
const digestCache = new Cache();

class DockerHubProvider extends RegistryProvider {
  constructor() {
    super();
    this.name = "dockerhub";
  }

  getName() {
    return this.name;
  }

  canHandle(imageRepo) {
    // Handle docker.io, registry-1.docker.io, or plain repos (assumed docker.io registry)
    if (
      imageRepo.startsWith("docker.io/") ||
      imageRepo.startsWith("registry-1.docker.io/") ||
      imageRepo.startsWith("registry.docker.io/")
    ) {
      return true;
    }
    // If it has a slash and no registry prefix, assume docker.io registry
    if (imageRepo.includes("/") && !imageRepo.includes(".") && !imageRepo.startsWith("ghcr.io/")) {
      return true;
    }
    // lscr.io images are also on docker.io registry
    if (imageRepo.startsWith("lscr.io/")) {
      return true;
    }
    return false;
  }

  normalizeRepo(imageRepo) {
    // Remove registry prefixes
    let repo = imageRepo
      .replace(/^docker\.io\//, "")
      .replace(/^registry-1\.docker\.io\//, "")
      .replace(/^registry\.docker\.io\//, "");

    // lscr.io images are also on docker.io registry under the same name
    if (imageRepo.startsWith("lscr.io/")) {
      repo = imageRepo.replace("lscr.io/", "");
    }

    return repo;
  }

  /**
   * Clean tag by removing incomplete SHA256 markers
   * @param {string} tag - Original tag
   * @param {string} normalizedRepo - Normalized repository
   * @returns {Object} - { cleanedTag, cachedResult }
   */
  _cleanTagAndCheckCache(tag, normalizedRepo) {
    if (!tag || !tag.includes("@sha256") || tag.includes("@sha256:")) {
      return { cleanedTag: tag, cachedResult: null };
    }

    const cleanedTag = tag.replace("@sha256", "");
    logger.debug(`[Registry] Stripped incomplete @sha256 marker from tag: ${tag} -> ${cleanedTag}`);

    const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
    const cleanedCached = digestCache.get(cleanedCacheKey);
    if (cleanedCached) {
      const cacheKey = `${normalizedRepo}:${tag}`;
      digestCache.set(cacheKey, cleanedCached, config.cache.digestCacheTTL);
      return { cleanedTag, cachedResult: cleanedCached };
    }

    return { cleanedTag, cachedResult: null };
  }

  /**
   * Get digest using crane/skopeo
   * @param {string} imageRef - Image reference
   * @param {string} imageRepo - Image repository
   * @param {string} cleanedTag - Cleaned tag
   * @param {string} cacheKey - Cache key
   * @param {string} normalizedRepo - Normalized repository
   * @param {string} originalTag - Original tag
   * @returns {Promise<Object|null>} - Result object or null
   */
  /**
   * Get digest with crane/skopeo
   * @param {Object} params - Parameters object
   * @param {string} params.imageRef - Image reference
   * @param {string} params.imageRepo - Image repository
   * @param {string} params.cleanedTag - Cleaned tag
   * @param {string} params.cacheKey - Cache key
   * @param {string} params.normalizedRepo - Normalized repository
   * @param {string} params.originalTag - Original tag
   * @returns {Promise<Object|null>} - Result or null
   */
  async _getDigestWithCraneSkopeo(params) {
    const { imageRef, imageRepo, cleanedTag, cacheKey, normalizedRepo, originalTag, platform } =
      params;
    const { getImageDigest } = require("../../../utils/containerTools");

    const platformMsg = platform ? ` for platform ${platform}` : "";
    logger.debug(
      `[Registry] Attempting to get digest for ${imageRef}${platformMsg} using crane/skopeo (primary method - uses registry protocol)`
    );

    const digest = await getImageDigest(imageRef, { platform });

    if (!digest) {
      logger.warn(
        `[Registry] ⚠️ crane/skopeo failed for ${imageRef}${platformMsg}, no digest available`
      );
      return null;
    }

    const result = {
      digest,
      tag: cleanedTag,
      provider: "dockerhub",
      method: "crane-skopeo",
    };

    digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
    if (cleanedTag !== originalTag) {
      const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
      digestCache.set(cleanedCacheKey, result, config.cache.digestCacheTTL);
    }

    this.logOperation("getLatestDigest (crane-skopeo)", imageRepo, {
      tag: cleanedTag,
      digest: `${digest.substring(0, 12)}...`,
      platform,
    });
    logger.info(
      `[Registry] ✅ Successfully got digest for ${imageRepo}:${cleanedTag}${platformMsg} using crane/skopeo (registry protocol) - ${digest.substring(0, 12)}...`
    );
    return result;
  }

  /**
   * Handle error in getLatestDigest
   * @param {Error} error - Error object
   * @param {string} imageRepo - Image repository
   * @param {string} cleanedTag - Cleaned tag
   * @returns {null}
   */
  _handleGetLatestDigestError(error, imageRepo, cleanedTag) {
    if (this.isRateLimitError(error)) {
      throw error;
    }
    if (error.response?.status !== 404) {
      logger.error(`Error fetching digest for ${imageRepo}:${cleanedTag}:`, {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        imageRepo,
        tag: cleanedTag,
      });
    } else {
      logger.debug(`Image ${imageRepo}:${cleanedTag} not found in registry (404 in catch)`);
    }
    return null;
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `${normalizedRepo}:${tag}`;

    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      return cached;
    }

    const { cleanedTag, cachedResult } = this._cleanTagAndCheckCache(tag, normalizedRepo);
    if (cachedResult) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag: cleanedTag });
      return cachedResult;
    }

    if (cleanedTag && cleanedTag.includes("@sha256:")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, {
        reason: "tag contains complete digest",
      });
      return null;
    }

    try {
      const imageRef = `${normalizedRepo}:${cleanedTag}`;
      return this._getDigestWithCraneSkopeo({
        imageRef,
        imageRepo,
        cleanedTag,
        cacheKey,
        normalizedRepo,
        originalTag: tag,
        platform: options.platform, // Pass platform for architecture-specific lookup
      });
    } catch (error) {
      return this._handleGetLatestDigestError(error, imageRepo, cleanedTag);
    }
  }
  async getTagPublishDate(imageRepo, tag, _options = {}) {
    // Publish date requires Docker Hub REST API which we no longer use
    // Return null as we're using registry protocol instead
    return null;
  }

  async imageExists(imageRepo, options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);

    // Try to get digest for "latest" tag
    try {
      const digest = await this.getLatestDigest(normalizedRepo, "latest", options);
      if (digest) {
        return true;
      }

      // For lscr.io images, try common tags
      if (imageRepo.startsWith("lscr.io/")) {
        const commonTags = ["develop", "nightly", "beta", "stable"];
        for (const tag of commonTags) {
          const tagDigest = await this.getLatestDigest(normalizedRepo, tag, options);
          if (tagDigest) {
            return true;
          }
        }
      }

      return false;
    } catch (_error) {
      return false;
    }
  }

  handleError(error) {
    if (this.isRateLimitError(error)) {
      const rateLimitError = new Error("Registry rate limit exceeded");
      rateLimitError.isRateLimitExceeded = true;
      rateLimitError.originalError = error;
      return rateLimitError;
    }
    return error;
  }

  /**
   * Clear cache for a specific image
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   */
  clearCache(imageRepo, tag) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `${normalizedRepo}:${tag}`;
    digestCache.delete(cacheKey);
  }

  /**
   * Clear all cache entries
   */
  clearAllCache() {
    digestCache.clear();
  }
}

module.exports = DockerHubProvider;
