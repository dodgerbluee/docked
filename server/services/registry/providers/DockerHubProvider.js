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
      logger.debug(
        `[Registry] Stripped incomplete @sha256 marker from tag: ${tag} -> ${cleanedTag}`
      );

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
      this.logOperation("getLatestDigest (skipped)", imageRepo, {
        reason: "tag contains complete digest",
      });
      return null;
    }

    try {
      const imageRef = `${normalizedRepo}:${cleanedTag}`;

      // Priority 1: Try using crane/skopeo (uses OCI Distribution Spec registry protocol, not Docker Hub REST API)
      // This is the primary method - uses standard registry protocol directly via command-line tools
      const { getImageDigest } = require("../../../utils/containerTools");
      logger.debug(
        `[Registry] Attempting to get digest for ${imageRef} using crane/skopeo (primary method - uses registry protocol)`
      );
      const digest = await getImageDigest(imageRef);

      if (digest) {
        const result = {
          digest,
          tag: cleanedTag,
          provider: "dockerhub",
          method: "crane-skopeo", // Uses OCI Distribution Spec registry protocol
        };

        // Cache the result with both original and cleaned tag keys
        digestCache.set(cacheKey, result, config.cache.digestCacheTTL);
        if (cleanedTag !== tag) {
          const cleanedCacheKey = `${normalizedRepo}:${cleanedTag}`;
          digestCache.set(cleanedCacheKey, result, config.cache.digestCacheTTL);
        }

        this.logOperation("getLatestDigest (crane-skopeo)", imageRepo, {
          tag: cleanedTag,
          digest: digest.substring(0, 12) + "...",
        });
        logger.info(
          `[Registry] ✅ Successfully got digest for ${imageRepo}:${cleanedTag} using crane/skopeo (registry protocol) - ${digest.substring(0, 12)}...`
        );
        return result;
      }

      // If crane/skopeo failed, return null (no Docker Hub API fallback)
      logger.warn(`[Registry] ⚠️ crane/skopeo failed for ${imageRef}, no digest available`);

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
        logger.debug(`Image ${imageRepo}:${cleanedTag} not found in registry (404 in catch)`);
      }
      return null;
    }
  }

  async getTagPublishDate(imageRepo, tag, options = {}) {
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
    } catch (error) {
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
