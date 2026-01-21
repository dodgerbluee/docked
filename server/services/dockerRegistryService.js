/**
 * Docker Registry Service
 * Handles digest extraction from running containers via Portainer
 * 
 * Note: For fetching latest digests from registries, use the new registry service
 * (server/services/registry) which uses crane/skopeo and supports multiple providers.
 */

const config = require("../config");
const Cache = require("../utils/cache");
const portainerService = require("./portainerService");
const logger = require("../utils/logger");

// Cache for image digests
const digestCache = new Cache();

/**
 * Detect registry type from image repository
 * @param {string} imageRepo - Image repository name
 * @returns {Object} - Registry info with type and repo
 */
function detectRegistry(imageRepo) {
  if (imageRepo.startsWith("ghcr.io/")) {
    return { type: "ghcr", repo: imageRepo.replace("ghcr.io/", "") };
  }
  if (imageRepo.startsWith("docker.io/")) {
    return { type: "dockerhub", repo: imageRepo.replace("docker.io/", "") };
  }
  if (imageRepo.startsWith("registry.gitlab.com/")) {
    return {
      type: "gitlab",
      repo: imageRepo.replace("registry.gitlab.com/", ""),
    };
  }
  if (imageRepo.startsWith("gcr.io/")) {
    return { type: "gcr", repo: imageRepo.replace("gcr.io/", "") };
  }
  if (imageRepo.startsWith("lscr.io/")) {
    return { type: "lscr", repo: imageRepo.replace("lscr.io/", "") };
  }
  if (imageRepo.includes("/")) {
    // Assume Docker Hub if it has a slash (user/repo format)
    return { type: "dockerhub", repo: imageRepo };
  }
  // Default: Docker Hub official image
  return { type: "dockerhub", repo: imageRepo };
}

/**
 * Normalize repository name for matching
 * @param {string} repoStr - Repository string
 * @returns {string} - Normalized repository
 */
