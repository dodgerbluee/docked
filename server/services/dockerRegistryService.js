/**
 * Docker Registry Service
 * Handles interactions with Docker registries (Docker Hub, GHCR, etc.)
 */

const axios = require("axios");
const config = require("../config");
const Cache = require("../utils/cache");
const { rateLimitDelay } = require("../utils/rateLimiter");
const { retryWithBackoff } = require("../utils/retry");
const { getDockerHubCreds } = require("../utils/dockerHubCreds");
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
 * Build request config for Docker Registry token request
 * @param {string} namespace - Image namespace
 * @param {string} repository - Image repository
 * @param {Object} creds - Credentials object
 * @param {number} userId - User ID
 * @returns {Object} - Request config
 */
function buildTokenRequestConfig(namespace, repository, creds, userId) {
  const params = {
    service: "registry.docker.io",
    scope: `repository:${namespace}/${repository}:pull`,
  };

  const requestConfig = {
    params,
    timeout: 10000,
  };

  if (creds.token && creds.username) {
    requestConfig.auth = {
      username: creds.username,
      password: creds.token,
    };
    logger.debug(
      `🔑 Docker Hub: Using API key authentication (username: ${creds.username}) for ${namespace}/${repository}`,
      {
        module: "dockerRegistryService",
        operation: "getDockerRegistryToken",
        namespace,
        repository,
        userId,
        hasCredentials: true,
      },
    );
  } else {
    logger.debug(
      `🌐 Docker Hub: Using IP-based anonymous request (no credentials) for ${namespace}/${repository}`,
      {
        module: "dockerRegistryService",
        operation: "getDockerRegistryToken",
        namespace,
        repository,
        userId,
        hasCredentials: false,
      },
    );
  }

  return requestConfig;
}

/**
 * Get Docker Registry API v2 token for authentication
 * @param {string} namespace - Image namespace
 * @param {string} repository - Image repository
 * @param {number} userId - User ID for per-user credentials (optional)
 * @returns {Promise<string|null>} - Authentication token
 */
async function getDockerRegistryToken(namespace, repository, userId = null) {
  try {
    const authUrl = "https://auth.docker.io/token";
    const creds = await getDockerHubCreds(userId);
    const requestConfig = buildTokenRequestConfig(namespace, repository, creds, userId);
    const response = await axios.get(authUrl, requestConfig);
    return response.data?.token || null;
  } catch (error) {
    logger.error(
      `Error getting Docker Registry token for ${namespace}/${repository}:`,
      error.message,
    );
    return null;
  }
}

/**
 * Parse image repository into namespace and repository
 * @param {string} imageRepo - Image repository
 * @returns {Object} - { namespace, repository }
 */
function parseImageRepo(imageRepo) {
  let namespace = "library";
  let repository = imageRepo;

  if (imageRepo.includes("/")) {
    const parts = imageRepo.split("/");
    namespace = parts[0];
    repository = parts.slice(1).join("/");
  }

  return { namespace, repository };
}

/**
 * Make request to Docker Hub registry API
 * @param {string} registryUrl - Registry URL
 * @param {Object} headers - Request headers
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Response object
 */
async function requestDockerHubManifest(registryUrl, headers, userId) {
  return retryWithBackoff(
    async () => {
      const resp = await axios.get(registryUrl, {
        headers,
        timeout: 10000,
        validateStatus: status => status < 500,
      });
      if (resp.status === 429) {
        const error = new Error("Rate limited by Docker Hub");
        error.response = { status: 429 };
        throw error;
      }
      return resp;
    },
    3,
    1000,
    userId,
  );
}

/**
 * Handle response from Docker Hub manifest request
 * @param {Object} response - Response object
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 * @param {string} cacheKey - Cache key
 * @returns {string|null} - Digest or null
 */
