/**
 * GitHub Releases Fallback Provider
 *
 * This provider uses GitHub Releases API as a fallback when registry APIs
 * fail or are rate limited. It compares release tags instead of digests.
 *
 * Note: This is a fallback provider and should be used when:
 * 1. Primary registry API fails or is rate limited
 * 2. Image has a known GitHub repository mapping
 * 3. Semantic version comparison is acceptable (less precise than digest comparison)
 */

const RegistryProvider = require("../RegistryProvider");
const githubService = require("../../githubService");
const logger = require("../../../utils/logger");
const { getImageDigest } = require("../../../utils/containerTools");

class GitHubReleasesProvider extends RegistryProvider {
  constructor() {
    super();
    this.name = "github-releases";
  }

  getName() {
    return this.name;
  }

  canHandle(imageRepo, options = {}) {
    // Only handle if we have a GitHub repo mapping
    return Boolean(options.githubRepo);
  }

  /**
   * Extract GitHub repo from image repo (heuristic)
   * @private
   */
  _extractGitHubRepo(imageRepo) {
    // Try to infer GitHub repo from image repo
    // e.g., ghcr.io/owner/repo -> owner/repo
    if (imageRepo.startsWith("ghcr.io/")) {
      return imageRepo.replace("ghcr.io/", "");
    }

    // For Docker Hub images, we'd need a mapping table
    // This is a fallback, so we return null and require explicit mapping
    return null;
  }

  /**
   * Normalize version for comparison (remove 'v' prefix, lowercase)
   * @private
   */
  _normalizeVersion(version) {
    if (!version) return "";
    return String(version).replace(/^v/i, "").trim().toLowerCase();
  }

  /**
   * Compare two versions (simple string comparison after normalization)
   * @private
   */
  _compareVersions(v1, v2) {
    const n1 = this._normalizeVersion(v1);
    const n2 = this._normalizeVersion(v2);

    // Try semantic version comparison if both look like versions
    if (n1.match(/^\d+\.\d+/) && n2.match(/^\d+\.\d+/)) {
      const parts1 = n1.split(".").map(Number);
      const parts2 = n2.split(".").map(Number);

      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
      }
      return 0;
    }

