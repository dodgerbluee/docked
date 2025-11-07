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
 * @returns {Promise<string|null>} - Authentication token
 */
async function getDockerRegistryToken(namespace, repository) {
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
    const creds = await getDockerHubCreds();
    if (creds.token && creds.username) {
      requestConfig.auth = {
        username: creds.username,
        password: creds.token,
      };
    }

    const response = await axios.get(authUrl, requestConfig);
    return response.data?.token || null;
  } catch (error) {
    console.error(
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
 * @returns {Promise<string|null>} - Image digest
 */
async function getImageDigestFromDockerHub(imageRepo, tag = "latest") {
  // Check cache first
  const cacheKey = `${imageRepo}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    console.log(`      ✅ Cache HIT for ${imageRepo}:${tag}`);
    return cached;
  }

  console.log(
    `      🔄 Cache MISS - fetching ${imageRepo}:${tag} from Docker Hub`
  );

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds();
    const delay = (creds.token && creds.username) ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Get authentication token
    console.log(`      🔑 Getting auth token for ${namespace}/${repository}`);
    const token = await getDockerRegistryToken(namespace, repository);
    if (!token) {
      console.error(
        `      ❌ Failed to get authentication token for ${namespace}/${repository}`
      );
      return null;
    }
    console.log(`      ✅ Got auth token`);

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
      config.retry.maxRetries,
      config.retry.baseDelay
    );

    // Get the index digest from the docker-content-digest header
    console.log(`      📦 Manifest response status: ${response.status}`);
    if (response.status === 200 && response.headers["docker-content-digest"]) {
      const digest = response.headers["docker-content-digest"];
      console.log(
        `      ✅ Got digest from manifest: ${digest.substring(0, 20)}...`
      );
      // Cache the result
      digestCache.set(cacheKey, digest, config.cache.digestCacheTTL);
      return digest;
    }

    console.log(`      ⚠️  No digest in response (status: ${response.status})`);
    return null;
  } catch (error) {
    // Only log non-404 errors and non-429 errors (429s are handled by retry)
    if (error.response?.status !== 404 && error.response?.status !== 429) {
      console.error(
        `      ❌ Error fetching index digest for ${imageRepo}:${tag}:`,
        error.message,
        `Status: ${error.response?.status}`
      );
    } else if (error.response?.status === 404) {
      console.log(`      ⚠️  Image ${imageRepo}:${tag} not found (404)`);
    }
    return null;
  }
}

/**
 * Get the image digest from registry for a specific tag
 * @param {string} imageRepo - Image repository
 * @param {string} tag - Image tag (default: 'latest')
 * @returns {Promise<Object|null>} - Object with digest and tag, or null
 */
async function getLatestImageDigest(imageRepo, tag = "latest") {
  console.log(
    `      🐳 Docker Registry: Fetching digest for ${imageRepo}:${tag}`
  );
  const registry = detectRegistry(imageRepo);

  switch (registry.type) {
    case "dockerhub":
      // Get digest for the specified tag (index digest)
      const digest = await getImageDigestFromDockerHub(registry.repo, tag);
      if (digest) {
        return { digest: digest, tag: tag };
      }
      return null;
    case "ghcr":
    case "gitlab":
    case "gcr":
    case "lscr":
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
async function getCurrentImageDigest(
  containerDetails,
  imageName,
  portainerUrl,
  endpointId
) {
  console.log(`      🔍 Getting current digest for ${imageName}`);

  // First check if image name already contains a digest
  const configImage = containerDetails.Config?.Image;
  if (configImage && configImage.includes("@sha256:")) {
    const digest = configImage.split("@sha256:")[1];
    console.log(
      `      ✅ Found digest in image name: sha256:${digest.substring(
        0,
        12
      )}...`
    );
    return `sha256:${digest}`;
  }

  // Get the actual image ID from the container
  const imageId = containerDetails.Image;
  console.log(`      🖼️  Image ID: ${imageId?.substring(0, 12)}...`);

  // If we have portainerUrl and endpointId, we can inspect the image to get the full digest
  if (portainerUrl && endpointId && imageId) {
    try {
      // Inspect the image to get its RepoDigests
      const imageData = await portainerService.getImageDetails(
        portainerUrl,
        endpointId,
        imageId
      );

      // RepoDigests contains full digests like ["repo@sha256:abc123..."]
      console.log(
        `      📋 Image RepoDigests:`,
        imageData.RepoDigests?.length || 0
      );
      if (imageData.RepoDigests && imageData.RepoDigests.length > 0) {
        // Find the digest that matches our image repo exactly
        const imageParts = imageName.includes(":")
          ? imageName.split(":")
          : [imageName, "latest"];
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
              console.log(
                `      ✅ Found exact match digest: sha256:${digest.substring(
                  0,
                  12
                )}...`
              );
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
              console.log(
                `      ✅ Found partial match digest: sha256:${digest.substring(
                  0,
                  12
                )}...`
              );
              return `sha256:${digest}`;
            }
          }
        }

        // Last resort: use the first RepoDigest if we can't find a match
        const firstRepoDigest = imageData.RepoDigests[0];
        if (firstRepoDigest && firstRepoDigest.includes("@sha256:")) {
          const digest = firstRepoDigest.split("@sha256:")[1];
          console.log(
            `Warning: Using first RepoDigest for ${imageName} as fallback: ${digest.substring(
              0,
              12
            )}`
          );
          return `sha256:${digest}`;
        }
      }
    } catch (error) {
      // If image inspection fails, we can't get the digest
      console.log(
        `Could not inspect image ${imageId} to get digest: ${error.message}`
      );
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
async function getTagPublishDate(imageRepo, tag = "latest") {
  if (!imageRepo) return null;

  // Check cache first
  const cacheKey = `publishDate:${imageRepo}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds();
    const delay = (creds.token && creds.username) ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Use Docker Hub HTTP API v2 to get tag info
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${tag}/`;
    const hubHeaders = {
      "User-Agent": "Dockaverger/1.0",
    };

    // Use credentials already fetched above for rate limiting
    if (creds.token && creds.username) {
      hubHeaders.Authorization = `Basic ${Buffer.from(
        `${creds.username}:${creds.token}`
      ).toString("base64")}`;
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
      console.error(`      ❌ Error fetching publish date for ${imageRepo}:${tag}:`, error.message);
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
async function getTagFromDigest(imageRepo, digest) {
  if (!digest || !imageRepo) return null;

  // Normalize digest - extract short form (first 12 chars after sha256:)
  let digestToMatch = digest.trim();
  if (!digestToMatch.startsWith("sha256:")) {
    digestToMatch = `sha256:${digestToMatch}`;
  }

  // Extract short digest (first 12 characters after sha256:)
  // e.g., sha256:ac4ef17209bd... -> ac4ef17209bd
  const shortDigest = digestToMatch.replace("sha256:", "").substring(0, 12);
  const shortDigestWithPrefix = `sha256:${shortDigest}`;

  // Check cache first (cache key: repo:shortDigest -> tag)
  const cacheKey = `tag:${imageRepo}:${shortDigestWithPrefix}`;
  const cached = digestCache.get(cacheKey);
  if (cached && typeof cached === "string") {
    console.log(
      `      ✅ Cache HIT for tag lookup: ${imageRepo}@${shortDigest}... -> ${cached}`
    );
    return cached;
  }

  console.log(
    `      🔍 Looking up tag for digest ${shortDigest}... in ${imageRepo}`
  );

  try {
    // Rate limit: add delay between requests
    // Use shorter delay if authenticated (check credentials dynamically)
    const creds = await getDockerHubCreds();
    const delay = (creds.token && creds.username) ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse image repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Use Docker Hub HTTP API v2
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/?page_size=100`;
    const hubHeaders = {
      "User-Agent": "Dockaverger/1.0",
    };

    // Use credentials already fetched above for rate limiting
    if (creds.token && creds.username) {
      hubHeaders.Authorization = `Basic ${Buffer.from(
        `${creds.username}:${creds.token}`
      ).toString("base64")}`;
    }

    // Only check first page (most recent 100 tags) to minimize API calls
    const hubResponse = await axios.get(hubApiUrl, {
      headers: hubHeaders,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (
      hubResponse.status === 200 &&
      hubResponse.data &&
      hubResponse.data.results
    ) {
      // Search through tags to find one matching our digest
      for (const tagInfo of hubResponse.data.results) {
        // Check the tag's main digest first (this is the manifest list digest)
        if (
          tagInfo.digest &&
          tagInfo.digest.startsWith(shortDigestWithPrefix)
        ) {
          console.log(
            `      ✅ Found matching tag by main digest: ${tagInfo.name}`
          );
          digestCache.set(cacheKey, tagInfo.name, config.cache.digestCacheTTL);
          return tagInfo.name;
        }

        // Also check individual image digests in the images array
        if (tagInfo.images && Array.isArray(tagInfo.images)) {
          for (const image of tagInfo.images) {
            const imageDigest = image.digest;
            if (imageDigest && imageDigest.startsWith(shortDigestWithPrefix)) {
              console.log(
                `      ✅ Found matching tag by image digest: ${tagInfo.name}`
              );
              digestCache.set(
                cacheKey,
                tagInfo.name,
                config.cache.digestCacheTTL
              );
              return tagInfo.name;
            }
          }
        }
      }
    }

    // If not found in first page, cache null result for shorter time to avoid repeated lookups
    console.log(
      `      ⚠️  Could not find tag for digest ${shortDigest}... in first 100 tags`
    );
    // Cache null result for 1 hour to avoid repeated failed lookups
    digestCache.set(cacheKey, null, 60 * 60 * 1000);
    return null;
  } catch (error) {
    // Only log non-404 errors
    if (error.response?.status !== 404) {
      console.error(`      ❌ Error looking up tag for digest:`, error.message);
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

module.exports = {
  detectRegistry,
  getLatestImageDigest,
  getCurrentImageDigest,
  getTagFromDigest,
  getTagPublishDate,
  clearDigestCache,
};