function handleManifestResponse(response, imageRepo, tag, cacheKey) {
  if (response.status === 200 && response.headers["docker-content-digest"]) {
    const digest = response.headers["docker-content-digest"];
    digestCache.set(cacheKey, digest, config.cache.digestCacheTTL);
    return digest;
  }

  if (response.status !== 200) {
    if (response.status === 404 && tag && tag.includes("@sha256")) {
      logger.debug(`      ⏭️  Skipping 404 for ${imageRepo}:${tag} (tag contains digest)`);
    } else {
      logger.warn(
        `⚠️  Failed to get digest for ${imageRepo}:${tag} (status: ${response.status})`,
      );
    }
  }
  return null;
}

/**
 * Get index digest from Docker Hub Registry API v2 for a specific tag
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag (default: 'latest')
 * @param {number} userId - User ID for per-user credentials (optional)
 * @returns {Promise<string|null>} - Image digest
 */
/**
 * Handle error for Docker Hub digest fetch
 * @param {Error} error - Error object
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag
 * @returns {null}
 */
function handleDockerHubDigestError(error, imageRepo, tag) {
  if (error.isRateLimitExceeded) {
    throw error;
  }

  if (error.response?.status !== 404 && error.response?.status !== 429) {
    logger.error(`❌ Error fetching index digest for ${imageRepo}:${tag}:`, { error });
  }
  return null;
}

/**
 * Fetch manifest from Docker Hub
 * @param {string} namespace - Namespace
 * @param {string} repository - Repository
 * @param {string} tag - Tag
 * @param {string} token - Auth token
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Response object
 */
async function fetchDockerHubManifest(namespace, repository, tag, token, userId) {
  const registryUrl = `https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${tag}`;
  const headers = {
    Accept: "application/vnd.docker.distribution.manifest.list.v2+json",
    Authorization: `Bearer ${token}`,
  };
  return requestDockerHubManifest(registryUrl, headers, userId);
}

