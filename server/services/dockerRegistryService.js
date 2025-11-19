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
 * Get Docker Registry API v2 token for authentication
 * @param {string} namespace - Image namespace
 * @param {string} repository - Image repository
 * @param {number} userId - User ID for per-user credentials (optional)
 * @returns {Promise<string|null>} - Authentication token
 */
async function getDockerRegistryToken(namespace, repository, userId = null) {
  try {
    const authUrl = "https://auth.docker.io/token";
    const params = {
      service: "registry.docker.io",
      scope: `repository:${namespace}/${repository}:pull`,
    };

    const requestConfig = {
      params: params,
      timeout: 10000,
    };

    // Get Docker Hub credentials (from database or env)
    const creds = await getDockerHubCreds(userId);
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
        }
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
        }
      );
    }

    const response = await axios.get(authUrl, requestConfig);
    return response.data?.token || null;
  } catch (error) {
    logger.error(
      `Error getting Docker Registry token for ${namespace}/${repository}:`,
      error.message
    );
    return null;
  }
}

/**
 * Get index digest from Docker Hub Registry API v2 for a specific tag
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag (default: 'latest')
 * @param {number} userId - User ID for per-user credentials (optional)
 * @returns {Promise<string|null>} - Image digest
 */
async function getImageDigestFromDockerHub(imageRepo, tag = "latest", userId = null) {
  // Check cache first
  const cacheKey = `${imageRepo}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    // Reduced logging - only log cache hits in debug mode
    if (process.env.DEBUG) {
      logger.debug(`      ✅ Cache HIT for ${imageRepo}:${tag}`);
    }
    return cached;
  }

  // Only log cache misses for important operations
  if (process.env.DEBUG) {
    logger.debug(`      🔄 Cache MISS - fetching ${imageRepo}:${tag} from Docker Hub`);
  }

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Get authentication token (reduced logging)
    const token = await getDockerRegistryToken(namespace, repository, userId);
    if (!token) {
      logger.error(`❌ Failed to get authentication token for ${namespace}/${repository}`);
      return null;
    }

    // Request manifest list (index) to get the index digest
    const registryUrl = `https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${tag}`;
    const headers = {
      Accept: "application/vnd.docker.distribution.manifest.list.v2+json",
      Authorization: `Bearer ${token}`,
    };

    const response = await retryWithBackoff(
      async () => {
        const resp = await axios.get(registryUrl, {
          headers: headers,
          timeout: 10000,
          validateStatus: (status) => status < 500,
        });
        // Check for 429 in response status
        if (resp.status === 429) {
          const error = new Error("Rate limited by Docker Hub");
          error.response = { status: 429 };
          throw error;
        }
        return resp;
      },
      3,
      1000,
      userId
    );

    // Get the index digest from the docker-content-digest header
    if (response.status === 200 && response.headers["docker-content-digest"]) {
      const digest = response.headers["docker-content-digest"];
      // Cache the result
      digestCache.set(cacheKey, digest, config.cache.digestCacheTTL);
      return digest;
    }

    // Only log failures, not every status check
    // Suppress warnings for 404s when tag contains @sha256 (expected behavior)
    if (response.status !== 200) {
      if (response.status === 404 && tag && tag.includes("@sha256")) {
        // Expected - Docker Hub doesn't support fetching by digest in tag format
        logger.debug(`      ⏭️  Skipping 404 for ${imageRepo}:${tag} (tag contains digest)`);
      } else {
        logger.warn(
          `⚠️  Failed to get digest for ${imageRepo}:${tag} (status: ${response.status})`
        );
      }
    }
    return null;
  } catch (error) {
    // Re-throw rate limit exceeded errors
    if (error.isRateLimitExceeded) {
      throw error;
    }

    // Only log non-404 errors and non-429 errors (429s are handled by retry)
    if (error.response?.status !== 404 && error.response?.status !== 429) {
      logger.error(`❌ Error fetching index digest for ${imageRepo}:${tag}:`, { error });
    }
    return null;
  }
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

  // Skip lookup if tag already contains a digest (e.g., "tag@sha256:abc123")
  // Docker Hub doesn't support fetching manifests by digest in tag format
  if (tag && tag.includes("@sha256")) {
    logger.debug(
      `      ⏭️  Skipping digest lookup for ${imageRepo}:${tag} (tag already contains digest)`
    );
    return null;
  }

  const registry = detectRegistry(imageRepo);

  switch (registry.type) {
    case "dockerhub":
      // Get digest for the specified tag (index digest)
      const digest = await getImageDigestFromDockerHub(registry.repo, tag, userId);
      if (digest) {
        return { digest: digest, tag: tag };
      }
      return null;
    case "lscr":
      // lscr.io images are also available on Docker Hub under the same name
      // Strip the lscr.io/ prefix and query Docker Hub
      const lscrDigest = await getImageDigestFromDockerHub(registry.repo, tag, userId);
      if (lscrDigest) {
        return { digest: lscrDigest, tag: tag };
      }
      return null;
    case "ghcr":
    case "gitlab":
    case "gcr":
      // These registries would need their own implementation
      // For now, return null
      return null;
    default:
      return null;
  }
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
  // Reduced logging - only in debug mode
  if (process.env.DEBUG) {
    logger.debug(`      🔍 Getting current digest for ${imageName}`);
  }

  // First check if image name already contains a digest
  const configImage = containerDetails.Config?.Image;
  if (configImage && configImage.includes("@sha256:")) {
    const digest = configImage.split("@sha256:")[1];
    if (process.env.DEBUG) {
      logger.debug(`      ✅ Found digest in image name: sha256:${digest.substring(0, 12)}...`);
    }
    return `sha256:${digest}`;
  }

  // Get the actual image ID from the container
  const imageId = containerDetails.Image;

  // If we have portainerUrl and endpointId, we can inspect the image to get the full digest
  if (portainerUrl && endpointId && imageId) {
    try {
      // Inspect the image to get its RepoDigests
      const imageData = await portainerService.getImageDetails(portainerUrl, endpointId, imageId);

      // RepoDigests contains full digests like ["repo@sha256:abc123..."]
      if (imageData.RepoDigests && imageData.RepoDigests.length > 0) {
        // Find the digest that matches our image repo exactly
        const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
        const repo = imageParts[0];

        // Normalize repo for matching (remove registry prefixes)
        const normalizeRepo = (repoStr) => {
          return repoStr
            .replace(/^docker\.io\//, "")
            .replace(/^registry-1\.docker\.io\//, "")
            .replace(/^registry\.docker\.io\//, "");
        };

        const normalizedTargetRepo = normalizeRepo(repo);

        // First, try to find an exact match for our repo
        for (const repoDigest of imageData.RepoDigests) {
          if (repoDigest.includes("@sha256:")) {
            const repoPart = repoDigest.split("@sha256:")[0];
            const normalizedRepoPart = normalizeRepo(repoPart);

            // Exact match (after normalization)
            if (normalizedRepoPart === normalizedTargetRepo) {
              const digest = repoDigest.split("@sha256:")[1];
              if (process.env.DEBUG) {
                logger.debug(
                  `      ✅ Found exact match digest: sha256:${digest.substring(0, 12)}...`
                );
              }
              return `sha256:${digest}`;
            }
          }
        }

        // If no exact match, try partial match (repo name only, ignoring registry)
        const repoNameOnly = repo.split("/").pop();
        for (const repoDigest of imageData.RepoDigests) {
          if (repoDigest.includes("@sha256:")) {
            const repoPart = repoDigest.split("@sha256:")[0];
            const normalizedRepoPart = normalizeRepo(repoPart);

            // Match if the last part of the repo matches
            if (
              normalizedRepoPart.endsWith(`/${repoNameOnly}`) ||
              normalizedRepoPart === repoNameOnly
            ) {
              const digest = repoDigest.split("@sha256:")[1];
              if (process.env.DEBUG) {
                logger.debug(
                  `      ✅ Found partial match digest: sha256:${digest.substring(0, 12)}...`
                );
              }
              return `sha256:${digest}`;
            }
          }
        }

        // Last resort: use the first RepoDigest if we can't find a match
        const firstRepoDigest = imageData.RepoDigests[0];
        if (firstRepoDigest && firstRepoDigest.includes("@sha256:")) {
          const digest = firstRepoDigest.split("@sha256:")[1];
          if (process.env.DEBUG) {
            logger.debug(
              `Warning: Using first RepoDigest for ${imageName} as fallback: ${digest.substring(
                0,
                12
              )}`
            );
          }
          return `sha256:${digest}`;
        }
      }
    } catch (error) {
      // If image inspection fails, we can't get the digest
      logger.debug(`Could not inspect image ${imageId} to get digest: ${error.message}`);
    }
  }

  // Return null if we can't get the local image digest
  return null;
}

/**
 * Get latest tag publish date from Docker Hub
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Tag name (default: 'latest')
 * @returns {Promise<string|null>} - ISO date string of when the tag was last pushed, or null
 */
async function getTagPublishDate(imageRepo, tag = "latest", userId = null) {
  if (!imageRepo) {
    return null;
  }

  // Handle lscr.io images - strip prefix for Docker Hub lookup
  // lscr.io images are also available on Docker Hub under the same name
  const registry = detectRegistry(imageRepo);
  const repoForLookup = registry.type === "lscr" ? registry.repo : imageRepo;

  // Check cache first (use normalized repo for cache key)
  const cacheKey = `publishDate:${repoForLookup}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository (use the normalized repo without lscr.io prefix)
    let namespace = "library";
    let repository = repoForLookup;

    if (repoForLookup.includes("/")) {
      const parts = repoForLookup.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Use Docker Hub HTTP API v2 to get tag info
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${tag}/`;
    const hubHeaders = {
      "User-Agent": "Docked/1.0",
    };

    // Use credentials already fetched above for rate limiting
    if (creds.token && creds.username) {
      hubHeaders.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString(
        "base64"
      )}`;
    }

    const hubResponse = await axios.get(hubApiUrl, {
      headers: hubHeaders,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (hubResponse.status === 200 && hubResponse.data) {
      const publishDate = hubResponse.data.tag_last_pushed || hubResponse.data.last_updated;
      if (publishDate) {
        // Cache for 24 hours
        digestCache.set(cacheKey, publishDate, config.cache.digestCacheTTL);
        return publishDate;
      }
    }

    return null;
  } catch (error) {
    if (error.response?.status !== 404) {
      logger.error(`      ❌ Error fetching publish date for ${imageRepo}:${tag}:`, { error });
    }
    return null;
  }
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
async function getTagFromDigest(imageRepo, digest, userId = null) {
  if (!digest || !imageRepo) {
    return null;
  }

  // Normalize digest - extract short form (first 12 chars after sha256:)
  let digestToMatch = digest.trim();
  if (!digestToMatch.startsWith("sha256:")) {
    digestToMatch = `sha256:${digestToMatch}`;
  }

  // Extract short digest (first 12 characters after sha256:)
  // e.g., sha256:ac4ef17209bd... -> ac4ef17209bd
  const shortDigest = digestToMatch.replace("sha256:", "").substring(0, 12);
  const shortDigestWithPrefix = `sha256:${shortDigest}`;

  // Handle lscr.io images - strip prefix for Docker Hub lookup
  // lscr.io images are also available on Docker Hub under the same name
  const registry = detectRegistry(imageRepo);
  const repoForLookup = registry.type === "lscr" ? registry.repo : imageRepo;

  // Check cache first (cache key: repo:shortDigest -> tag)
  const cacheKey = `tag:${repoForLookup}:${shortDigestWithPrefix}`;
  const cached = digestCache.get(cacheKey);
  if (cached && typeof cached === "string") {
    logger.debug(
      `      ✅ Cache HIT for tag lookup: ${repoForLookup}@${shortDigest}... -> ${cached}`
    );
    return cached;
  }

  logger.debug(`      🔍 Looking up tag for digest ${shortDigest}... in ${repoForLookup}`);

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository (use the normalized repo without lscr.io prefix)
    let namespace = "library";
    let repository = repoForLookup;

    if (repoForLookup.includes("/")) {
      const parts = repoForLookup.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Use Docker Hub HTTP API v2
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/?page_size=100`;
    const hubHeaders = {
      "User-Agent": "Docked/1.0",
    };

    // Use credentials already fetched above for rate limiting
    if (creds.token && creds.username) {
      hubHeaders.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString(
        "base64"
      )}`;
    }

    // Only check first page (most recent 100 tags) to minimize API calls
    const hubResponse = await axios.get(hubApiUrl, {
      headers: hubHeaders,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (hubResponse.status === 200 && hubResponse.data && hubResponse.data.results) {
      // Search through tags to find one matching our digest
      for (const tagInfo of hubResponse.data.results) {
        // Check the tag's main digest first (this is the manifest list digest)
        if (tagInfo.digest && tagInfo.digest.startsWith(shortDigestWithPrefix)) {
          logger.debug(`      ✅ Found matching tag by main digest: ${tagInfo.name}`);
          digestCache.set(cacheKey, tagInfo.name, config.cache.digestCacheTTL);
          return tagInfo.name;
        }

        // Also check individual image digests in the images array
        if (tagInfo.images && Array.isArray(tagInfo.images)) {
          for (const image of tagInfo.images) {
            const imageDigest = image.digest;
            if (imageDigest && imageDigest.startsWith(shortDigestWithPrefix)) {
              logger.debug(`      ✅ Found matching tag by image digest: ${tagInfo.name}`);
              digestCache.set(cacheKey, tagInfo.name, config.cache.digestCacheTTL);
              return tagInfo.name;
            }
          }
        }
      }
    }

    // If not found in first page, cache null result for shorter time to avoid repeated lookups
    logger.debug(`      ⚠️  Could not find tag for digest ${shortDigest}... in first 100 tags`);
    // Cache null result for 1 hour to avoid repeated failed lookups
    digestCache.set(cacheKey, null, 60 * 60 * 1000);
    return null;
  } catch (error) {
    // Only log non-404 errors
    if (error.response?.status !== 404) {
      logger.error(`      ❌ Error looking up tag for digest:`, { error });
    }
    // Cache error result for shorter time
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
  } catch (error) {
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
