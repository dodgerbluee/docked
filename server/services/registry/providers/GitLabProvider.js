/**
 * GitLab Container Registry Provider
 * 
 * Implements GitLab Container Registry API v2 for fetching image digests
 * and metadata. Uses GitLab token for authentication.
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

class GitLabProvider extends RegistryProvider {
  constructor() {
    super();
    this.name = "gitlab";
  }

  getName() {
    return this.name;
  }

  canHandle(imageRepo) {
    return imageRepo.startsWith("registry.gitlab.com/");
  }

  normalizeRepo(imageRepo) {
    // Remove registry.gitlab.com/ prefix
    return imageRepo.replace(/^registry\.gitlab\.com\//, "");
  }

  async getCredentials(userId) {
    // GitLab uses token from environment
    const gitlabToken = process.env.GITLAB_TOKEN;
    if (gitlabToken) {
      return { token: gitlabToken };
    }
    return {};
  }

  async getRateLimitDelay(options = {}) {
    const creds = await this.getCredentials(options.userId);
    // Authenticated: 500ms, Anonymous: 1000ms
    return creds.token ? 500 : 1000;
  }

  /**
   * Get GitLab authentication token
   * @private
   */
  async _getAuthToken(namespace, repository, userId) {
    try {
      // GitLab uses JWT token from auth service
      const authUrl = "https://gitlab.com/jwt/auth";
      const scope = `repository:${namespace}/${repository}:pull`;
      const params = {
        service: "container_registry",
        scope,
      };

      const requestConfig = {
        params,
        timeout: 10000,
      };

      const creds = await this.getCredentials(userId);
      if (creds.token) {
        // GitLab uses username/token authentication
        requestConfig.auth = {
          username: "gitlab-ci-token", // Standard username for CI/CD tokens
          password: creds.token,
        };
        this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: true });
      } else {
        this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: false });
      }

      const response = await axios.get(authUrl, requestConfig);
      return response.data?.token || null;
    } catch (error) {
      logger.error(`Error getting GitLab token for ${namespace}/${repository}:`, error.message);
      return null;
    }
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `gitlab:${normalizedRepo}:${tag}`;

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

      // GitLab uses group/project format
      if (!normalizedRepo.includes("/")) {
        logger.warn(`Invalid GitLab repo format: ${normalizedRepo} (expected group/project)`);
        return null;
      }

      const [namespace, ...repoParts] = normalizedRepo.split("/");
      const repository = repoParts.join("/");

      // Get auth token
      const token = await this._getAuthToken(namespace, repository, options.userId);
      if (!token) {
        logger.error(`Failed to get authentication token for ${namespace}/${repository}`);
        return null;
      }

      // Request manifest
      const registryUrl = `https://registry.gitlab.com/v2/${namespace}/${repository}/manifests/${tag}`;
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
            const error = new Error("Rate limited by GitLab");
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
        const result = { digest, tag };
        
        // Cache the result
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        
        this.logOperation("getLatestDigest", imageRepo, { tag, digest: digest.substring(0, 12) + "..." });
        return result;
      }

      if (response.status !== 200 && response.status !== 404) {
        logger.warn(`Failed to get digest for ${imageRepo}:${tag} (status: ${response.status})`);
      }

      return null;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw error;
      }
      if (error.response?.status !== 404) {
        logger.error(`Error fetching GitLab digest for ${imageRepo}:${tag}:`, error.message);
      }
      return null;
    }
  }

  async getTagPublishDate(imageRepo, tag, options = {}) {
    // GitLab Container Registry doesn't expose tag publish dates via Registry API
    // Could use GitLab API if we know the project, but that's handled by fallback
    return null;
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
      const rateLimitError = new Error("GitLab rate limit exceeded");
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
    const cacheKey = `gitlab:${normalizedRepo}:${tag}`;
    digestCache.delete(cacheKey);
  }

  /**
   * Clear all cache entries
   */
  clearAllCache() {
    digestCache.clear();
  }
}

module.exports = GitLabProvider;