async function getImageDigestFromDockerHub(imageRepo, tag = "latest", userId = null) {
  const cacheKey = `${imageRepo}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    if (process.env.DEBUG) {
      logger.debug(`      ✅ Cache HIT for ${imageRepo}:${tag}`);
    }
    return cached;
  }

  if (process.env.DEBUG) {
    logger.debug(`      🔄 Cache MISS - fetching ${imageRepo}:${tag} from Docker Hub`);
  }

  try {
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    const { namespace, repository } = parseImageRepo(imageRepo);
    const token = await getDockerRegistryToken(namespace, repository, userId);
    if (!token) {
      logger.error(`❌ Failed to get authentication token for ${namespace}/${repository}`);
      return null;
    }

    const response = await fetchDockerHubManifest(namespace, repository, tag, token, userId);
    return handleManifestResponse(response, imageRepo, tag, cacheKey);
  } catch (error) {
    return handleDockerHubDigestError(error, imageRepo, tag);
  }
}

/**
 * Get digest for Docker Hub registry
 * @param {string} repo - Repository name
 * @param {string} tag - Image tag
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Object with digest and tag, or null
 */
async function getDockerHubDigest(repo, tag, userId) {
  const digest = await getImageDigestFromDockerHub(repo, tag, userId);
  return digest ? { digest, tag } : null;
}

/**
 * Get the image digest from registry for a specific tag
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag (default: 'latest')
 * @param {number} userId - User ID for per-user credentials (optional)
 * @returns {Promise<Object|null>} - Object with digest and tag, or null
 */
async function getLatestImageDigest(imageRepo, tag = "latest", userId = null) {
  logger.debug(`      🐳 Docker Registry: Fetching digest for ${imageRepo}:${tag}`);

  if (tag && tag.includes("@sha256")) {
    logger.debug(
      `      ⏭️  Skipping digest lookup for ${imageRepo}:${tag} (tag already contains digest)`,
    );
    return null;
  }

  const registry = detectRegistry(imageRepo);

  if (registry.type === "dockerhub" || registry.type === "lscr") {
    return getDockerHubDigest(registry.repo, tag, userId);
  }

  return null;
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
 * @returns {string|null} - Digest or null
 */
function findExactMatchDigest(repoDigests, normalizedTargetRepo) {
  for (const repoDigest of repoDigests) {
    const digest = extractDigest(repoDigest);
    if (!digest) {
      continue;
    }

    const repoPart = repoDigest.split("@sha256:")[0];
    const normalizedRepoPart = normalizeRepo(repoPart);

    if (normalizedRepoPart === normalizedTargetRepo) {
      if (process.env.DEBUG) {
        logger.debug(
          `      ✅ Found exact match digest: ${digest.substring(0, 12)}...`,
        );
      }
      return digest;
    }
  }
  return null;
}

/**
 * Find partial match digest from repo digests
 * @param {Array} repoDigests - Array of repo digest strings
 * @param {string} repoNameOnly - Repository name only
 * @returns {string|null} - Digest or null
 */
function findPartialMatchDigest(repoDigests, repoNameOnly) {
  for (const repoDigest of repoDigests) {
    const digest = extractDigest(repoDigest);
    if (!digest) {
      continue;
    }

    const repoPart = repoDigest.split("@sha256:")[0];
    const normalizedRepoPart = normalizeRepo(repoPart);

    if (
      normalizedRepoPart.endsWith(`/${repoNameOnly}`) ||
      normalizedRepoPart === repoNameOnly
    ) {
      if (process.env.DEBUG) {
        logger.debug(
          `      ✅ Found partial match digest: ${digest.substring(0, 12)}...`,
        );
      }
      return digest;
    }
  }
  return null;
}

/**
 * Get digest from image data
 * @param {Object} imageData - Image data from Portainer
 * @param {string} imageName - Image name
 * @returns {string|null} - Digest or null
 */
function getDigestFromImageData(imageData, imageName) {
  if (!imageData.RepoDigests || imageData.RepoDigests.length === 0) {
    return null;
  }

  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const normalizedTargetRepo = normalizeRepo(repo);

  const exactMatch = findExactMatchDigest(imageData.RepoDigests, normalizedTargetRepo);
  if (exactMatch) {
    return exactMatch;
  }

  const repoNameOnly = repo.split("/").pop();
  const partialMatch = findPartialMatchDigest(imageData.RepoDigests, repoNameOnly);
  if (partialMatch) {
    return partialMatch;
  }

  const firstRepoDigest = imageData.RepoDigests[0];
  const fallbackDigest = extractDigest(firstRepoDigest);
  if (fallbackDigest && process.env.DEBUG) {
    logger.debug(
      `Warning: Using first RepoDigest for ${imageName} as fallback: ${fallbackDigest.substring(0, 12)}`,
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
 * @returns {Promise<string|null>} - Image digest or null
 */
async function getCurrentImageDigest(containerDetails, imageName, portainerUrl, endpointId) {
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
    return getDigestFromImageData(imageData, imageName);
  } catch (error) {
    logger.debug(`Could not inspect image ${imageId} to get digest: ${error.message}`);
    return null;
  }
}

/**
 * Build Docker Hub API headers with authentication
 * @param {Object} creds - Credentials object
 * @returns {Object} - Headers object
 */
function buildDockerHubHeaders(creds) {
  const hubHeaders = {
    "User-Agent": "Docked/1.0",
  };

  if (creds.token && creds.username) {
    hubHeaders.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString(
      "base64",
    )}`;
  }

  return hubHeaders;
}

/**
 * Fetch publish date from Docker Hub API
 * @param {string} hubApiUrl - Docker Hub API URL
 * @param {Object} hubHeaders - Request headers
 * @returns {Promise<string|null>} - Publish date or null
 */
async function fetchPublishDateFromHub(hubApiUrl, hubHeaders) {
  const hubResponse = await axios.get(hubApiUrl, {
    headers: hubHeaders,
    timeout: 10000,
    validateStatus: status => status < 500,
  });

  if (hubResponse.status === 200 && hubResponse.data) {
    return hubResponse.data.tag_last_pushed || hubResponse.data.last_updated || null;
  }

  return null;
}

/**
 * Get latest tag publish date from Docker Hub
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Tag name (default: 'latest')
 * @returns {Promise<string|null>} - ISO date string of when the tag was last pushed, or null
 */
