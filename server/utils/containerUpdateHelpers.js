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
 * Compares current digest with latest digest
 *
 * @param {Object} container - Container object
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

  // Get current and latest digests (try both full and short versions)
  const currentDigest = container.currentDigest || container.currentDigestFull;
  const latestDigest = container.latestDigest || container.latestDigestFull;

  // If we have both digests, compare them
  if (currentDigest && latestDigest) {
    const normalizedCurrent = normalizeDigest(currentDigest);
    const normalizedLatest = normalizeDigest(latestDigest);

    if (normalizedCurrent && normalizedLatest) {
      return normalizedCurrent !== normalizedLatest;
    }
  }

  // Fallback: If using GitHub Releases fallback, compare versions
  if (container.isFallback || container.provider === "github-releases") {
    const currentVersion = container.currentVersion || container.currentTag;
    const latestVersion = container.latestVersion || container.latestTag;

    if (currentVersion && latestVersion) {
      // Normalize versions (remove "v" prefix, case-insensitive)
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
