/**
 * Image Update Service
 * Handles checking for Docker image updates
 */

const dockerRegistryService = require("./dockerRegistryService");
const logger = require("../utils/logger");
const { getDockerHubImageVersion } = require("../db/database");

/**
 * Check if an image has updates available
 * @param {string} imageName - Image name (repo:tag)
 * @param {Object} containerDetails - Container details from Portainer
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Object>} - Update information
 */
async function checkImageUpdates(
  imageName,
  containerDetails = null,
  portainerUrl = null,
  endpointId = null,
  userId = null
) {
  // Extract image name and tag
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  // First, check database for stored current digest (from previous upgrade or pull)
  // This ensures we use the correct digest even if the container hasn't been refreshed yet
  let storedVersionInfo = null;
  if (userId) {
    try {
      // Pass currentTag to get the correct record for this specific tag
      storedVersionInfo = await getDockerHubImageVersion(userId, repo, currentTag);
    } catch (dbError) {
      // If database lookup fails, continue without stored info
      logger.debug(`Could not get stored version info for ${repo}:${currentTag}:`, {
        error: dbError,
      });
    }
  }

  // Get current image digest from the actual container (not from shared Docker Hub record)
  // The Docker Hub version table is shared per image_repo, so we can't use its currentDigest
  // for comparison - each container needs to be checked individually
  let currentDigest = null;
  if (containerDetails) {
    // Always get the actual digest from the container itself
    currentDigest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
    );
    if (process.env.DEBUG && currentDigest) {
      logger.debug(
        `Got current digest from container for ${repo}: ${currentDigest.substring(0, 12)}...`
      );
    }
  }

  // If we couldn't get digest from container, try stored digest as fallback
  // But only if we don't have container details (shouldn't happen in normal flow)
  if (!currentDigest && storedVersionInfo && storedVersionInfo.currentDigest) {
    currentDigest = storedVersionInfo.currentDigest;
    if (process.env.DEBUG) {
      logger.debug(
        `Using stored current digest from database as fallback for ${repo}: ${currentDigest.substring(0, 12)}...`
      );
    }
  }

  // Get the image digest from registry for the current tag
  let latestImageInfo;
  try {
    latestImageInfo = await dockerRegistryService.getLatestImageDigest(repo, currentTag, userId);
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.isRateLimitExceeded) {
      throw error;
    }
    // For other errors, continue with null (will assume no update)
    latestImageInfo = null;
  }

  let hasUpdate = false;
  let latestDigest = null;
  let latestTag = currentTag; // Use the current tag, not "latest"

  // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
  const normalizeDigest = (digest) => {
    if (!digest) {
      return null;
    }
    // Ensure digest starts with sha256: for consistent comparison
    return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
  };

  if (latestImageInfo) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag;

    // Compare digests to determine if update is available
    // Always use the container's actual digest (from Portainer), not the shared Docker Hub record
    if (currentDigest && latestDigest) {
      const normalizedCurrent = normalizeDigest(currentDigest);
      const normalizedLatest = normalizeDigest(latestDigest);

      // If digests are different, there's an update available
      hasUpdate = normalizedCurrent !== normalizedLatest;

      if (process.env.DEBUG) {
        logger.debug(
          `Comparing digests for ${repo}: current=${normalizedCurrent.substring(0, 12)}..., latest=${normalizedLatest.substring(0, 12)}..., hasUpdate=${hasUpdate}`
        );
      }
    } else if (
      storedVersionInfo &&
      storedVersionInfo.hasUpdate === false &&
      latestDigest &&
      !currentDigest
    ) {
      // If we have stored info saying no update (container was recently upgraded),
      // and we can't get current digest from container, trust the stored info
      // But verify against the latest digest from Docker Hub
      if (storedVersionInfo.currentDigest) {
        const normalizedStored = normalizeDigest(storedVersionInfo.currentDigest);
        const normalizedLatest = normalizeDigest(latestDigest);
        // If stored digest matches latest, definitely no update
        if (normalizedStored === normalizedLatest) {
          hasUpdate = false;
          currentDigest = storedVersionInfo.currentDigest;
        } else {
          // Stored digest doesn't match latest - there's a new update available
          hasUpdate = true;
        }
      } else {
        // No stored digest but stored info says no update - trust it for now
        hasUpdate = false;
      }
    } else if (currentDigest === null && latestDigest) {
      // If we can't get current digest but we have latest digest, we can't be sure
      // This could happen if the image was just upgraded and digest info isn't available yet
      // In this case, assume no update to avoid false positives
      // The next check will properly compare digests once they're available
      hasUpdate = false;
    } else {
      // Fallback: if we can't compare digests, compare tags
      // If current tag is different from latest tag, there's an update
      if (currentTag !== latestTag) {
        hasUpdate = true;
      }
    }
  } else {
    // Fallback: if we can't get digests, use stored info if available
    if (storedVersionInfo) {
      hasUpdate = storedVersionInfo.hasUpdate || false;
      if (storedVersionInfo.currentDigest) {
        currentDigest = storedVersionInfo.currentDigest;
      }
      if (storedVersionInfo.latestDigest) {
        latestDigest = storedVersionInfo.latestDigest;
      }
    } else {
      // No stored info and can't get digests - assume no update available
      hasUpdate = false;
    }
  }

  // Format digest for display (shortened version)
  const formatDigest = (digest) => {
    if (!digest) {
      return null;
    }
    // Return first 12 characters after "sha256:" for display
    return digest.replace("sha256:", "").substring(0, 12);
  };

  // Get publish date for latest tag (non-blocking - don't fail if this errors)
  let latestPublishDate = null;
  if (latestTag && hasUpdate) {
    try {
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, latestTag, userId);
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      // Silently continue - publish date is nice to have but not critical
      latestPublishDate = null;
    }
  }

  // Determine if image exists in Docker Hub based on whether we got a valid response from getLatestImageDigest
  // If latestImageInfo is not null, the image exists in Docker Hub
  const existsInDockerHub = latestImageInfo !== null;

  return {
    currentTag: currentTag,
    currentVersion: currentTag,
    currentDigest: formatDigest(currentDigest),
    currentDigestFull: currentDigest,
    hasUpdate: hasUpdate,
    latestTag: latestTag,
    newVersion: latestTag,
    latestDigest: formatDigest(latestDigest),
    latestDigestFull: latestDigest,
    latestPublishDate: latestPublishDate,
    currentVersionPublishDate: null,
    imageRepo: repo,
    existsInDockerHub: existsInDockerHub,
  };
}

module.exports = {
  checkImageUpdates,
};
