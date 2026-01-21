/**
 * Container Update Helpers (Client)
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
export function normalizeDigest(digest) {
  if (!digest) return null;
  // Remove sha256: prefix if present, convert to lowercase
  return digest.replace(/^sha256:/i, "").toLowerCase();
}

/**
 * Compute whether a container has an available update
 *
 * IMPORTANT: The backend now properly checks RepoDigests for multi-arch images.
 * This function should trust the backend's hasUpdate calculation when available.
 *
 * @param {Object} container - Container object
 * @param {boolean} [container.hasUpdate] - Backend-computed hasUpdate (preferred)
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
export function computeHasUpdate(container) {
  if (!container) return false;

  // CRITICAL: Trust backend's hasUpdate if provided (backend checks all RepoDigests)
  // The backend now properly handles multi-arch images by checking if the latest digest
  // exists in ANY of the container's RepoDigests
  if (typeof container.hasUpdate === "boolean") {
    return container.hasUpdate;
  }

  // Fallback: compute on frontend if backend didn't provide hasUpdate
  // Prefer FULL digests for accurate comparison (currentDigest/latestDigest may be truncated)
  const currentDigest = container.currentDigestFull || container.currentDigest;
  const latestDigest = container.latestDigestFull || container.latestDigest;

  const currentVersion = container.currentVersion || container.currentTag;
  const latestVersion = container.latestVersion || container.latestTag;

  // If we have both digests, compare them (with RepoDigests support)
  if (currentDigest && latestDigest) {
    const normalizedCurrent = normalizeDigest(currentDigest);
    const normalizedLatest = normalizeDigest(latestDigest);

    if (normalizedCurrent && normalizedLatest) {
      // Check RepoDigests array for multi-arch support
      // RepoDigests are stored as clean "sha256:..." format (image prefix already stripped)
      if (
        container.repoDigests &&
        Array.isArray(container.repoDigests) &&
        container.repoDigests.length > 0
      ) {
        const hasLatestDigest = container.repoDigests.some((rd) => {
          return normalizeDigest(rd) === normalizedLatest;
        });

        if (hasLatestDigest) {
          return false; // Already has latest digest
        }
      }

      return normalizedCurrent !== normalizedLatest;
    }
  }

  // Fallback: If using GitHub Releases fallback, compare versions
  if (container.isFallback || container.provider === "github-releases") {
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
 * Returns a new object with computed hasUpdate field
 *
 * @param {Object} container - Container object to update
 * @returns {Object} - Container with computed hasUpdate
 */
export function addComputedHasUpdate(container) {
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
export function addComputedHasUpdateToArray(containers) {
  if (!Array.isArray(containers)) return containers;

  return containers.map((container) => addComputedHasUpdate(container));
}
