/**
 * Docker Hub Registry Provider
 * 
 * Implements Docker Hub Registry API v2 for fetching image digests
 * and metadata. Supports both anonymous and authenticated requests.
 */

const axios = require("axios");
const RegistryProvider = require("../RegistryProvider");
const { getDockerHubCreds } = require("../../../utils/dockerHubCreds");
const { rateLimitDelay } = require("../../../utils/rateLimiter");
const { retryWithBackoff } = require("../../../utils/retry");
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
    // Handle docker.io, registry-1.docker.io, or plain repos (assumed Docker Hub)
    if (
      imageRepo.startsWith("docker.io/") ||
      imageRepo.startsWith("registry-1.docker.io/") ||
      imageRepo.startsWith("registry.docker.io/")
    ) {
      return true;
    }
    // If it has a slash and no registry prefix, assume Docker Hub
    if (imageRepo.includes("/") && !imageRepo.includes(".") && !imageRepo.startsWith("ghcr.io/")) {
      return true;
    }
    // lscr.io images are also on Docker Hub
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
    
    // lscr.io images are also on Docker Hub under the same name
    if (imageRepo.startsWith("lscr.io/")) {
      repo = imageRepo.replace("lscr.io/", "");
    }
    
    return repo;
  }

  async getCredentials(userId) {
    if (!userId) {
      return {};
    }
    return await getDockerHubCreds(userId);
  }

  async getRateLimitDelay(options = {}) {
    const creds = await this.getCredentials(options.userId);
    // Authenticated: 500ms, Anonymous: 1000ms
    return creds.token && creds.username ? 500 : 1000;
  }

  /**
   * Get Docker Registry API v2 token for authentication
   * @private
   */
  async _getAuthToken(namespace, repository, userId) {
    try {
      const authUrl = "https://auth.docker.io/token";
      const params = {
        service: "registry.docker.io",
        scope: `repository:${namespace}/${repository}:pull`,
      };

      const requestConfig = {
        params,
        timeout: 10000,
      };

      const creds = await this.getCredentials(userId);
      if (creds.token && creds.username) {
        requestConfig.auth = {
          username: creds.username,
          password: creds.token,
        };
        this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: true });
      }

      const response = await axios.get(authUrl, requestConfig);
      return response.data?.token || null;
    } catch (error) {
      logger.error(`Error getting Docker Registry token for ${namespace}/${repository}:`, error.message);
      return null;
    }
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `${normalizedRepo}:${tag}`;

    // Check cache with original tag
    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      return cached;
    }

    // Handle incomplete SHA256 digests (e.g., "tag@sha256" without hash)
    // Strip incomplete digest markers before processing
    let cleanedTag = tag;
    if (tag && tag.includes("@sha256") && !tag.includes("@sha256:")) {
      // Remove incomplete @sha256 marker
      cleanedTag = tag.replace("@sha256", "");
      logger.debug(`[DockerHub] Stripped incomplete @sha256 marker from tag: ${tag} -> ${cleanedTag}`);
      
      // Also check cache with cleaned tag (in case it was cached with cleaned tag)
      const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
      const cleanedCached = digestCache.get(cleanedCacheKey);
      if (cleanedCached) {
        // Cache with original tag key for future lookups
        digestCache.set(cacheKey, cleanedCached, config.cache.digestCacheTTL);
        this.logOperation("getLatestDigest (cached)", imageRepo, { tag: cleanedTag });
        return cleanedCached;
      }
    }

    // Skip if tag contains complete digest
    if (cleanedTag && cleanedTag.includes("@sha256:")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, { reason: "tag contains complete digest" });
      return null;
    }

    try {
      // First, try using crane/skopeo (works for public images, uses registry protocol)
      // This bypasses API complexity and rate limits are handled by Docker Hub's registry limits
      const { getImageDigest } = require("../../../utils/containerTools");
      const imageRef = `${normalizedRepo}:${cleanedTag}`;
      logger.debug(`[DockerHub] Trying to get digest for ${imageRef} using crane/skopeo`);
      const digest = await getImageDigest(imageRef);
      
      if (digest) {
        const result = { 
          digest, 
          tag: cleanedTag,
          provider: "dockerhub",
        };
        
        // Cache the result with both original and cleaned tag keys
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        if (cleanedTag !== tag) {
          const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
          digestCache.set(cleanedCacheKey, result, config.cache.digestCacheTTL);
        }
        
        this.logOperation("getLatestDigest", imageRepo, { tag: cleanedTag, digest: digest.substring(0, 12) + "..." });
        logger.info(`[DockerHub] Successfully got digest for ${imageRepo}:${cleanedTag} using crane/skopeo - ${digest.substring(0, 12)}...`);
        return result;
      }
      
      // If crane/skopeo failed, try API approach
      logger.debug(`[DockerHub] crane/skopeo failed for ${imageRef}, trying API approach`);

      // Rate limit delay
      const delay = await this.getRateLimitDelay(options);
      await rateLimitDelay(delay);

      // Parse namespace and repository
      let namespace = "library";
      let repository = normalizedRepo;

      if (normalizedRepo.includes("/")) {
        const parts = normalizedRepo.split("/");
        namespace = parts[0];
        repository = parts.slice(1).join("/");
      }

      // Get auth token
      const token = await this._getAuthToken(namespace, repository, options.userId);
      if (!token) {
        logger.error(`Failed to get authentication token for ${namespace}/${repository}`);
        return null;
      }

      // Request manifest - accept both manifest list (multi-arch) and regular manifest (single-arch)
      const registryUrl = `https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${cleanedTag}`;
      const headers = {
        Accept: "application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.v1+json",
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
            const error = new Error("Rate limited by Docker Hub");
            error.response = { status: 429 };
            error.isRateLimitExceeded = true;
            throw error;
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
          tag: cleanedTag,
          provider: "dockerhub", // Explicitly set provider
        };
        
        // Cache the result with both original and cleaned tag keys
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        if (cleanedTag !== tag) {
          const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
          digestCache.set(cleanedCacheKey, result, config.cache.digestCacheTTL);
        }
        
        this.logOperation("getLatestDigest", imageRepo, { tag: cleanedTag, digest: digest.substring(0, 12) + "..." });
        logger.debug(`[DockerHub] Successfully got digest for ${imageRepo}:${cleanedTag} via API - ${digest.substring(0, 12)}...`);
        return result;
      }
      
      // If we got a 200 but no digest header, log it for debugging
      if (response.status === 200 && !response.headers["docker-content-digest"]) {
        logger.warn(`Docker Hub returned 200 for ${imageRepo}:${cleanedTag} but no docker-content-digest header. Content-Type: ${response.headers["content-type"]}`);
      }

      // Log detailed error information for debugging
      if (response.status !== 200 && response.status !== 404) {
        logger.warn(`Failed to get digest for ${imageRepo}:${cleanedTag} (status: ${response.status})`, {
          imageRepo,
          tag: cleanedTag,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } else if (response.status === 404) {
        logger.debug(`Image ${imageRepo}:${cleanedTag} not found on Docker Hub (404)`);
      }

      return null;
    } catch (error) {
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
        logger.debug(`Image ${imageRepo}:${cleanedTag} not found on Docker Hub (404 in catch)`);
      }
      return null;
    }
  }

  async getTagPublishDate(imageRepo, tag, options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `publishDate:${normalizedRepo}:${tag}`;

    // Check cache
    const cached = digestCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const delay = await this.getRateLimitDelay(options);
      await rateLimitDelay(delay);

      let namespace = "library";
      let repository = normalizedRepo;

      if (normalizedRepo.includes("/")) {
        const parts = normalizedRepo.split("/");
        namespace = parts[0];
        repository = parts.slice(1).join("/");
      }

      const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${tag}/`;
      const headers = {
        "User-Agent": "Docked/1.0",
      };

      const creds = await this.getCredentials(options.userId);
      if (creds.token && creds.username) {
        headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString("base64")}`;
      }

      const response = await axios.get(hubApiUrl, {
        headers,
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 200 && response.data) {
        const publishDate = response.data.tag_last_pushed || response.data.last_updated;
        if (publishDate) {
          digestCache.set(cacheKey, publishDate, config.cache.digestCacheTTL);
          return publishDate;
        }
      }

      return null;
    } catch (error) {
      if (error.response?.status !== 404) {
        logger.error(`Error fetching publish date for ${imageRepo}:${tag}:`, error.message);
      }
      return null;
    }
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
    } catch (error) {
      return false;
    }
  }

  handleError(error) {
    if (this.isRateLimitError(error)) {
      const rateLimitError = new Error("Docker Hub rate limit exceeded");
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

