// Log that we're starting to load the module
console.log("[MODULE] Starting server/index.js module load");

const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config({ quiet: true });
const logger = require("./utils/logger");

console.log("[MODULE] Logger loaded, about to require other modules");

const { initializeRegistrationCode } = require("./utils/registrationCode");
console.log("[MODULE] initializeRegistrationCode loaded");

const { hasAnyUsers } = require("./db/database");
console.log("[MODULE] Database module loaded");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Portainer API configuration
// Support multiple Portainer URLs (comma-separated)
const PORTAINER_URLS = (
  process.env.PORTAINER_URL ||
  process.env.PORTAINER_URLS ||
  "http://localhost:9000"
)
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url.length > 0);
const PORTAINER_USERNAME = process.env.PORTAINER_USERNAME || "admin";
// Read password and ensure it's properly decoded (handles special characters like #)
const PORTAINER_PASSWORD = process.env.PORTAINER_PASSWORD
  ? String(process.env.PORTAINER_PASSWORD)
  : "";

// Store auth tokens per Portainer instance
const authTokens = new Map();

// Cache for image digests (key: "repo:tag", value: { digest, timestamp })
const digestCache = new Map();
const DIGEST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Docker Hub personal access token for higher rate limits
const DOCKER_HUB_TOKEN = process.env.DOCKER_HUB_TOKEN || null;
const DOCKER_HUB_USERNAME = process.env.DOCKER_HUB_USERNAME || null;

// Helper to create Basic Auth header for Docker Hub
function getDockerHubAuthHeader() {
  if (DOCKER_HUB_TOKEN && DOCKER_HUB_USERNAME) {
    // Docker Hub Hub API uses Basic Auth: username:token
    const credentials = Buffer.from(`${DOCKER_HUB_USERNAME}:${DOCKER_HUB_TOKEN}`).toString(
      "base64"
    );
    return `Basic ${credentials}`;
  }
  return null;
}

// Rate limiting: track last request time and add delays
let lastDockerHubRequest = 0;
const DOCKER_HUB_RATE_LIMIT_DELAY = 200; // 200ms between requests

// Helper to delay requests to avoid rate limiting
async function rateLimitDelay() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastDockerHubRequest;
  if (timeSinceLastRequest < DOCKER_HUB_RATE_LIMIT_DELAY) {
    await new Promise((resolve) =>
      setTimeout(resolve, DOCKER_HUB_RATE_LIMIT_DELAY - timeSinceLastRequest)
    );
  }
  lastDockerHubRequest = Date.now();
}

