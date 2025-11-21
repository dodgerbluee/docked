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

  async getCredentials(userId) {
    // GCR typically requires service account credentials
    // For now, we'll try anonymous access, then fall back to Docker Hub
    return {};
  }

  async getRateLimitDelay(options = {}) {
    // GCR has similar rate limits to Docker Hub
    return 1000;
  }

  /**
   * Get GCR authentication token
   * @private
   */
  async _getAuthToken(namespace, repository, userId) {
    try {
      // GCR uses OAuth2 token service
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

      const response = await axios.get(authUrl, requestConfig);
      return response.data?.token || null;
    } catch (error) {
      logger.debug(`Error getting GCR token for ${namespace}/${repository}:`, error.message);
      return null;
    }
  }

  /**
   * Try Docker Hub as fallback for GCR images
   * Many GCR images are also available on Docker Hub under the same name
   * @private
   */
  async _tryDockerHubFallback(imageRepo, tag, options) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    
    // Import DockerHubProvider to use its methods
    const DockerHubProvider = require("./DockerHubProvider");
    const dockerHubProvider = new DockerHubProvider();
    
    try {
      logger.debug(`Trying Docker Hub fallback for GCR image: ${normalizedRepo}:${tag}`);
      return await dockerHubProvider.getLatestDigest(normalizedRepo, tag, options);
    } catch (error) {
      logger.debug(`Docker Hub fallback also failed for ${normalizedRepo}:${tag}:`, error.message);
      return null;
    }
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `gcr:${normalizedRepo}:${tag}`;

    // Check cache
    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      return cached;
    }

    // Skip if tag contains digest
    if (tag && tag.includes("@sha256")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, { reason: "tag contains digest" });
      return null;
    }

    try {
      // Rate limit delay
      const delay = await this.getRateLimitDelay(options);
      await rateLimitDelay(delay);

      // GCR uses project/repo format
      if (!normalizedRepo.includes("/")) {
        logger.warn(`Invalid GCR repo format: ${normalizedRepo} (expected project/repo)`);
        // Try Docker Hub fallback
        return await this._tryDockerHubFallback(imageRepo, tag, options);
      }

      const [project, ...repoParts] = normalizedRepo.split("/");
      const repository = repoParts.join("/");

      // Get auth token
      const token = await this._getAuthToken(project, repository, options.userId);
      if (!token) {
        logger.debug(`Failed to get GCR token for ${project}/${repository}, trying Docker Hub fallback`);
        // Try Docker Hub fallback
        return await this._tryDockerHubFallback(imageRepo, tag, options);
      }

      // Request manifest
      const registryUrl = `https://gcr.io/v2/${project}/${repository}/manifests/${tag}`;
      const headers = {
        Accept: "application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
        Authorization: `Bearer ${token}`,
      };

      const response = await retryWithBackoff(
        async () => {
          const resp = await axios.get(registryUrl, {
            headers,
            timeout: 10000,
            validateStatus: (status) => status < 500,
          });

          if (resp.status === 429) {
            const error = new Error("Rate limited by GCR");
            error.response = { status: 429 };
            error.isRateLimitExceeded = true;
            throw error;
          }

          // If 401 (unauthorized) or 404 (not found), try Docker Hub fallback
          if (resp.status === 401 || resp.status === 404) {
            logger.debug(`GCR returned ${resp.status} for ${imageRepo}:${tag}, trying Docker Hub fallback`);
            // Don't return here - let the code below handle the fallback
          }

          return resp;
        },
        3,
        1000,
        options.userId
      );

      if (response.status === 200 && response.headers["docker-content-digest"]) {
        const digest = response.headers["docker-content-digest"];
        const result = { digest, tag };
        
        // Cache the result
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        
        this.logOperation("getLatestDigest", imageRepo, { tag, digest: digest.substring(0, 12) + "..." });
        return result;
      }

      // If GCR failed (401, 404, or other errors), try Docker Hub fallback
      if (response.status === 401 || response.status === 404 || response.status !== 200) {
        logger.debug(`GCR returned ${response.status} for ${imageRepo}:${tag}, trying Docker Hub fallback`);
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          // Cache with GCR key but mark as Docker Hub source
          digestCache.set(cacheKey, fallbackResult, config.cache.digestCacheTTL);
          logger.info(`Using Docker Hub fallback for GCR image ${imageRepo}:${tag}`);
          return fallbackResult;
        }
      }

      return null;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw error;
      }
      
      // On error, try Docker Hub fallback
      if (error.response?.status !== 404) {
        logger.debug(`GCR error for ${imageRepo}:${tag}, trying Docker Hub fallback:`, error.message);
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          return fallbackResult;
        }
      }
      
      return null;
    }
  }

  async getTagPublishDate(imageRepo, tag, options = {}) {
    // GCR doesn't have a public API for tag publish dates
    // Try Docker Hub fallback
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const DockerHubProvider = require("./DockerHubProvider");
    const dockerHubProvider = new DockerHubProvider();
    return await dockerHubProvider.getTagPublishDate(normalizedRepo, tag, options);
  }

  async imageExists(imageRepo, options = {}) {
    try {
      const digest = await this.getLatestDigest(imageRepo, "latest", options);
      return digest !== null;
    } catch (error) {
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

