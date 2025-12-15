/**
 * Image Update Service
 * Handles checking for Docker image updates
 *
 * Uses the unified registry service with automatic provider selection
 * and fallback strategies for robust update detection.
 */

const dockerRegistryService = require("./dockerRegistryService");
const registryService = require("./registry");
const logger = require("../utils/logger");
const { getDockerHubImageVersion } = require("../db/index");

/**
 * Extract image repository and tag from image name
 * @param {string} imageName - Image name
 * @returns {Object} - { repo, currentTag }
 */
function extractImageInfo(imageName) {
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  return {
    repo: imageParts[0],
    currentTag: imageParts[1],
  };
}

/**
 * Get stored version info from database
 * @param {number} userId - User ID
 * @param {string} repo - Repository name
 * @param {string} currentTag - Current tag
 * @returns {Promise<Object|null>} - Stored version info or null
 */
async function getStoredVersionInfo(userId, repo, currentTag) {
  if (!userId) {
    return null;
  }

  try {
    return await getDockerHubImageVersion(userId, repo, currentTag);
  } catch (dbError) {
    logger.debug(`Could not get stored version info for ${repo}:${currentTag}:`, {
      error: dbError,
    });
    return null;
  }
}

/**
 * Get current digest from container or stored info
 * @param {Object} containerDetails - Container details
 * @param {string} imageName - Image name
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {Object} storedVersionInfo - Stored version info
 * @param {string} repo - Repository name
 * @returns {Promise<string|null>} - Current digest or null
 */
/**
 * Get current digest from container details
 * @param {Object} options - Options object
 * @param {Object} options.containerDetails - Container details
 * @param {string} options.imageName - Image name
 * @param {string} options.portainerUrl - Portainer URL
 * @param {string|number} options.endpointId - Endpoint ID
 * @param {Object} options.storedVersionInfo - Stored version info
 * @param {string} options.repo - Repository name
 * @returns {Promise<string|null>} - Current digest
 */
async function getCurrentDigest(options) {
  const { containerDetails, imageName, portainerUrl, endpointId, storedVersionInfo, repo } =
    options;
  if (containerDetails) {
    const digest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
    );
    if (process.env.DEBUG && digest) {
      logger.debug(`Got current digest from container for ${repo}: ${digest.substring(0, 12)}...`);
    }
    if (digest) {
      return digest;
    }
  }

  if (storedVersionInfo?.currentDigest) {
    if (process.env.DEBUG) {
      logger.debug(
        `Using stored current digest from database as fallback for ${repo}: ${storedVersionInfo.currentDigest.substring(0, 12)}...`
      );
    }
    return storedVersionInfo.currentDigest;
  }

  return null;
}

/**
 * Detect provider from image repository
 * @param {string} repo - Repository name
 * @returns {string|null} - Provider name or null
 */
function detectProvider(repo) {
  const dockerRegistryServiceLocal = require("./dockerRegistryService");
  const registryInfo = dockerRegistryServiceLocal.detectRegistry(repo);
  const providerMap = {
    dockerhub: "dockerhub",
    ghcr: "ghcr",
    gitlab: "gitlab",
    gcr: "gcr",
    lscr: "dockerhub",
  };
  return providerMap[registryInfo.type] || null;
}

/**
 * Ensure provider is set in latest image info
 * @param {Object|null} latestImageInfo - Latest image info
 * @param {string} repo - Repository name
 * @param {string} currentTag - Current tag
 * @returns {Object|null} - Latest image info with provider
 */
function ensureProvider(latestImageInfo, repo, currentTag) {
  if (latestImageInfo?.provider) {
    return latestImageInfo;
  }

  const detectedProvider = detectProvider(repo);
  if (!detectedProvider) {
    return latestImageInfo;
  }

  if (!latestImageInfo) {
    return {
      provider: detectedProvider,
      digest: null,
      tag: currentTag,
    };
  }

  return {
    ...latestImageInfo,
    provider: detectedProvider,
  };
}

/**
 * Calculate update status based on latest image info
 * @param {Object|null} latestImageInfo - Latest image info
 * @param {string} currentDigest - Current digest
 * @param {string} currentTag - Current tag
 * @param {Object} storedVersionInfo - Stored version info
 * @returns {Object} - { hasUpdate, latestDigest, latestTag }
 */
/**
 * Handle case when no latest image info
 * @param {Object} storedVersionInfo - Stored version info
 * @param {string} currentTag - Current tag
 * @returns {Object} - Update status
 */
function handleNoLatestImageInfo(storedVersionInfo, currentTag) {
  if (storedVersionInfo) {
    return {
      hasUpdate: storedVersionInfo.hasUpdate || false,
      latestDigest: storedVersionInfo.latestDigest || null,
      latestTag: currentTag,
    };
  }
  return {
    hasUpdate: false,
    latestDigest: null,
    latestTag: currentTag,
  };
}