/**
 * Fetch and cache publish date
 * @param {string} hubApiUrl - Hub API URL
 * @param {Object} hubHeaders - Headers
 * @param {string} cacheKey - Cache key
 * @returns {Promise<string|null>} - Publish date or null
 */
async function fetchAndCachePublishDate(hubApiUrl, hubHeaders, cacheKey) {
  const publishDate = await fetchPublishDateFromHub(hubApiUrl, hubHeaders);
  if (publishDate) {
    digestCache.set(cacheKey, publishDate, config.cache.digestCacheTTL);
    return publishDate;
  }
  return null;
}

// eslint-disable-next-line complexity -- Tag publish date retrieval requires multiple conditional checks
async function getTagPublishDate(imageRepo, tag = "latest", userId = null) {
  if (!imageRepo) {
    return null;
  }

  const registry = detectRegistry(imageRepo);
  const repoForLookup = registry.type === "lscr" ? registry.repo : imageRepo;
  const cacheKey = `publishDate:${repoForLookup}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    const { namespace, repository } = parseImageRepo(repoForLookup);
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${tag}/`;
    const hubHeaders = buildDockerHubHeaders(creds);

    return fetchAndCachePublishDate(hubApiUrl, hubHeaders, cacheKey);
  } catch (error) {
    if (error.response?.status !== 404) {
      logger.error(`      ❌ Error fetching publish date for ${imageRepo}:${tag}:`, { error });
    }
    return null;
  }
}

/**
 * Normalize digest to short form
 * @param {string} digest - Digest string
 * @returns {Object} - { shortDigest, shortDigestWithPrefix }
 */
function normalizeDigest(digest) {
  let digestToMatch = digest.trim();
  if (!digestToMatch.startsWith("sha256:")) {
    digestToMatch = `sha256:${digestToMatch}`;
  }

  const shortDigest = digestToMatch.replace("sha256:", "").substring(0, 12);
  const shortDigestWithPrefix = `sha256:${shortDigest}`;

  return { shortDigest, shortDigestWithPrefix };
}

/**
 * Find matching tag in tag info array
 * @param {Array} tags - Array of tag info objects
 * @param {string} shortDigestWithPrefix - Short digest with prefix
 * @returns {string|null} - Tag name or null
 */
function findMatchingTag(tags, shortDigestWithPrefix) {
  for (const tagInfo of tags) {
    if (tagInfo.digest && tagInfo.digest.startsWith(shortDigestWithPrefix)) {
      logger.debug(`      ✅ Found matching tag by main digest: ${tagInfo.name}`);
      return tagInfo.name;
    }

    if (tagInfo.images && Array.isArray(tagInfo.images)) {
      for (const image of tagInfo.images) {
        if (image.digest && image.digest.startsWith(shortDigestWithPrefix)) {
          logger.debug(`      ✅ Found matching tag by image digest: ${tagInfo.name}`);
          return tagInfo.name;
        }
      }
    }
  }
  return null;
}

/**
 * Get tag/version from Docker Hub by digest
 * Queries Docker Hub HTTP API to find which tag corresponds to a given digest
 * Matches short digest (first 12 chars) against full digests in API response
 * Uses aggressive caching to minimize API calls
 * @param {string} imageRepo - Image repository
 * @param {string} digest - Digest (can be short like sha256:ac4ef17209bd or full)
 * @returns {Promise<string|null>} - Tag/version that matches the digest, or null
 */
/**
 * Look up tag from Hub API response
 * @param {Object} hubResponse - Hub API response
 * @param {string} shortDigestWithPrefix - Short digest with prefix
 * @param {string} cacheKey - Cache key
 * @param {string} shortDigest - Short digest
 * @returns {string|null} - Matching tag or null
 */