// Retry helper with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // If it's a 429 (rate limit) and we have retries left, wait and retry
      if (error.response?.status === 429 && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        logger.info(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

// Authenticate with a specific Portainer instance
async function authenticatePortainer(portainerUrl) {
  // Check if we already have a valid token for this instance
  if (authTokens.has(portainerUrl)) {
    return authTokens.get(portainerUrl);
  }

  try {
    // Try the standard Portainer API v2 format
    const response = await axios.post(
      `${portainerUrl}/api/auth`,
      {
        username: PORTAINER_USERNAME,
        password: PORTAINER_PASSWORD,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Portainer returns jwt in response.data
    const authToken = response.data.jwt || response.data.token;
    if (!authToken) {
      logger.error(`No token in response for ${portainerUrl}:`, response.data);
      throw new Error("Authentication response missing token");
    }

    // Store token for this instance
    authTokens.set(portainerUrl, authToken);
    return authToken;
  } catch (error) {
    // Enhanced error logging
    if (error.response) {
      logger.error(`Portainer authentication failed for ${portainerUrl}:`);
      logger.error("Status:", error.response.status);
      logger.error("Status Text:", error.response.statusText);
      logger.error("Response Data:", JSON.stringify(error.response.data, null, 2));
      logger.error("Request URL:", error.config?.url);

      // Log payload with password masked for security, but show length and special chars
      const payloadForLog = error.config?.data
        ? JSON.parse(JSON.stringify(error.config.data))
        : null;
      if (payloadForLog && (payloadForLog.password || payloadForLog.Password)) {
        const pwdKey = payloadForLog.password ? "password" : "Password";
        const pwdValue = payloadForLog[pwdKey];
        logger.error("Password length:", pwdValue?.length || 0);
        logger.error("Password contains #:", pwdValue?.includes("#") ? "YES" : "NO");
        logger.error("Password first 2 chars:", pwdValue?.substring(0, 2) || "N/A");
        logger.error("Password last 2 chars:", pwdValue?.substring(pwdValue.length - 2) || "N/A");
        // Mask password in log
        payloadForLog[pwdKey] = "***MASKED***";
      }
      logger.error("Request Payload:", JSON.stringify(payloadForLog, null, 2));

      // Try alternative authentication formats
      if (error.response.status === 422) {
        const altFormats = [
          { Username: PORTAINER_USERNAME, Password: PORTAINER_PASSWORD },
          { user: PORTAINER_USERNAME, password: PORTAINER_PASSWORD },
        ];

        for (const format of altFormats) {
          logger.info(
            `Attempting alternative authentication format for ${portainerUrl}...`,
            Object.keys(format)
          );
          try {
            const altResponse = await axios.post(`${portainerUrl}/api/auth`, format, {
              headers: {
                "Content-Type": "application/json",
              },
            });
            const altToken = altResponse.data.jwt || altResponse.data.token;
            if (altToken) {
              logger.info(`Alternative authentication format succeeded for ${portainerUrl}`);
              authTokens.set(portainerUrl, altToken);
              return altToken;
            }
          } catch (altError) {
            if (altError.response) {
              logger.error(
                `Alternative format failed for ${portainerUrl}:`,
                altError.response.status,
                altError.response.data
              );
            }
          }
        }
      }
    } else {
      logger.error(`Portainer authentication failed for ${portainerUrl}:`, { error });
    }
    throw new Error(
      `Failed to authenticate with Portainer at ${portainerUrl}: ${
        error.response?.data?.message || error.message
      }`
    );
  }
}

// Get Portainer API headers for a specific instance
function getAuthHeaders(portainerUrl) {
  const token = authTokens.get(portainerUrl);
  if (!token) {
    throw new Error(`No authentication token for ${portainerUrl}`);
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// Get all endpoints (Docker environments) for a specific Portainer instance
async function getEndpoints(portainerUrl) {
  try {
    const response = await axios.get(`${portainerUrl}/api/endpoints`, {
      headers: getAuthHeaders(portainerUrl),
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getEndpoints(portainerUrl);
    }
    throw error;
  }
}

// Get all containers for an endpoint
async function getContainers(portainerUrl, endpointId) {
  try {
    const response = await axios.get(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/json?all=true`,
      { headers: getAuthHeaders(portainerUrl) }
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getContainers(portainerUrl, endpointId);
    }
    throw error;
  }
}

// Get container details including image info
async function getContainerDetails(portainerUrl, endpointId, containerId) {
  try {
    const response = await axios.get(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/json`,
      { headers: getAuthHeaders(portainerUrl) }
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getContainerDetails(portainerUrl, endpointId, containerId);
    }
    throw error;
  }
}

// Get all images from an endpoint
async function getImages(portainerUrl, endpointId) {
  try {
    const response = await axios.get(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/images/json?all=true`,
      { headers: getAuthHeaders(portainerUrl) }
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getImages(portainerUrl, endpointId);
    }
    throw error;
  }
}

// Delete an image
async function deleteImage(portainerUrl, endpointId, imageId, force = false) {
  try {
    const url = `${portainerUrl}/api/endpoints/${endpointId}/docker/images/${imageId}${
      force ? "?force=true" : ""
    }`;
    const response = await axios.delete(url, {
      headers: getAuthHeaders(portainerUrl),
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return deleteImage(portainerUrl, endpointId, imageId, force);
    }
    throw error;
  }
}

// Detect registry from image repository
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

// Get Docker Registry API v2 token for authentication
async function getDockerRegistryToken(namespace, repository) {
  try {
    const authUrl = "https://auth.docker.io/token";
    const params = {
      service: "registry.docker.io",
      scope: `repository:${namespace}/${repository}:pull`,
    };

    const config = {
      params: params,
      timeout: 10000,
    };

    // If we have Docker Hub credentials, use Basic Auth
    if (DOCKER_HUB_TOKEN && DOCKER_HUB_USERNAME) {
      config.auth = {
        username: DOCKER_HUB_USERNAME,
        password: DOCKER_HUB_TOKEN,
      };
    }

    const response = await axios.get(authUrl, config);
    return response.data?.token || null;
  } catch (error) {
    logger.error(
      `Error getting Docker Registry token for ${namespace}/${repository}:`,
      error.message
    );
    return null;
  }
}

// Get index digest from Docker Hub Registry API v2 for a specific tag
async function getImageDigestFromDockerHub(imageRepo, tag = "latest") {
  // Check cache first
  const cacheKey = `${imageRepo}:${tag}`;
  const cached = digestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DIGEST_CACHE_TTL) {
    return cached.digest;
  }

  try {
    // Rate limit: add delay between requests
    await rateLimitDelay();

    // Parse image repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Get authentication token
    const token = await getDockerRegistryToken(namespace, repository);
    if (!token) {
      logger.error(`Failed to get authentication token for ${namespace}/${repository}`);
      return null;
    }

    // Request manifest list (index) to get the index digest
    const registryUrl = `https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${tag}`;
    const headers = {
      Accept: "application/vnd.docker.distribution.manifest.list.v2+json",
      Authorization: `Bearer ${token}`,
    };

    const response = await retryWithBackoff(async () => {
      return await axios.get(registryUrl, {
        headers: headers,
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });
    });

    // Get the index digest from the docker-content-digest header
    if (response.status === 200 && response.headers["docker-content-digest"]) {
      const digest = response.headers["docker-content-digest"];
      // Cache the result
      digestCache.set(cacheKey, { digest, timestamp: Date.now() });
      return digest;
    }

    return null;
  } catch (error) {
    // Only log non-404 errors and non-429 errors (429s are handled by retry)
    if (error.response?.status !== 404 && error.response?.status !== 429) {
      logger.error(`Error fetching index digest for ${imageRepo}:${tag}:`, { error });
    }
    return null;
  }
}

// Get the image digest from registry for a specific tag
// Legacy function - use registryService.getLatestDigest() in new code
async function getLatestImageDigest(imageRepo, tag = "latest", userId = null) {
  const registryService = require("./services/registry");
  try {
    return await registryService.getLatestDigest(imageRepo, tag, { userId });
  } catch (error) {
    // Return null on error for backward compatibility
    return null;
  }
}

// Get the SHA digest from Docker Hub for a specific tag
async function getLatestVersionFromDockerHub(imageRepo, tag = "latest") {
  // Get the index digest for the specified tag
  return await getImageDigestFromDockerHub(imageRepo, tag);
}

// Get the latest version tag from any registry
async function getLatestVersionFromRegistry(imageRepo) {
  const registry = detectRegistry(imageRepo);

  switch (registry.type) {
    case "dockerhub":
      return await getLatestVersionFromDockerHub(registry.repo);
    case "ghcr":
    case "gitlab":
    case "gcr":
    case "lscr":
      // These registries don't have public APIs like Docker Hub
      // Return null to indicate we can't determine the version
      return null;
    default:
      return null;
  }
}

// Get current image digest from container
async function getCurrentImageDigest(containerDetails, imageName, portainerUrl, endpointId) {
  // First check if image name already contains a digest
  const configImage = containerDetails.Config?.Image;
  if (configImage && configImage.includes("@sha256:")) {
    const digest = configImage.split("@sha256:")[1];
    return `sha256:${digest}`;
  }

  // Get the actual image ID from the container (this is the image the container is running)
  // The Image field contains the image ID (shortened digest)
  const imageId = containerDetails.Image;

  // If we have portainerUrl and endpointId, we can inspect the image to get the full digest
  if (portainerUrl && endpointId && imageId) {
    try {
      // Inspect the image to get its RepoDigests
      const imageResponse = await axios.get(
        `${portainerUrl}/api/endpoints/${endpointId}/docker/images/${imageId}/json`,
        { headers: getAuthHeaders(portainerUrl) }
      );

      const imageData = imageResponse.data;
      // RepoDigests contains full digests like ["repo@sha256:abc123..."]
      if (imageData.RepoDigests && imageData.RepoDigests.length > 0) {
        // Find the digest that matches our image repo exactly
        const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
        const repo = imageParts[0];

        // Debug: log available RepoDigests for troubleshooting
        if (imageData.RepoDigests.length > 1) {
          logger.info(
            `Image ${imageName} has ${imageData.RepoDigests.length} RepoDigests:`,
            imageData.RepoDigests.map((rd) => rd.split("@sha256:")[0])
          );
        }

        // Normalize repo for matching (remove registry prefixes)
        const normalizeRepo = (repoStr) => {
          // Remove common registry prefixes
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
              return `sha256:${digest}`;
            }
          }
        }

        // Last resort: use the first RepoDigest if we can't find a match
        // This should rarely happen, but better than returning null
        const firstRepoDigest = imageData.RepoDigests[0];
        if (firstRepoDigest && firstRepoDigest.includes("@sha256:")) {
          const digest = firstRepoDigest.split("@sha256:")[1];
          logger.info(
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
      // Return null and let the comparison fall back to tag-based comparison
      logger.info(`Could not inspect image ${imageId} to get digest: ${error.message}`);
    }
  }

  // Return null if we can't get the local image digest
  // The comparison will fall back to tag-based comparison
  return null;
}

// Get available image tags from registry
// Legacy function - use imageUpdateService.checkImageUpdates() in new code
async function checkImageUpdates(
  imageName,
  containerDetails = null,
  portainerUrl = null,
  endpointId = null,
  userId = null
) {
  // Use the imageUpdateService for consistency
  const imageUpdateService = require("./services/imageUpdateService");
  return await imageUpdateService.checkImageUpdates(
    imageName,
    containerDetails,
    portainerUrl,
    endpointId,
    userId
  );
}

// Pull new image
async function pullImage(portainerUrl, endpointId, imageName) {
  try {
    const response = await axios.post(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/images/create`,
      null,
      {
        headers: getAuthHeaders(portainerUrl),
        params: {
          fromImage: imageName.split(":")[0],
          tag: imageName.includes(":") ? imageName.split(":")[1] : "latest",
        },
      }
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return pullImage(portainerUrl, endpointId, imageName);
    }
    throw error;
  }
}

// Stop container
async function stopContainer(portainerUrl, endpointId, containerId) {
  try {
    await axios.post(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/stop`,
      null,
      { headers: getAuthHeaders(portainerUrl) }
    );
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return stopContainer(portainerUrl, endpointId, containerId);
    }
    throw error;
  }
}

// Remove container
async function removeContainer(portainerUrl, endpointId, containerId) {
  try {
    await axios.delete(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}`,
      { headers: getAuthHeaders(portainerUrl) }
    );
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return removeContainer(portainerUrl, endpointId, containerId);
    }
    throw error;
  }
}

// Create container from image (recreate with same config)
async function createContainer(portainerUrl, endpointId, containerConfig, containerName) {
  try {
    // Docker API requires name as a query parameter, not in the body
    const url = `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/create`;
    const config = {
      headers: getAuthHeaders(portainerUrl),
    };

    // Add name as query parameter if provided
    if (containerName) {
      // Remove leading slash if present (Docker API expects name without leading slash)
      const cleanName = containerName.startsWith("/") ? containerName.substring(1) : containerName;
      config.params = { name: cleanName };
    }

    const response = await axios.post(url, containerConfig, config);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return createContainer(portainerUrl, endpointId, containerConfig, containerName);
    }
    throw error;
  }
}

// Start container
async function startContainer(portainerUrl, endpointId, containerId) {
  try {
    await axios.post(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/start`,
      null,
      { headers: getAuthHeaders(portainerUrl) }
    );
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return startContainer(portainerUrl, endpointId, containerId);
    }
    throw error;
  }
}

// API Routes

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get all containers with upgrade status from all Portainer instances
app.get("/api/containers", async (req, res) => {
  try {
    const allContainers = [];

    // Fetch containers from all Portainer instances
    for (const portainerUrl of PORTAINER_URLS) {
      try {
        await authenticatePortainer(portainerUrl);
        const endpoints = await getEndpoints(portainerUrl);

        if (endpoints.length === 0) {
          logger.info(`No endpoints found for ${portainerUrl}`);
          continue;
        }

        // Use first endpoint for each Portainer instance
        const endpointId = endpoints[0].Id;
        const containers = await getContainers(portainerUrl, endpointId);

        const containersWithUpdates = await Promise.all(
          containers.map(async (container) => {
            const details = await getContainerDetails(portainerUrl, endpointId, container.Id);
            const imageName = details.Config.Image;
            const updateInfo = await checkImageUpdates(
              imageName,
              details,
              portainerUrl,
              endpointId
            );

            // Extract stack name from labels
            // Portainer/Docker Compose uses com.docker.compose.project label
            const labels = details.Config.Labels || {};
            const stackName =
              labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl, // Track which Portainer instance
              portainerName: new URL(portainerUrl).hostname, // Friendly name
              hasUpdate: updateInfo.hasUpdate,
              currentTag: updateInfo.currentTag,
              currentVersion: updateInfo.currentVersion,
              currentDigest: updateInfo.currentDigest,
              latestTag: updateInfo.latestTag,
              newVersion: updateInfo.newVersion,
              latestDigest: updateInfo.latestDigest,
              imageRepo: updateInfo.imageRepo,
              stackName: stackName,
            };
          })
        );

        allContainers.push(...containersWithUpdates);
      } catch (error) {
        logger.error(`Error fetching containers from ${portainerUrl}:`, { error });
        // Continue with other Portainer instances even if one fails
      }
    }

    // Group containers by stack
    const groupedByStack = allContainers.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    // Convert to array format with stack names
    const groupedContainers = Object.keys(groupedByStack).map((stackName) => ({
      stackName: stackName,
      containers: groupedByStack[stackName],
    }));

    // Sort stacks: named stacks first, then "Standalone"
    groupedContainers.sort((a, b) => {
      if (a.stackName === "Standalone") {
        return 1;
      }
      if (b.stackName === "Standalone") {
        return -1;
      }
      return a.stackName.localeCompare(b.stackName);
    });

    // Get unused images count
    let unusedImagesCount = 0;
    for (const portainerUrl of PORTAINER_URLS) {
      try {
        await authenticatePortainer(portainerUrl);
        const endpoints = await getEndpoints(portainerUrl);
        if (endpoints.length === 0) {
          continue;
        }

        const endpointId = endpoints[0].Id;
        const images = await getImages(portainerUrl, endpointId);
        const containers = await getContainers(portainerUrl, endpointId);

        // Get all used image IDs (normalize to handle both full and shortened IDs)
        const usedIds = new Set();
        const normalizeImageId = (id) => {
          // Remove 'sha256:' prefix if present and take first 12 chars for comparison
          const cleanId = id.replace(/^sha256:/, "");
          return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
        };

        for (const container of containers) {
          const details = await getContainerDetails(portainerUrl, endpointId, container.Id);
          if (details.Image) {
            // Add both full and normalized versions
            usedIds.add(details.Image);
            usedIds.add(normalizeImageId(details.Image));
          }
        }

        // Count unused images
        for (const image of images) {
          const imageIdNormalized = normalizeImageId(image.Id);
          // Check if image is used (compare both full ID and normalized)
          const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);
          if (!isUsed) {
            unusedImagesCount++;
          }
        }
      } catch (error) {
        logger.error(`Error counting unused images from ${portainerUrl}:`, { error });
      }
    }

    res.json({
      grouped: true,
      stacks: groupedContainers,
      // Also include flat list for backward compatibility
      containers: allContainers,
      unusedImagesCount: unusedImagesCount,
    });
  } catch (error) {
    logger.error("Error fetching containers:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to upgrade a single container
async function upgradeSingleContainer(portainerUrl, endpointId, containerId, imageName) {
  // Get container details to preserve configuration
  const containerDetails = await getContainerDetails(portainerUrl, endpointId, containerId);

  // Preserve the original container name (important for stacks)
  const originalContainerName = containerDetails.Name;

  // Extract current and new image info
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const imageRepo = imageParts[0];
  const currentTag = imageParts[1];

  // Get the image digest from registry for the current tag
  const latestImageInfo = await getLatestImageDigest(imageRepo, currentTag);
  // Use the current tag for upgrades (to get the latest version of that tag)
  const newTag = currentTag;
  const newImageName = `${imageRepo}:${newTag}`;

  // Stop the container
  await stopContainer(portainerUrl, endpointId, containerId);

  // Pull the latest image
  await pullImage(portainerUrl, endpointId, newImageName);

  // Remove old container
  await removeContainer(portainerUrl, endpointId, containerId);

  // Create new container with same configuration
  const containerConfig = {
    Image: newImageName,
    Cmd: containerDetails.Config.Cmd,
    Env: containerDetails.Config.Env,
    ExposedPorts: containerDetails.Config.ExposedPorts,
    HostConfig: containerDetails.HostConfig,
    Labels: containerDetails.Config.Labels,
    WorkingDir: containerDetails.Config.WorkingDir,
    Entrypoint: containerDetails.Config.Entrypoint,
  };

  // Pass container name as separate parameter (Docker API uses it as query param)
  const newContainer = await createContainer(
    portainerUrl,
    endpointId,
    containerConfig,
    originalContainerName
  );

  // Start the new container
  await startContainer(portainerUrl, endpointId, newContainer.Id);

  // Invalidate cache for this image so next check gets fresh data
  // Clear the digest cache for this repo
  const registry = detectRegistry(imageRepo);
  if (registry.type === "dockerhub") {
    // Clear digest cache for the tag that was upgraded
    const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
    const tag = imageParts[1];
    digestCache.delete(`${registry.repo}:${tag}`);
  }

  return {
    success: true,
    containerId: containerId,
    containerName: originalContainerName.replace("/", ""),
    newContainerId: newContainer.Id,
    oldImage: imageName,
    newImage: newImageName,
  };
}

// Upgrade a container
app.post("/api/containers/:containerId/upgrade", async (req, res) => {
  try {
    const { containerId } = req.params;
    const { endpointId, imageName, portainerUrl } = req.body;

    if (!endpointId || !imageName || !portainerUrl) {
      return res.status(400).json({
        error: "endpointId, imageName, and portainerUrl are required",
      });
    }

    await authenticatePortainer(portainerUrl);
    const result = await upgradeSingleContainer(portainerUrl, endpointId, containerId, imageName);

    res.json({
      success: true,
      message: "Container upgraded successfully",
      ...result,
    });
  } catch (error) {
    logger.error("Error upgrading container:", error);
    res.status(500).json({ error: error.message });
  }
});

// Batch upgrade multiple containers
// Get unused images from all Portainer instances
app.get("/api/images/unused", async (req, res) => {
  try {
    const unusedImages = [];

    for (const portainerUrl of PORTAINER_URLS) {
      try {
        await authenticatePortainer(portainerUrl);
        const endpoints = await getEndpoints(portainerUrl);
        if (endpoints.length === 0) {
          continue;
        }

        const endpointId = endpoints[0].Id;
        const images = await getImages(portainerUrl, endpointId);
        const containers = await getContainers(portainerUrl, endpointId);

        // Get all used image IDs (normalize to handle both full and shortened IDs)
        const usedIds = new Set();
        const normalizeImageId = (id) => {
          // Remove 'sha256:' prefix if present and take first 12 chars for comparison
          const cleanId = id.replace(/^sha256:/, "");
          return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
        };

        for (const container of containers) {
          const details = await getContainerDetails(portainerUrl, endpointId, container.Id);
          if (details.Image) {
            // Add both full and normalized versions
            usedIds.add(details.Image);
            usedIds.add(normalizeImageId(details.Image));
          }
        }

        // Find unused images
        for (const image of images) {
          const imageIdNormalized = normalizeImageId(image.Id);
          // Check if image is used (compare both full ID and normalized)
          const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);

          if (!isUsed) {
            logger.info(image);
            // Extract repository tags/names
            let repoTags = image.RepoTags;

            // If RepoTags is null or empty, try to get from RepoDigests
            if (
              !repoTags ||
              repoTags.length === 0 ||
              (repoTags.length === 1 && repoTags[0] === "<none>:<none>")
            ) {
              if (image.RepoDigests && image.RepoDigests.length > 0) {
                // Extract repository names from digests (format: "repo@sha256:...")
                repoTags = image.RepoDigests.map((digest) => {
                  const repoPart = digest.split("@sha256:")[0];
                  return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                });
              } else {
                // Try to inspect the image to get more details
                try {
                  const imageDetails = await axios.get(
                    `${portainerUrl}/api/endpoints/${endpointId}/docker/images/${image.Id}/json`,
                    { headers: getAuthHeaders(portainerUrl) }
                  );
                  const details = imageDetails.data;
                  if (details.RepoTags && details.RepoTags.length > 0) {
                    repoTags = details.RepoTags;
                  } else if (details.RepoDigests && details.RepoDigests.length > 0) {
                    repoTags = details.RepoDigests.map((digest) => {
                      const repoPart = digest.split("@sha256:")[0];
                      return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                    });
                  }
                } catch (err) {
                  // If inspection fails, use default
                  logger.info(`Could not inspect image ${image.Id}: ${err.message}`);
                }
              }
            }

            // Fallback to default if still no tags
            if (!repoTags || repoTags.length === 0) {
              repoTags = ["<none>:<none>"];
            }

            unusedImages.push({
              id: image.Id,
              repoTags: repoTags,
              size: image.Size,
              created: image.Created,
              portainerUrl: portainerUrl,
              endpointId: endpointId,
              portainerName: new URL(portainerUrl).hostname,
            });
          }
        }
      } catch (error) {
        logger.error(`Error fetching unused images from ${portainerUrl}:`, { error });
      }
    }

    res.json({ unusedImages });
  } catch (error) {
    logger.error("Error fetching unused images:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete selected images
app.post("/api/images/delete", async (req, res) => {
  try {
    const { images } = req.body; // Array of { id, portainerUrl, endpointId }
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "images array is required" });
    }

    const results = [];
    const errors = [];

    // Deduplicate images by id+portainerUrl+endpointId to avoid deleting the same image twice
    const uniqueImages = [];
    const seenKeys = new Set();
    for (const image of images) {
      const key = `${image.id}-${image.portainerUrl}-${image.endpointId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueImages.push(image);
      }
    }

    logger.info(
      `Received ${images.length} images, deduplicated to ${uniqueImages.length} unique images`
    );

    // Delete images
    for (const image of uniqueImages) {
      const { id, portainerUrl, endpointId } = image;
      if (!id || !portainerUrl || !endpointId) {
        errors.push({ id: id || "unknown", error: "Missing required fields" });
        continue;
      }

      try {
        await authenticatePortainer(portainerUrl);
        logger.info(`Deleting image ${id.substring(0, 12)} from ${portainerUrl}`);
        await deleteImage(portainerUrl, endpointId, id, true);
        results.push({ id, success: true });
      } catch (error) {
        logger.error(`Failed to delete image ${id.substring(0, 12)}:`, error.message);
        errors.push({ id, error: error.message });
      }
    }

    res.json({
      success: true,
      deleted: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error("Error deleting images:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/containers/batch-upgrade", async (req, res) => {
  try {
    const { containers } = req.body;

    if (!containers || !Array.isArray(containers) || containers.length === 0) {
      return res.status(400).json({ error: "containers array is required and must not be empty" });
    }

    // Validate all containers have required fields
    for (const container of containers) {
      if (
        !container.containerId ||
        !container.endpointId ||
        !container.imageName ||
        !container.portainerUrl
      ) {
        return res.status(400).json({
          error: "Each container must have containerId, endpointId, imageName, and portainerUrl",
        });
      }
    }

    // Upgrade containers sequentially to avoid conflicts
    const results = [];
    const errors = [];

    for (const container of containers) {
      try {
        await authenticatePortainer(container.portainerUrl);
        const result = await upgradeSingleContainer(
          container.portainerUrl,
          container.endpointId,
          container.containerId,
          container.imageName
        );
        results.push(result);
      } catch (error) {
        logger.error(`Error upgrading container ${container.containerId}:`, error);
        errors.push({
          containerId: container.containerId,
          containerName: container.containerName || "Unknown",
          error: error.message,
        });
      }
    }

    res.json({
      success: errors.length === 0,
      message: `Upgraded ${results.length} container(s), ${errors.length} error(s)`,
      results: results,
      errors: errors,
    });
  } catch (error) {
    logger.error("Error in batch upgrade:", error);
    res.status(500).json({ error: error.message });
  }
});

// Import batch scheduler
console.log("[MODULE] About to require batch system");
const batchSystem = require("./services/batch");
console.log("[MODULE] Batch system loaded");

// Handle unhandled promise rejections to prevent crashes
process.on("unhandledRejection", (reason, promise) => {
  logger.error("[SERVER] Unhandled Rejection at:", promise, "reason:", reason);
  console.error("[SERVER] Unhandled Rejection:", reason);
  // Don't exit - log and continue
});

// Handle uncaught exceptions to prevent crashes
process.on("uncaughtException", (error) => {
  logger.error("[SERVER] Uncaught Exception:", error);
  logger.error("[SERVER] Stack:", { error });
  console.error("[SERVER] Uncaught Exception:", error);
  console.error("[SERVER] Stack:", error.stack);
  // Don't exit - log and continue (server should keep running)
});

console.log("[MODULE] About to call app.listen()");
logger.info("[SERVER] About to call app.listen() on port", PORT);

// Registration code is now generated on-demand when user clicks "Create User"
// No longer generated on server startup

const server = app.listen(PORT, () => {
  logger.info(`[SERVER] ✅ Server running on port ${PORT}`);
  logger.info(`Portainer URLs: ${PORTAINER_URLS.join(", ")}`);
  logger.info(`Portainer Username: ${PORTAINER_USERNAME}`);
  // Debug: Show password info without exposing it
  logger.info(`Password length: ${PORTAINER_PASSWORD.length}`);
  logger.info(`Password contains #: ${PORTAINER_PASSWORD.includes("#") ? "YES" : "NO"}`);
  if (PORTAINER_PASSWORD.length > 0) {
    logger.info(`Password first char: ${PORTAINER_PASSWORD[0]}`);
    logger.info(`Password last char: ${PORTAINER_PASSWORD[PORTAINER_PASSWORD.length - 1]}`);
  }
  // Docker Hub token status
  if (DOCKER_HUB_TOKEN && DOCKER_HUB_USERNAME) {
    logger.info(`Docker Hub authentication: Configured (higher rate limits enabled)`);
    logger.info(`  Username: ${DOCKER_HUB_USERNAME}`);
  } else {
    logger.info(`Docker Hub authentication: Not configured (using anonymous rate limits)`);
    logger.info(`  Set DOCKER_HUB_USERNAME and DOCKER_HUB_TOKEN for higher rate limits`);
  }
  logger.info(`Cache TTL: 24 hours`);

  // Start batch system (runs jobs in background even when browser is closed)
  // Use setImmediate to ensure server is fully started before starting batch system
  setImmediate(() => {
    logger.info("[SERVER] Attempting to start batch system...");
    batchSystem
      .start()
      .then(() => {
        logger.info("[SERVER] ✅ Batch system started successfully");
      })
      .catch((err) => {
        logger.error("[SERVER] ❌ ERROR starting batch system:", { error: err });
        logger.error("[SERVER] Stack:", { error: err });
        logger.error("Error starting batch system:", { error: err });
        // Don't crash the server if batch system fails to start
      });
  });
});

// Handle server errors
server.on("error", (err) => {
  logger.error(`[SERVER] ❌ Server error on port ${PORT}:`, err);
  if (err.code === "EADDRINUSE") {
    logger.error(`[SERVER] Port ${PORT} is already in use`);
  }
  process.exit(1);
});