function normalizeRepo(repoStr) {
  return repoStr
    .replace(/^docker\.io\//, "")
    .replace(/^registry-1\.docker\.io\//, "")
    .replace(/^registry\.docker\.io\//, "");
}

/**
 * Extract digest from repo digest string
 * @param {string} repoDigest - Repo digest string
 * @returns {string|null} - Digest or null
 */
function extractDigest(repoDigest) {
  if (!repoDigest.includes("@sha256:")) {
    return null;
  }
  return `sha256:${repoDigest.split("@sha256:")[1]}`;
}

/**
 * Find exact match digest from repo digests
 * @param {Array} repoDigests - Array of repo digest strings
 * @param {string} normalizedTargetRepo - Normalized target repository
 * @param {string|null} preferredDigest - Preferred digest to match (from database)
 * @returns {string|null} - Digest or null
 */
function findExactMatchDigest(repoDigests, normalizedTargetRepo, preferredDigest = null) {
  // Collect all matching digests
  const matchingDigests = [];

  for (const repoDigest of repoDigests) {
    const digest = extractDigest(repoDigest);
    if (!digest) {
      continue;
    }

    const repoPart = repoDigest.split("@sha256:")[0];
    const normalizedRepoPart = normalizeRepo(repoPart);

    if (normalizedRepoPart === normalizedTargetRepo) {
      matchingDigests.push(digest);
    }
  }

  if (matchingDigests.length === 0) {
    return null;
  }

  // If we have a preferred digest (from database), try to find it
  if (preferredDigest) {
    const cleanPreferred = preferredDigest.replace("sha256:", "");
    const found = matchingDigests.find((d) => d.replace("sha256:", "") === cleanPreferred);
    if (found) {
      if (process.env.DEBUG) {
        logger.debug(`      ✅ Found preferred digest from database: ${found.substring(0, 12)}...`);
      }
      return found;
    }
  }

  // If multiple matches and no preferred digest found, return ALL matches
  // and let the caller decide (don't assume ordering)
  if (matchingDigests.length > 1) {
    if (process.env.DEBUG) {
      logger.debug(
        `      ⚠️  Found ${matchingDigests.length} matching digests, no preferred match found`
      );
    }
    // Return first as fallback, but log warning
    return matchingDigests[0];
  }

  // Single match - safe to return
  if (process.env.DEBUG) {
    logger.debug(`      ✅ Found exact match digest: ${matchingDigests[0].substring(0, 12)}...`);
  }
  return matchingDigests[0];
}

/**
 * Find partial match digest from repo digests
 * @param {Array} repoDigests - Array of repo digest strings
 * @param {string} repoNameOnly - Repository name only
 * @param {string|null} preferredDigest - Preferred digest to match (from database)
 * @returns {string|null} - Digest or null
 */
function findPartialMatchDigest(repoDigests, repoNameOnly, preferredDigest = null) {
  // Collect all matching digests
  const matchingDigests = [];

  for (const repoDigest of repoDigests) {
    const digest = extractDigest(repoDigest);
    if (!digest) {
      continue;
    }

    const repoPart = repoDigest.split("@sha256:")[0];
    const normalizedRepoPart = normalizeRepo(repoPart);

    if (normalizedRepoPart.endsWith(`/${repoNameOnly}`) || normalizedRepoPart === repoNameOnly) {
      matchingDigests.push(digest);
    }
  }

  if (matchingDigests.length === 0) {
    return null;
  }

  // If we have a preferred digest (from database), try to find it
  if (preferredDigest) {
    const cleanPreferred = preferredDigest.replace("sha256:", "");
    const found = matchingDigests.find((d) => d.replace("sha256:", "") === cleanPreferred);
    if (found) {
      if (process.env.DEBUG) {
        logger.debug(`      ✅ Found preferred digest from database: ${found.substring(0, 12)}...`);
      }
      return found;
    }
  }

  // If multiple matches and no preferred digest found, don't assume ordering
  if (matchingDigests.length > 1) {
    if (process.env.DEBUG) {
      logger.debug(
        `      ⚠️  Found ${matchingDigests.length} partial matching digests, no preferred match found`
      );
    }
    // Return first as fallback
    return matchingDigests[0];
  }

  // Single match - safe to return
  if (process.env.DEBUG) {
    logger.debug(`      ✅ Found partial match digest: ${matchingDigests[0].substring(0, 12)}...`);
  }
  return matchingDigests[0];
}

/**
 * Get digest from image data
 * @param {Object} imageData - Image data from Portainer
 * @param {string} imageName - Image name
 * @param {string|null} preferredDigest - Preferred digest from database (optional)
 * @returns {string|null} - Digest or null
 */
function getDigestFromImageData(imageData, imageName, preferredDigest = null) {
  if (!imageData.RepoDigests || imageData.RepoDigests.length === 0) {
    return null;
  }

  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const normalizedTargetRepo = normalizeRepo(repo);

  const exactMatch = findExactMatchDigest(
    imageData.RepoDigests,
    normalizedTargetRepo,
    preferredDigest
  );
  if (exactMatch) {
    return exactMatch;
  }

  const repoNameOnly = repo.split("/").pop();
  const partialMatch = findPartialMatchDigest(imageData.RepoDigests, repoNameOnly, preferredDigest);
  if (partialMatch) {
    return partialMatch;
  }

  // Fallback: If we have a preferred digest, check if it exists in any RepoDigest
  if (preferredDigest) {
    const cleanPreferred = preferredDigest.replace("sha256:", "");
    const foundInAny = imageData.RepoDigests.find((rd) => rd.includes(cleanPreferred));
    if (foundInAny) {
      const extracted = extractDigest(foundInAny);
      if (extracted && process.env.DEBUG) {
        logger.debug(
          `      ✅ Found preferred digest in RepoDigests: ${extracted.substring(0, 12)}...`
        );
      }
      return extracted;
    }
  }

  // Last resort: return first RepoDigest (don't assume ordering is meaningful)
  const firstRepoDigest = imageData.RepoDigests[0];
  const fallbackDigest = extractDigest(firstRepoDigest);
  if (fallbackDigest && process.env.DEBUG) {
    logger.debug(
      `      ⚠️  Warning: Using first RepoDigest for ${imageName} as fallback (${imageData.RepoDigests.length} total)`
    );
  }
  return fallbackDigest;
}

/**
 * Get current image digest from container
 * @param {Object} containerDetails - Container details from Portainer
 * @param {string} imageName - Image name
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {number|null} userId - User ID to query database for preferred digest (optional)
 * @returns {Promise<string|null>} - Image digest or null
 */
async function getCurrentImageDigest(
  containerDetails,
  imageName,
  portainerUrl,
  endpointId,
  userId = null
) {
  if (process.env.DEBUG) {
    logger.debug(`      🔍 Getting current digest for ${imageName}`);
  }

  const configImage = containerDetails.Config?.Image;
  if (configImage && configImage.includes("@sha256:")) {
    const digest = configImage.split("@sha256:")[1];
    if (process.env.DEBUG) {
      logger.debug(`      ✅ Found digest in image name: sha256:${digest.substring(0, 12)}...`);
    }
    return `sha256:${digest}`;
  }

  const imageId = containerDetails.Image;
  if (!portainerUrl || !endpointId || !imageId) {
    return null;
  }

  try {
    const imageData = await portainerService.getImageDetails(portainerUrl, endpointId, imageId);
    
    // CRITICAL: For multi-arch images, RepoDigests contains multiple digests
    // We need to find the one that matches our image name
    // Don't pass preferredDigest - just take the first matching digest for our repo
    const digest = getDigestFromImageData(imageData, imageName, null);
    
    if (process.env.DEBUG && digest) {
      logger.debug(`      ✅ Selected digest: ${digest.substring(0, 12)}... from ${imageData.RepoDigests?.length || 0} RepoDigests`);
    }
    
    return digest;
  } catch (error) {
    logger.debug(`Could not inspect image ${imageId} to get digest: ${error.message}`);
    return null;
  }
}

/**
 * Clear digest cache for a specific image
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 */
function clearDigestCache(imageRepo, tag) {
  const registry = detectRegistry(imageRepo);
  if (registry.type === "dockerhub") {
    const cacheKey = `${registry.repo}:${tag}`;
    digestCache.delete(cacheKey);
  }
}

/**
 * Clear all digest cache entries
 * Used when force refreshing to ensure fresh registry data
 */
function clearAllDigestCache() {
  digestCache.clear();
  logger.debug("Cleared all registry digest cache entries");
}

module.exports = {
  detectRegistry,
  getCurrentImageDigest,
  clearDigestCache,
  clearAllDigestCache,
};
