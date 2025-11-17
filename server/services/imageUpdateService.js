/**
 * Image Update Service
 * Handles checking for Docker image updates
 */

const dockerRegistryService = require("./dockerRegistryService");
const logger = require("../utils/logger");

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
  endpointId = null
) {
  // Extract image name and tag
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  // Get current image digest if available
  let currentDigest = null;
  if (containerDetails) {
    currentDigest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
    );
  }

  // Get the image digest from registry for the current tag
  let latestImageInfo;
  try {
    latestImageInfo = await dockerRegistryService.getLatestImageDigest(repo, currentTag);
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

  if (latestImageInfo) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag;

    // Compare digests to determine if update is available
    if (currentDigest && latestDigest) {
      // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
      const normalizeDigest = (digest) => {
        if (!digest) {
          return null;
        }
        // Ensure digest starts with sha256: for consistent comparison
        return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
      };

      const normalizedCurrent = normalizeDigest(currentDigest);
      const normalizedLatest = normalizeDigest(latestDigest);

      // If digests are different, there's an update available
      hasUpdate = normalizedCurrent !== normalizedLatest;
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
    // Fallback: if we can't get digests, assume no update available
    hasUpdate = false;
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
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, latestTag);
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
