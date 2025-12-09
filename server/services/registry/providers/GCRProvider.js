/**
 * Google Container Registry (GCR) Provider
 *
 * Implements GCR Registry API v2 for fetching image digests.
 * Many GCR images are also available on Docker Hub, so this provider
 * will attempt GCR first, then fall back to Docker Hub if GCR fails.
 */

const axios = require("axios");
const RegistryProvider = require("../RegistryProvider");
const { rateLimitDelay } = require("../../../utils/rateLimiter");
const { retryWithBackoff } = require("../../../utils/retry");
const config = require("../../../config");
const Cache = require("../../../utils/cache");
const logger = require("../../../utils/logger");
const { getImageDigest } = require("../../../utils/containerTools");

// Cache for digests
const digestCache = new Cache();

class GCRProvider extends RegistryProvider {
  constructor() {
    super();
    this.name = "gcr";
  }

  getName() {
    return this.name;
  }

  canHandle(imageRepo) {
    return imageRepo.startsWith("gcr.io/");
  }

  normalizeRepo(imageRepo) {
    // Remove gcr.io/ prefix
    return imageRepo.replace(/^gcr\.io\//, "");
  }
  async getCredentials(_userId) {
    // GCR typically requires service account credentials
    // For now, we'll try anonymous access, then fall back to Docker Hub
    return {};
  }
  async getRateLimitDelay(_options = {}) {
    // GCR has similar rate limits to Docker Hub
    return 1000;
  }

  /**
   * Get GCR authentication token (try anonymous first for public images)
   * @private
   */
  async _getAuthToken(namespace, repository, _userId) {
    try {
      // GCR/Artifact Registry uses OAuth2 token service
      // For public images, we can get an anonymous token
      const authUrl = "https://gcr.io/v2/token";
      const scope = `repository:${namespace}/${repository}:pull`;
      const params = {
        service: "gcr.io",
        scope,
      };

      const requestConfig = {
        params,
        timeout: 10000,
      };

      this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: false });

      // Try anonymous access first (works for public images)
      const response = await axios.get(authUrl, requestConfig);
      const token = response.data?.token || null;

      if (token) {
        logger.debug(`Got anonymous GCR token for ${namespace}/${repository}`);
        return token;
      }

      return null;
    } catch (error) {
      // If token endpoint fails, we'll try without auth (for public images)
      logger.debug(`Error getting GCR token for ${namespace}/${repository}:`, error.message);
      return null;
    }
  }

  /**
   * Try Docker Hub as fallback for GCR images
   * Many GCR images are also available on Docker Hub under the same name
   * Note: The caller will set provider to "gcr" to keep the Google icon showing
   * @private
   */
  async _tryDockerHubFallback(imageRepo, tag, options) {
    const normalizedRepo = this.normalizeRepo(imageRepo);

    // Import DockerHubProvider to use its methods
    const DockerHubProvider = require("./DockerHubProvider");
    const dockerHubProvider = new DockerHubProvider();

    try {
      logger.debug(`Trying Docker Hub fallback for GCR image: ${normalizedRepo}:${tag}`);
      const result = await dockerHubProvider.getLatestDigest(normalizedRepo, tag, options);
      // Return result without setting provider - caller will set it to "gcr" to keep icon
      if (result) {
        return {
          ...result,
          // Don't set provider here - caller will set it to "gcr"
          isFallback: true,
        };
      }
      return null;
    } catch (error) {
      logger.debug(`Docker Hub fallback also failed for ${normalizedRepo}:${tag}:`, error.message);
      return null;
    }
  }

  /**
   * Try to get digest using crane/skopeo
   * @param {string} imageRef - Full image reference
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {string} cacheKey - Cache key
   * @returns {Promise<Object|null>} - Result object or null
   */
  async _tryCraneSkopeo(imageRef, imageRepo, tag, cacheKey) {
    logger.debug(`[GCR] Trying to get digest for ${imageRef} using crane/skopeo`);
    const digest = await getImageDigest(imageRef);

    if (!digest) {
      return null;
    }

    const result = {
      digest,
      tag,
      provider: "gcr",
    };

    digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
    this.logOperation("getLatestDigest", imageRepo, {
      tag,
      digest: `${digest.substring(0, 12)}...`,
    });
    logger.info(
      `[GCR] Successfully got digest for ${imageRepo}:${tag} using crane/skopeo - ${digest.substring(0, 12)}...`,
    );
    return result;
  }

  /**
   * Parse GCR repository into project and repository
   * @param {string} normalizedRepo - Normalized repository
   * @returns {Object|null} - { project, repository } or null
   */
  _parseGcrRepo(normalizedRepo) {
    if (!normalizedRepo.includes("/")) {
      return null;
    }
    const [project, ...repoParts] = normalizedRepo.split("/");
    return {
      project,
      repository: repoParts.join("/"),
    };
  }

  /**
   * Request manifest from GCR API
   * @param {string} registryUrl - Registry URL
   * @param {Object} headers - Request headers
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - Response object
   */
  async _requestGcrManifest(registryUrl, headers, imageRepo, tag, userId) {
    return retryWithBackoff(
      async () => {
        const resp = await axios.get(registryUrl, {
          headers,
          timeout: 10000,
          validateStatus: status => status < 500,
        });

        if (resp.status === 429) {
          const error = new Error("Rate limited by GCR");
          error.response = { status: 429 };
          error.isRateLimitExceeded = true;
          throw error;
        }

        if (resp.status !== 200) {
          logger.debug(
            `GCR returned status ${resp.status} for ${imageRepo}:${tag}${headers.Authorization ? " (authenticated)" : " (anonymous)"}`,
          );
        }

        return resp;
      },
      3,
      1000,
      userId,
    );
  }

  /**
   * Handle successful GCR API response
   * @param {Object} response - Response object
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} - Result object or null
   */
  _handleGcrSuccess(response, imageRepo, tag, cacheKey) {
    if (response.status === 200 && response.headers["docker-content-digest"]) {
      const digest = response.headers["docker-content-digest"];
      const result = {
        digest,
        tag,
        provider: "gcr",
      };

      digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
      this.logOperation("getLatestDigest", imageRepo, {
        tag,
        digest: `${digest.substring(0, 12)}...`,
      });
      return result;
    }
    return null;
  }

  /**
   * Try Docker Hub fallback with GCR provider info
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {string} cacheKey - Cache key
   * @param {Object} options - Options
   * @param {number} status - Response status
   * @returns {Promise<Object|null>} - Result object or null
   */
  async _tryDockerHubFallbackWithGcr(imageRepo, tag, cacheKey, options, status) {
    if (status === 404 || status === 403) {
      logger.warn(
        `GCR image ${imageRepo}:${tag} may not be accessible (status ${status} - GCR is deprecated, project may need migration to Artifact Registry, or image may be private)`,
      );
    }

    const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
    if (!fallbackResult) {
      return null;
    }

    const result = {
      ...fallbackResult,
      provider: "gcr",
      isFallback: true,
    };
    digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
    logger.info(
      `Using Docker Hub fallback for GCR image ${imageRepo}:${tag} (keeping provider as gcr for icon)`,
    );
    return result;
  }

  /**
   * Handle GCR API error and try fallback
   * @param {Error} error - Error object
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {Object} options - Options
   * @returns {Promise<Object>} - Result object
   */
  async _handleGcrError(error, imageRepo, tag, options) {
    if (error.response?.status === 403 || error.response?.status === 401) {
      logger.warn(
        `GCR authentication/access error for ${imageRepo}:${tag} - GCR is deprecated, project may need migration to Artifact Registry`,
      );
    }

    const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
    if (fallbackResult) {
      return {
        ...fallbackResult,
        provider: "gcr",
        isFallback: true,
      };
    }

    logger.warn(
      `Failed to get digest for GCR image ${imageRepo}:${tag} - GCR may be deprecated or inaccessible, and Docker Hub fallback also failed`,
    );
    return {
      digest: null,
      tag,
      provider: "gcr",
      isFallback: false,
    };
  }

  /**
   * Try API approach for GCR
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Tag
   * @param {string} normalizedRepo - Normalized repository
   * @param {string} cacheKey - Cache key
   * @param {Object} options - Options
   * @returns {Promise<Object|null>} - Result or null
   */
  // eslint-disable-next-line max-lines-per-function -- GCR API approach requires comprehensive error handling
  async _tryGcrApiApproach(imageRepo, tag, normalizedRepo, cacheKey, options) {
    const delay = await this.getRateLimitDelay(options);
    await rateLimitDelay(delay);

    const repoInfo = this._parseGcrRepo(normalizedRepo);
    if (!repoInfo) {
      logger.warn(`Invalid GCR repo format: ${normalizedRepo} (expected project/repo)`);
      const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
      return fallbackResult
        ? { ...fallbackResult, provider: "gcr", isFallback: true }
        : { digest: null, tag, provider: "gcr", isFallback: false };
    }

    const token = await this._getAuthToken(repoInfo.project, repoInfo.repository, options.userId);
    const registryUrl = `https://gcr.io/v2/${repoInfo.project}/${repoInfo.repository}/manifests/${tag}`;
    const headers = {
      Accept:
        "application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
      logger.debug(`Using authenticated request for GCR image ${imageRepo}:${tag}`);
    } else {
      logger.debug(`Attempting anonymous access for GCR image ${imageRepo}:${tag}`);
    }

    const response = await this._requestGcrManifest(
      registryUrl,
      headers,
      imageRepo,
      tag,
      options.userId,
    );

    const successResult = this._handleGcrSuccess(response, imageRepo, tag, cacheKey);
    if (successResult) {
      return successResult;
    }

    if (response.status !== 200) {
      const fallbackResult = await this._tryDockerHubFallbackWithGcr(
        imageRepo,
        tag,
        cacheKey,
        options,
        response.status,
      );
      if (fallbackResult) {
        return fallbackResult;
      }

      logger.warn(
        `GCR returned status ${response.status} for ${imageRepo}:${tag} and Docker Hub fallback also failed - returning provider info without digest`,
      );
      return {
        digest: null,
        tag,
        provider: "gcr",
        isFallback: false,
      };
    }

    return null;
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `gcr:${normalizedRepo}:${tag}`;

    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      return cached;
    }

    if (tag && tag.includes("@sha256")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, { reason: "tag contains digest" });
      return null;
    }

    logger.debug(
      `Attempting to get digest from GCR for ${imageRepo}:${tag} (Note: GCR is deprecated)`,
    );

    try {
      const imageRef = `${imageRepo}:${tag}`;
      const craneResult = await this._tryCraneSkopeo(imageRef, imageRepo, tag, cacheKey);
      if (craneResult) {
        return craneResult;
      }

      logger.debug(`[GCR] crane/skopeo failed for ${imageRef}, trying API approach`);
      return this._tryGcrApiApproach(imageRepo, tag, normalizedRepo, cacheKey, options);
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw error;
      }

      return this._handleGcrError(error, imageRepo, tag, options);
    }
  }
  async getTagPublishDate(imageRepo, tag, options = {}) {
    // GCR doesn't have a public API for tag publish dates
    // Try Docker Hub fallback
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const DockerHubProvider = require("./DockerHubProvider");
    const dockerHubProvider = new DockerHubProvider();
    return dockerHubProvider.getTagPublishDate(normalizedRepo, tag, options);
  }

  async imageExists(imageRepo, options = {}) {
    try {
      const digest = await this.getLatestDigest(imageRepo, "latest", options);
      return digest !== null;
    } catch (_error) {
      return false;
    }
  }

  handleError(error) {
    if (this.isRateLimitError(error)) {
      const rateLimitError = new Error("GCR rate limit exceeded");
      rateLimitError.isRateLimitExceeded = true;
      rateLimitError.originalError = error;
      return rateLimitError;
    }
    return error;
  }

  /**
   * Clear cache for a specific image
   */
  clearCache(imageRepo, tag) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `gcr:${normalizedRepo}:${tag}`;
    digestCache.delete(cacheKey);
  }

  /**
   * Clear all cache entries
   */
  clearAllCache() {
    digestCache.clear();
  }
}

module.exports = GCRProvider;
