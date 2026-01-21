/**
 * Container Update Helpers
 *
 * Utility functions for computing container update status on-the-fly
 * instead of relying on stored hasUpdate values.
 */

/**
 * Normalize a digest for comparison
 * Handles variations in sha256: prefix and case
 * @param {string|null|undefined} digest - Digest to normalize
 * @returns {string|null} - Normalized digest or null
 */
function normalizeDigest(digest) {
  if (!digest) return null;
  // Remove sha256: prefix if present, convert to lowercase
  return digest.replace(/^sha256:/i, "").toLowerCase();
}

/**
 * Compute whether a container has an available update
 * 
 * Checks if the latest digest exists in the container's RepoDigests array for multi-arch support.
 *
 * @param {Object} container - Container object
 * @param {Array<string>} [container.repoDigests] - Array of RepoDigests from container
 * @param {string} [container.currentDigest] - Current container digest
 * @param {string} [container.currentDigestFull] - Current container digest (full)
 * @param {string} [container.latestDigest] - Latest available digest
 * @param {string} [container.latestDigestFull] - Latest available digest (full)
 * @param {string} [container.currentTag] - Current tag
 * @param {string} [container.latestTag] - Latest tag
 * @param {string} [container.latestVersion] - Latest version
 * @param {string} [container.provider] - Provider type (for fallback logic)
 * @param {boolean} [container.isFallback] - Whether using fallback provider
 * @returns {boolean} - True if update is available
 */
function computeHasUpdate(container) {
  if (!container) return false;

  // Get current and latest digests (prefer FULL digests for accurate comparison)
  const currentDigest = container.currentDigestFull || container.currentDigest;
  const latestDigest = container.latestDigestFull || container.latestDigest;
  
  const currentVersion = container.currentVersion || container.currentTag;
  const latestVersion = container.latestVersion || container.latestTag;

  // If using GitHub Releases fallback, compare versions
  if (container.isFallback || container.provider === "github-releases") {
    if (currentVersion && latestVersion) {
      const normalizeVersion = (v) => {
        if (!v) return "";
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      const normalizedCurrent = normalizeVersion(currentVersion);
      const normalizedLatest = normalizeVersion(latestVersion);

      if (normalizedCurrent && normalizedLatest) {
        return normalizedCurrent !== normalizedLatest;
      }
    }
  }

  // Primary method: compare digests with RepoDigests support for multi-arch
  if (currentDigest && latestDigest) {
    const normalizedCurrent = normalizeDigest(currentDigest);
    const normalizedLatest = normalizeDigest(latestDigest);

    if (normalizedCurrent && normalizedLatest) {
      // CRITICAL: Check if latest digest exists in ANY of the container's RepoDigests
      // This handles multi-arch images where a container may have multiple digests
      if (container.repoDigests && Array.isArray(container.repoDigests) && container.repoDigests.length > 0) {
        // Check if the latest digest exists in any RepoDigest
        // RepoDigests are stored as clean "sha256:..." format (image prefix already stripped)
        const hasLatestDigest = container.repoDigests.some((rd) => {
          return normalizeDigest(rd) === normalizedLatest;
        });

        if (hasLatestDigest) {
          // Container already has the latest digest, no update needed
          return false;
        }
      }

      // Digests differ and latest not in RepoDigests
      return normalizedCurrent !== normalizedLatest;
    }
  }

  // If we don't have enough info to determine, assume no update
  return false;
}

/**
 * Add computed hasUpdate to a container object
 * Mutates the container object by adding/updating hasUpdate field
 *
 * @param {Object} container - Container object to update
 * @returns {Object} - Container with computed hasUpdate
 */
function addComputedHasUpdate(container) {
  if (!container) return container;

  return {
    ...container,
    hasUpdate: computeHasUpdate(container),
  };
}

/**
 * Add computed hasUpdate to an array of containers
 *
 * @param {Array<Object>} containers - Array of container objects
 * @returns {Array<Object>} - Array of containers with computed hasUpdate
 */
function addComputedHasUpdateToArray(containers) {
  if (!Array.isArray(containers)) return containers;

  return containers.map((container) => addComputedHasUpdate(container));
}

module.exports = {
  normalizeDigest,
  computeHasUpdate,
  addComputedHasUpdate,
  addComputedHasUpdateToArray,
};
