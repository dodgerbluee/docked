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

  /**
   * Get repository token from database
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @returns {Promise<Object|null>} - Credentials object or null
   */
  async _getRepositoryTokenFromDb(userId, imageRepo) {
    try {
      const { getRepositoryAccessTokenById, getDatabase } = require("../../../db/index");
      const db = getDatabase();
      if (!db) {
        return null;
      }

      const deployedImage = await new Promise((resolve, reject) => {
        db.get(
          `SELECT DISTINCT repository_token_id 
           FROM deployed_images 
           WHERE user_id = ? AND image_repo = ? AND repository_token_id IS NOT NULL
           LIMIT 1`,
          [userId, imageRepo],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row || null);
            }
          },
        );
      });

      if (!deployedImage?.repository_token_id) {
        return null;
      }

      const token = await getRepositoryAccessTokenById(deployedImage.repository_token_id, userId);
      if (token?.provider === "gitlab" && token.access_token) {
        logger.debug(`[GitLab] Using repository access token for ${imageRepo}`);
        return { token: token.access_token };
      }
      return null;
    } catch (err) {
      logger.debug(`[GitLab] Error looking up repository token for ${imageRepo}:`, err.message);
      return null;
    }
  }

  async getCredentials(userId, imageRepo = null) {
    if (userId && imageRepo) {
      const dbToken = await this._getRepositoryTokenFromDb(userId, imageRepo);
      if (dbToken) {
        return dbToken;
      }
    }

    const gitlabToken = process.env.GITLAB_TOKEN;
    return gitlabToken ? { token: gitlabToken } : {};
  }

  async getRateLimitDelay(options = {}) {
    const creds = await this.getCredentials(options.userId, options.imageRepo);
    // Authenticated: 500ms, Anonymous: 1000ms
    return creds.token ? 500 : 1000;
  }

  /**
   * Build authentication config for GitLab
   * @param {Object} creds - Credentials object
   * @param {string} namespace - Namespace
   * @param {string} repository - Repository
   * @returns {Object} - Request config
   */
  _buildAuthConfig(creds, namespace, repository) {
    const requestConfig = {
      params: {
        service: "container_registry",
        scope: `repository:${namespace}/${repository}:pull`,
      },
      timeout: 10000,
    };

    if (creds.token) {
      requestConfig.auth = {
        username: "gitlab-ci-token",
        password: creds.token,
      };
      this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: true });
    } else {
      this.logOperation("authenticate", `${namespace}/${repository}`, { authenticated: false });
    }

    return requestConfig;
  }

  /**
   * Get GitLab authentication token
   * @private
   */
  /**
   * Handle auth token error
   * @param {Error} error - Error object
   * @param {string} namespace - Namespace
   * @param {string} repository - Repository
   * @returns {null}
   */
  _handleAuthTokenError(error, namespace, repository) {
    const errorMessage = error?.message || error?.response?.statusText || String(error);
    logger.error(`Error getting GitLab token for ${namespace}/${repository}: ${errorMessage}`);
    return null;
  }

  async _getAuthToken(namespace, repository, userId, options = {}) {
    try {
      const authUrl = "https://gitlab.com/jwt/auth";
      const imageRepo = options?.imageRepo || null;
      const creds = await this.getCredentials(userId, imageRepo);
      const requestConfig = this._buildAuthConfig(creds, namespace, repository);
      const response = await axios.get(authUrl, requestConfig);
      return response.data?.token || null;
    } catch (error) {
      return this._handleAuthTokenError(error, namespace, repository);
    }
  }

  /**
   * Request GitLab manifest
   * @param {string} registryUrl - Registry URL
   * @param {Object} headers - Headers
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - Response object
   */
  async _requestGitLabManifest(registryUrl, headers, userId) {
    return retryWithBackoff(
      async () => {
        const resp = await axios.get(registryUrl, {
          headers,
          timeout: 10000,
          validateStatus: status => status < 500,
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
      userId,
    );
  }

  /**
   * Process successful GitLab manifest response
   * @param {Object} response - Response object
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Tag
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} - Result or null
   */
  _processGitLabManifestResponse(response, imageRepo, tag, cacheKey) {
    if (response.status === 200 && response.headers["docker-content-digest"]) {
      const digest = response.headers["docker-content-digest"];
      const result = { digest, tag };

      digestCache.set(cacheKey, result, config.cache.digestCacheTTL);

      this.logOperation("getLatestDigest", imageRepo, {
        tag,
        digest: `${digest.substring(0, 12)}...`,
      });
      return result;
    }
    return null;
  }

  // eslint-disable-next-line complexity -- GitLab digest retrieval requires comprehensive API handling with multiple conditional checks
  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `gitlab:${normalizedRepo}:${tag}`;

    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      return cached;
    }

    if (tag && tag.includes("@sha256")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, { reason: "tag contains digest" });
      return null;
    }

    try {
      const delay = await this.getRateLimitDelay(options);
      await rateLimitDelay(delay);

      if (!normalizedRepo.includes("/")) {
        logger.warn(`Invalid GitLab repo format: ${normalizedRepo} (expected group/project)`);
        return null;
      }

      const [namespace, ...repoParts] = normalizedRepo.split("/");
      const repository = repoParts.join("/");

      const token = await this._getAuthToken(namespace, repository, options.userId, {
        ...options,
        imageRepo,
      });
      if (!token) {
        logger.error(`Failed to get authentication token for ${namespace}/${repository}`);
        return null;
      }

      const registryUrl = `https://registry.gitlab.com/v2/${namespace}/${repository}/manifests/${tag}`;
      const headers = {
        Accept:
          "application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
        Authorization: `Bearer ${token}`,
      };

      const response = await this._requestGitLabManifest(registryUrl, headers, options.userId);
      return this._processGitLabManifestResponse(response, imageRepo, tag, cacheKey);
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

  getTagPublishDate(imageRepo, tag, _options = {}) {
    // GitLab Container Registry doesn't expose tag publish dates via Registry API
    // Could use GitLab API if we know the project, but that's handled by fallback
    return null;
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
