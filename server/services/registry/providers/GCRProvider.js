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
   * Get GCR authentication token (try anonymous first for public images)
   * @private
   */
  async _getAuthToken(namespace, repository, userId) {
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

    // Note: GCR is deprecated and will be shut down March 18, 2025
    // Many GCR images are also available on Docker Hub, so we'll try Docker Hub fallback
    logger.debug(`Attempting to get digest from GCR for ${imageRepo}:${tag} (Note: GCR is deprecated)`);

    try {
      // First, try using crane/skopeo (works for public images without authentication)
      // This is the same approach used by GHCR provider
      const imageRef = `${imageRepo}:${tag}`;
      logger.debug(`[GCR] Trying to get digest for ${imageRef} using crane/skopeo`);
      const digest = await getImageDigest(imageRef);
      
      if (digest) {
        const result = { 
          digest, 
          tag,
          provider: "gcr",
        };
        
        // Cache the result
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        
        this.logOperation("getLatestDigest", imageRepo, { tag, digest: digest.substring(0, 12) + "..." });
        logger.info(`[GCR] Successfully got digest for ${imageRepo}:${tag} using crane/skopeo - ${digest.substring(0, 12)}...`);
        return result;
      }
      
      // If crane/skopeo failed, try API approach (for private images or if tools unavailable)
      logger.debug(`[GCR] crane/skopeo failed for ${imageRef}, trying API approach`);
      
      // Rate limit delay
      const delay = await this.getRateLimitDelay(options);
      await rateLimitDelay(delay);

      // GCR uses project/repo format
      if (!normalizedRepo.includes("/")) {
        logger.warn(`Invalid GCR repo format: ${normalizedRepo} (expected project/repo)`);
        // Try Docker Hub fallback
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          return {
            ...fallbackResult,
            provider: "gcr",
            isFallback: true,
          };
        }
        return {
          digest: null,
          tag: tag,
          provider: "gcr",
          isFallback: false,
        };
      }

      const [project, ...repoParts] = normalizedRepo.split("/");
      const repository = repoParts.join("/");

      // Try to get auth token (anonymous access works for public images)
      const token = await this._getAuthToken(project, repository, options.userId);
      
      // Request manifest - try with token if available, otherwise try anonymous
      const registryUrl = `https://gcr.io/v2/${project}/${repository}/manifests/${tag}`;
      const headers = {
        Accept: "application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
      };
      
      // Add authorization header only if we have a token
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        logger.debug(`Using authenticated request for GCR image ${imageRepo}:${tag}`);
      } else {
        // Try anonymous access for public images
        logger.debug(`Attempting anonymous access for GCR image ${imageRepo}:${tag}`);
      }

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

          // Log response status for debugging
          if (resp.status !== 200) {
            logger.debug(`GCR returned status ${resp.status} for ${imageRepo}:${tag}${token ? " (authenticated)" : " (anonymous)"}`);
          }

          // If 401 (unauthorized) or 403 (forbidden), try Docker Hub fallback
          // 404 means image not found, also try fallback
          if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
            logger.debug(`GCR returned ${resp.status} for ${imageRepo}:${tag}, will try Docker Hub fallback`);
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
        const result = { 
          digest, 
          tag,
          provider: "gcr", // Set provider to GCR
        };
        
        // Cache the result
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        
        this.logOperation("getLatestDigest", imageRepo, { tag, digest: digest.substring(0, 12) + "..." });
        return result;
      }

      // If GCR failed (401, 404, 403, or other errors), try Docker Hub fallback
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status !== 200) {
        logger.debug(`GCR returned ${response.status} for ${imageRepo}:${tag}, trying Docker Hub fallback`);
        // Log warning about GCR deprecation if we get 404 or 403 (permission errors)
        if (response.status === 404 || response.status === 403) {
          logger.warn(`GCR image ${imageRepo}:${tag} may not be accessible (status ${response.status} - GCR is deprecated, project may need migration to Artifact Registry, or image may be private)`);
        }
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          // Cache with GCR key but keep provider as "gcr" so the Google icon shows
          // even though we're using Docker Hub for the digest
          const result = {
            ...fallbackResult,
            provider: "gcr", // Keep as GCR so icon shows correctly
            isFallback: true, // But mark that we used Docker Hub fallback
          };
          digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
          logger.info(`Using Docker Hub fallback for GCR image ${imageRepo}:${tag} (keeping provider as gcr for icon)`);
          return result;
        }
        
        // If Docker Hub fallback also failed, still return provider info so filtering works
        logger.warn(`GCR returned status ${response.status} for ${imageRepo}:${tag} and Docker Hub fallback also failed - returning provider info without digest`);
        return {
          digest: null,
          tag: tag,
          provider: "gcr",
          isFallback: false,
        };
      }

      return null;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw error;
      }
      
      // On error, try Docker Hub fallback
      if (error.response?.status !== 404) {
        logger.debug(`GCR error for ${imageRepo}:${tag}, trying Docker Hub fallback:`, error.message);
        // Log warning about potential GCR deprecation issues
        if (error.response?.status === 403 || error.response?.status === 401) {
          logger.warn(`GCR authentication/access error for ${imageRepo}:${tag} - GCR is deprecated, project may need migration to Artifact Registry`);
        }
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          // Keep provider as "gcr" so the Google icon shows, even though digest comes from Docker Hub
          return {
            ...fallbackResult,
            provider: "gcr",
            isFallback: true,
          };
        }
      } else {
        // 404 specifically - image not found in GCR
        logger.debug(`GCR image ${imageRepo}:${tag} not found (404), trying Docker Hub fallback`);
        const fallbackResult = await this._tryDockerHubFallback(imageRepo, tag, options);
        if (fallbackResult) {
          // Keep provider as "gcr" so the Google icon shows
          return {
            ...fallbackResult,
            provider: "gcr",
            isFallback: true,
          };
        }
      }
      
      logger.warn(`Failed to get digest for GCR image ${imageRepo}:${tag} - GCR may be deprecated or inaccessible, and Docker Hub fallback also failed`);
      // Even if we can't get a digest, return an object with provider set so the icon shows
      // This allows the container to be filtered correctly even without digest
      return {
        digest: null,
        tag: tag,
        provider: "gcr",
        isFallback: false,
      };
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