    // Fallback to string comparison
    return n1.localeCompare(n2);
  }

  /**
   * Try to get digest from GHCR for a release tag
   * @param {string} imageRepo - Image repository
   * @param {string} releaseTag - Release tag
   * @param {Object} latestRelease - Latest release object
   * @param {Object} options - Options
   * @returns {Promise<Object|null>} - Result with digest or null
   */
  async _tryGetDigestFromGHCR(imageRepo, releaseTag, latestRelease, options) {
    if (!imageRepo.startsWith("ghcr.io/")) {
      return null;
    }

    try {
      logger.info(
        `[GitHub Releases] Attempting to get digest from GHCR for ${imageRepo}:${releaseTag} (using release tag from GitHub)`,
      );
      const digest = await this._getDigestFromGHCR(imageRepo, releaseTag, options);

      if (digest) {
        logger.info(
          `[GitHub Releases] Successfully got digest from GHCR for ${imageRepo}:${releaseTag} - ${digest.substring(0, 12)}...`,
        );
        return {
          digest,
          tag: releaseTag,
          version: releaseTag,
          publishDate: latestRelease.published_at,
          isFallback: false,
          source: "ghcr",
          provider: "ghcr",
        };
      }
      logger.debug(
        `[GitHub Releases] GHCR returned no digest for ${imageRepo}:${releaseTag}, using version-only result`,
      );
    } catch (ghcrError) {
      logger.debug(
        `[GitHub Releases] Failed to get digest from GHCR for ${imageRepo}:${releaseTag}:`,
        ghcrError.message,
      );
    }
    return null;
  }

  /**
   * Build version-only result (no digest available)
   * @param {string} imageRepo - Image repository
   * @param {string} releaseTag - Release tag
   * @param {Object} latestRelease - Latest release object
   * @returns {Object} - Version-only result
   */
  _buildVersionOnlyResult(imageRepo, releaseTag, latestRelease) {
    logger.debug(
      `[GitHub Releases] Returning version-only result for ${imageRepo} - tag: ${releaseTag}`,
    );
    return {
      digest: null,
      tag: releaseTag,
      version: releaseTag,
      publishDate: latestRelease.published_at,
      isFallback: true,
      source: "github-releases",
    };
  }

  async getLatestDigest(imageRepo, tag = "latest", options = {}) {
    const githubRepo = options.githubRepo || this._extractGitHubRepo(imageRepo);
    if (!githubRepo) {
      return null;
    }

    try {
      this.logOperation("getLatestRelease", imageRepo, { githubRepo, tag });
      const latestRelease = await githubService.getLatestRelease(githubRepo);

      if (!latestRelease?.tag_name) {
        logger.debug(`[GitHub Releases] No release found for ${githubRepo}`);
        return null;
      }

      const releaseTag = latestRelease.tag_name;
      logger.info(`[GitHub Releases] Found latest release ${releaseTag} for ${githubRepo}`);

      const digestResult = await this._tryGetDigestFromGHCR(imageRepo, releaseTag, latestRelease, options);
      if (digestResult) {
        return digestResult;
      }

      return this._buildVersionOnlyResult(imageRepo, releaseTag, latestRelease);
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw error;
      }
      logger.debug(`[GitHub Releases] Failed for ${imageRepo}:`, error.message);
      return null;
    }
  }

  /**
   * Check if current version is outdated compared to latest release
   * @param {string} currentTag - Current tag/version
   * @param {string} latestTag - Latest tag/version
   * @returns {boolean} - True if update is available
   */
  hasUpdate(currentTag, latestTag) {
    if (!currentTag || !latestTag) {
      return false;
    }

    const comparison = this._compareVersions(currentTag, latestTag);
    return comparison < 0; // current < latest means update available
  }

  /**
   * This provider doesn't support digest-based comparison
   * @returns {boolean} - Always false
   */
  supportsDigestComparison() {
    return false;
  }

  async getTagPublishDate(imageRepo, tag, options = {}) {
    const githubRepo = options.githubRepo || this._extractGitHubRepo(imageRepo);

    if (!githubRepo || !tag) {
      return null;
    }

    try {
      const release = await githubService.getReleaseByTag(githubRepo, tag);
      return release?.published_at || null;
    } catch (error) {
      logger.debug(`Failed to get publish date for ${githubRepo}:${tag}:`, error.message);
      return null;
    }
  }

  async imageExists(imageRepo, options = {}) {
    const githubRepo = options.githubRepo || this._extractGitHubRepo(imageRepo);

    if (!githubRepo) {
      return false;
    }

    try {
      const release = await githubService.getLatestRelease(githubRepo);
      return release !== null;
    } catch (_error) {
      return false;
    }
  }

  handleError(error) {
    if (this.isRateLimitError(error)) {
      const rateLimitError = new Error("GitHub API rate limit exceeded");
      rateLimitError.isRateLimitExceeded = true;
      rateLimitError.originalError = error;
      return rateLimitError;
    }
    return error;
  }

  /**
   * Get digest from GHCR for a specific tag using crane/skopeo
   * This is used when we have a release tag from GitHub and want to get the actual digest
   * @private
   */
  async _getDigestFromGHCR(imageRepo, tag, _options = {}) {
    try {
      // Build full image reference
      const imageRef = `${imageRepo}:${tag}`;

      logger.debug(`[GitHub Releases] Getting digest from GHCR for ${imageRef} using crane/skopeo`);
      const digest = await getImageDigest(imageRef);

      if (digest) {
        logger.info(
          `[GitHub Releases] Successfully got digest from GHCR for ${imageRef} - ${digest.substring(0, 12)}...`,
        );
        return digest;
      }

      logger.debug(`[GitHub Releases] Failed to get digest from GHCR for ${imageRef}`);
      return null;
    } catch (error) {
      logger.debug(
        `[GitHub Releases] Error getting digest from GHCR for ${imageRepo}:${tag}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * This provider doesn't support digest-based comparison
   */
  supportsDigestComparison() {
    return false;
  }
}

module.exports = GitHubReleasesProvider;