function lookupTagFromResponse(hubResponse, shortDigestWithPrefix, cacheKey, shortDigest) {
  if (hubResponse.status === 200 && hubResponse.data?.results) {
    const matchingTag = findMatchingTag(hubResponse.data.results, shortDigestWithPrefix);
    if (matchingTag) {
      digestCache.set(cacheKey, matchingTag, config.cache.digestCacheTTL);
      return matchingTag;
    }
  }

  logger.debug(`      ⚠️  Could not find tag for digest ${shortDigest}... in first 100 tags`);
  digestCache.set(cacheKey, null, 60 * 60 * 1000);
  return null;
}

/**
 * Fetch tags from Docker Hub API
 * @param {string} namespace - Namespace
 * @param {string} repository - Repository
 * @param {Object} hubHeaders - Headers
 * @returns {Promise<Object>} - Response object
 */
async function fetchTagsFromHub(namespace, repository, hubHeaders) {
  const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/?page_size=100`;
  return axios.get(hubApiUrl, {
    headers: hubHeaders,
    timeout: 10000,
    validateStatus: status => status < 500,
  });
}

// eslint-disable-next-line complexity -- Tag from digest retrieval requires multiple conditional checks
async function getTagFromDigest(imageRepo, digest, userId = null) {
  if (!digest || !imageRepo) {
    return null;
  }

  const { shortDigest, shortDigestWithPrefix } = normalizeDigest(digest);
  const registry = detectRegistry(imageRepo);
  const repoForLookup = registry.type === "lscr" ? registry.repo : imageRepo;
  const cacheKey = `tag:${repoForLookup}:${shortDigestWithPrefix}`;
  const cached = digestCache.get(cacheKey);
  if (cached && typeof cached === "string") {
    logger.debug(
      `      ✅ Cache HIT for tag lookup: ${repoForLookup}@${shortDigest}... -> ${cached}`,
    );
    return cached;
  }

  logger.debug(`      🔍 Looking up tag for digest ${shortDigest}... in ${repoForLookup}`);

  try {
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    const { namespace, repository } = parseImageRepo(repoForLookup);
    const hubHeaders = buildDockerHubHeaders(creds);
    const hubResponse = await fetchTagsFromHub(namespace, repository, hubHeaders);

    return lookupTagFromResponse(hubResponse, shortDigestWithPrefix, cacheKey, shortDigest);
  } catch (error) {
    if (error.response?.status !== 404) {
      logger.error(`      ❌ Error looking up tag for digest:`, { error });
    }
    digestCache.set(cacheKey, null, 60 * 60 * 1000);
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
 * Used when force refreshing to ensure fresh Docker Hub data
 */
function clearAllDigestCache() {
  digestCache.clear();
  logger.debug("Cleared all Docker Hub digest cache entries");
}

/**
 * Check if an image exists in Docker Hub
 * @param {string} imageRepo - Image repository
 * @returns {Promise<boolean>} - True if image exists in Docker Hub, false otherwise
 */
async function checkImageExistsInDockerHub(imageRepo, userId = null) {
  const registry = detectRegistry(imageRepo);

  // Only check Docker Hub images (including lscr.io which are also on Docker Hub)
  if (registry.type !== "dockerhub" && registry.type !== "lscr") {
    return false;
  }

  // Try to get the digest for the "latest" tag first
  // If that fails, try common tags for LinuxServer.io images
  try {
    let digest = await getImageDigestFromDockerHub(registry.repo, "latest", userId);
    if (digest) {
      return true;
    }

    // For LinuxServer.io images, try common tags if "latest" doesn't exist
    if (registry.type === "lscr") {
      const commonTags = ["develop", "nightly", "beta", "stable"];
      for (const tag of commonTags) {
        digest = await getImageDigestFromDockerHub(registry.repo, tag, userId);
        if (digest) {
          return true;
        }
      }
    }

    return false;
  } catch (_error) {
    // If there's an error (like 404), the image doesn't exist
    return false;
  }
}

module.exports = {
  detectRegistry,
  getLatestImageDigest,
  getCurrentImageDigest,
  getTagFromDigest,
  getTagPublishDate,
  clearDigestCache,
  clearAllDigestCache,
  checkImageExistsInDockerHub,
};
