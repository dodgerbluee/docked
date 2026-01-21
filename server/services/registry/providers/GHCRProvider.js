/**
 * GitHub Container Registry (GHCR) Provider
 *
 * Implements GHCR Registry API v2 for fetching image digests
 * and metadata. Uses GitHub token for authentication.
 */

const RegistryProvider = require("../RegistryProvider");
const config = require("../../../config");
const Cache = require("../../../utils/cache");
const logger = require("../../../utils/logger");
const { getImageDigest } = require("../../../utils/containerTools");

// Cache for digests
const digestCache = new Cache();

class GHCRProvider extends RegistryProvider {
  constructor() {
    super();
    this.name = "ghcr";
  }

  getName() {
    return this.name;
  }

  canHandle(imageRepo) {
    return imageRepo.startsWith("ghcr.io/");
  }

  normalizeRepo(imageRepo) {
    // Remove ghcr.io/ prefix
    return imageRepo.replace(/^ghcr\.io\//, "");
  }

  getRateLimitDelay(_options = {}) {
    // No rate limiting needed with crane/skopeo - they handle it internally
    return 0;
  }

  /**
   * Extract GitHub repo from GHCR image name
   * @private
   */
  _extractGitHubRepo(imageRepo) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    // GHCR images are in format: owner/repo
    // e.g., ghcr.io/immich-app/immich-server -> immich-app/immich-server
    if (normalizedRepo.includes("/")) {
      return normalizedRepo;
    }
    return null;
  }

  /**
   * Try GitHub Releases fallback for GHCR images
   * @private
   */
  async _tryGitHubReleasesFallback(imageRepo, tag, options) {
    const githubRepo = options.githubRepo || this._extractGitHubRepo(imageRepo);

    if (!githubRepo) {
      logger.debug(`Cannot use GitHub Releases fallback for ${imageRepo}: no GitHub repo found`);
      return null;
    }

    try {
      const GitHubReleasesProvider = require("./GitHubReleasesProvider");
      const fallbackProvider = new GitHubReleasesProvider();

      logger.info(
        `Trying GitHub Releases fallback for GHCR image: ${imageRepo}:${tag} (repo: ${githubRepo})`
      );
      const result = await fallbackProvider.getLatestDigest(imageRepo, tag, {
        userId: options.userId,
        githubRepo,
      });

      if (result) {
        logger.info(
          `GitHub Releases fallback succeeded for ${imageRepo}:${tag} - latest version: ${result.tag}`
        );
      } else {
        logger.debug(
          `GitHub Releases fallback returned null for ${imageRepo}:${tag} (repo: ${githubRepo})`
        );
      }

      return result;
    } catch (error) {
      logger.warn(`GitHub Releases fallback failed for ${imageRepo}:${tag}:`, error.message);
      return null;
    }
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const normalizedRepo = this.normalizeRepo(imageRepo);
    const cacheKey = `ghcr:${normalizedRepo}:${tag}`;

    // Check cache
    const cached = digestCache.get(cacheKey);
    if (cached) {
      this.logOperation("getLatestDigest (cached)", imageRepo, { tag });
      logger.debug(`[GHCR] Cache hit for ${imageRepo}:${tag}`);
      return cached;
    }

    logger.debug(`[GHCR] Cache miss for ${imageRepo}:${tag}, fetching with crane/skopeo`);

    // Skip if tag contains digest
    if (tag && tag.includes("@sha256")) {
      this.logOperation("getLatestDigest (skipped)", imageRepo, { reason: "tag contains digest" });
      return null;
    }

    try {
      // Build full image reference
      const imageRef = `${imageRepo}:${tag}`;

      // Use crane/skopeo to get digest (no authentication needed!)
      logger.debug(`[GHCR] Getting digest for ${imageRef} using crane/skopeo`);
      const digest = await getImageDigest(imageRef);

      if (digest) {
        const result = { digest, tag };

        // Cache the result
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);

        this.logOperation("getLatestDigest", imageRepo, {
          tag,
          digest: `${digest.substring(0, 12)}...`,
        });
        logger.info(
          `[GHCR] Successfully got digest for ${imageRepo}:${tag} - ${digest.substring(0, 12)}...`
        );
        return result;
      }

      // If crane/skopeo failed, try GitHub Releases fallback
      logger.debug(`[GHCR] crane/skopeo failed for ${imageRef}, trying GitHub Releases fallback`);
      const fallbackResult = await this._tryGitHubReleasesFallback(imageRepo, tag, options);
      if (fallbackResult) {
        // Cache the fallback result
        digestCache.set(cacheKey, fallbackResult, config.cache.digestCacheTTL);
        logger.info(
          `[GHCR] Using GitHub Releases fallback for ${imageRepo}:${tag} - version: ${fallbackResult.tag || fallbackResult.version}`
        );
        return {
          ...fallbackResult,
          provider: "github-releases",
          isFallback: true,
        };
      }

      logger.warn(
        `[GHCR] Failed to get digest for ${imageRepo}:${tag} - crane/skopeo failed and no fallback available`
      );
      return null;
    } catch (error) {
      logger.warn(
        `[GHCR] Error fetching digest for ${imageRepo}:${tag}, trying GitHub Releases fallback:`,
        error.message
      );
      const fallbackResult = await this._tryGitHubReleasesFallback(imageRepo, tag, options);
      if (fallbackResult) {
        logger.info(`[GHCR] Using GitHub Releases fallback after error for ${imageRepo}:${tag}`);
        return {
          ...fallbackResult,
          provider: "github-releases",
          isFallback: true,
        };
      }

      logger.error(
        `[GHCR] Error fetching digest for ${imageRepo}:${tag} and fallback also failed:`,
        error.message
      );
      return null;
    }
  }

  getTagPublishDate(imageRepo, tag, _options = {}) {
    // GHCR doesn't have a public API for tag publish dates
    // We could potentially use GitHub API if we know the repo, but that's handled by fallback
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
      const rateLimitError = new Error("GHCR rate limit exceeded");
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
    const cacheKey = `ghcr:${normalizedRepo}:${tag}`;
    digestCache.delete(cacheKey);
  }

  /**
   * Clear all cache entries
   */
  clearAllCache() {
    digestCache.clear();
  }
}

module.exports = GHCRProvider;