/**
 * Determine update status with stored version info
 * @param {Object} storedVersionInfo - Stored version info
 * @param {string} currentTag - Current tag
 * @param {Object} latestImageInfo - Latest image info
 * @param {string} latestDigest - Latest digest
 * @param {string|null} currentDigest - Current digest
 * @returns {boolean} - Has update
 */
function determineUpdateWithStoredInfo(
  storedVersionInfo,
  currentTag,
  latestImageInfo,
  latestDigest,
  currentDigest
) {
  if (
    storedVersionInfo &&
    storedVersionInfo.hasUpdate === false &&
    latestDigest &&
    !currentDigest &&
    storedVersionInfo.currentDigest
  ) {
    return registryService.hasUpdate(storedVersionInfo.currentDigest, currentTag, latestImageInfo);
  }
  if (currentDigest === null && latestDigest) {
    return false;
  }
  return null;
}

// eslint-disable-next-line complexity -- Update status calculation requires multiple conditional checks
function calculateUpdateStatus(latestImageInfo, currentDigest, currentTag, storedVersionInfo) {
  if (!latestImageInfo) {
    return handleNoLatestImageInfo(storedVersionInfo, currentTag);
  }

  const latestDigest = latestImageInfo.digest;
  const latestTag = latestImageInfo.tag || latestImageInfo.version || currentTag;

  if (latestImageInfo.isFallback && !latestDigest) {
    logger.debug(
      `Using GitHub Releases fallback for ${latestImageInfo.provider || "unknown"}:${currentTag} - version: ${latestTag}, digest: null`
    );
  }

  let hasUpdate = registryService.hasUpdate(currentDigest, currentTag, latestImageInfo);

  if (process.env.DEBUG) {
    logger.debug(
      `Comparing - currentDigest=${currentDigest ? `${currentDigest.substring(0, 12)}...` : "null"}, latestDigest=${latestDigest ? `${latestDigest.substring(0, 12)}...` : "null"}, hasUpdate=${hasUpdate}, isFallback=${latestImageInfo.isFallback || false}`
    );
  }

  const storedUpdate = determineUpdateWithStoredInfo(
    storedVersionInfo,
    currentTag,
    latestImageInfo,
    latestDigest,
    currentDigest
  );
  if (storedUpdate !== null) {
    hasUpdate = storedUpdate;
  }

  return { hasUpdate, latestDigest, latestTag };
}

/**
 * Format digest for display
 * @param {string|null} digest - Digest string
 * @returns {string|null} - Formatted digest
 */
function formatDigest(digest) {
  if (!digest) {
    return null;
  }
  return digest.replace("sha256:", "").substring(0, 12);
}

/**
 * Get publish date for latest tag
 * @param {string} repo - Repository name
 * @param {string} latestTag - Latest tag
 * @param {boolean} hasUpdate - Whether update is available
 * @param {number} userId - User ID
 * @returns {Promise<string|null>} - Publish date or null
 */
async function getPublishDate(repo, latestTag, hasUpdate, userId) {
  if (!latestTag || !hasUpdate) {
    return null;
  }

  try {
    return await registryService.getTagPublishDate(repo, latestTag, { userId });
  } catch {
    return null;
  }
}

/**
 * Check if an image has updates available
 * @param {string} imageName - Image name (repo:tag)
 * @param {Object} containerDetails - Container details from Portainer
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Object>} - Update information
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Image update checking requires comprehensive validation logic
async function checkImageUpdates(
  imageName,
  containerDetails = null,
  portainerUrl = null,
  endpointId = null,
  userId = null
) {
  const { repo, currentTag } = extractImageInfo(imageName);
  const storedVersionInfo = await getStoredVersionInfo(userId, repo, currentTag);
  const currentDigest = await getCurrentDigest({
    containerDetails,
    imageName,
    portainerUrl,
    endpointId,
    storedVersionInfo,
    repo,
  });

  let latestImageInfo;
  try {
    latestImageInfo = await registryService.getLatestDigest(repo, currentTag, {
      userId,
      useFallback: true,
    });
  } catch (error) {
    if (error.isRateLimitExceeded) {
      throw error;
    }
    latestImageInfo = null;
  }

  latestImageInfo = ensureProvider(latestImageInfo, repo, currentTag);
  const { hasUpdate, latestDigest, latestTag } = calculateUpdateStatus(
    latestImageInfo,
    currentDigest,
    currentTag,
    storedVersionInfo
  );

  const latestPublishDate = await getPublishDate(repo, latestTag, hasUpdate, userId);

  return {
    currentTag,
    currentVersion: currentTag,
    currentDigest: formatDigest(currentDigest),
    currentDigestFull: currentDigest,
    hasUpdate,
    latestTag,
    newVersion: latestTag,
    latestDigest: formatDigest(latestDigest),
    latestDigestFull: latestDigest,
    latestPublishDate,
    currentVersionPublishDate: null,
    imageRepo: repo,
    existsInDockerHub: latestImageInfo !== null,
    existsInRegistry: latestImageInfo !== null,
    provider: latestImageInfo?.provider || null,
    isFallback: latestImageInfo?.isFallback || false,
  };
}

module.exports = {
  checkImageUpdates,
};
