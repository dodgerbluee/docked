/**
 * Container Service
 * Handles container operations and update checking
 */

const axios = require("axios");
const { URL } = require("url");
const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const config = require("../config");
const {
  getAllPortainerInstances,
  getContainerCache,
  setContainerCache,
  clearContainerCache,
} = require("../db/database");
const logger = require("../utils/logger");
const { validateUrlForSSRF, validatePathComponent } = require("../utils/validation");

// Lazy load discordService to avoid loading issues during module initialization
let discordService = null;
function getDiscordService() {
  if (!discordService) {
    try {
      discordService = require("./discordService");
    } catch (error) {
      logger.error("Error loading discordService:", error);
      return null;
    }
  }
  return discordService;
}

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
        if (!digest) return null;
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

/**
 * Upgrade a single container
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} imageName - Image name (repo:tag)
 * @returns {Promise<Object>} - Upgrade result
 */
async function upgradeSingleContainer(portainerUrl, endpointId, containerId, imageName) {
  // Normalize container ID - Docker API accepts both full and shortened IDs
  // Try with the provided ID first, then fall back to shortened version if needed
  const normalizeContainerId = (id) => {
    // If it's a full 64-character hash, try both full and shortened
    if (id && id.length === 64) {
      return id.substring(0, 12);
    }
    return id;
  };

  // Detect if this is nginx-proxy-manager EARLY (before fetching container details)
  // We can detect by image name, which is available before fetching container details
  // If nginx goes down, this app's UI becomes unavailable, so we need to use IP addresses
  // to ensure Portainer API calls still work during the upgrade
  const isNginxProxyManager = imageName.toLowerCase().includes("nginx-proxy-manager");

  // If it's nginx-proxy-manager, get IP address and use it for all Portainer calls
  let workingPortainerUrl = portainerUrl;
  if (isNginxProxyManager) {
    try {
      const instances = await getAllPortainerInstances();
      const instance = instances.find((inst) => inst.url === portainerUrl);

      if (instance && instance.ip_address) {
        const originalUrl = new URL(portainerUrl);
        const ipAddress = instance.ip_address;
        const originalPort =
          originalUrl.port || (originalUrl.protocol === "https:" ? "9443" : "9000");

        // Create IP-based URL
        workingPortainerUrl = `${originalUrl.protocol}//${ipAddress}:${originalPort}`;

        logger.info(
          `Detected nginx-proxy-manager upgrade, using IP-based Portainer URL: ${workingPortainerUrl}`,
          {
            module: "containerService",
            operation: "upgradeSingleContainer",
            originalUrl: portainerUrl,
            ipUrl: workingPortainerUrl,
            ipAddress: ipAddress,
            instanceName: instance.name || "unknown",
            instanceId: instance.id,
            warning:
              "⚠️  If upgrade fails, verify the IP address in Settings > Portainer Instances matches the actual Portainer server IP",
          }
        );

        // Log a clear warning about the IP being used
        logger.warn(
          `Using IP address ${ipAddress} from database for Portainer instance "${instance.name || portainerUrl}". ` +
            `If this is incorrect, update it in Settings > Portainer Instances.`,
          {
            module: "containerService",
            operation: "upgradeSingleContainer",
            portainerUrl: portainerUrl,
            storedIpAddress: ipAddress,
            instanceName: instance.name,
            instanceId: instance.id,
          }
        );

        // Note: We don't pre-authenticate here because:
        // 1. Nginx is still up at this point, so original URL works
        // 2. Portainer might reject IP-based auth requests even with correct Host header
        // 3. Authentication will happen naturally on first API call when nginx goes down
        // 4. The fetchContainerDetails helper will handle authentication retries
        logger.info(
          "Skipping pre-authentication for nginx upgrade - will authenticate on first API call",
          {
            ipUrl: workingPortainerUrl,
            originalUrl: portainerUrl,
          }
        );
      } else {
        logger.warn(
          `No IP address cached for Portainer instance ${portainerUrl}, upgrade may fail if DNS is unavailable`
        );
      }
    } catch (error) {
      logger.error("Error getting IP address for Portainer instance:", error.message);
      // Continue with original URL - fallback will handle it
    }
  }

  // Now fetch container details using the working URL (IP URL for nginx, original URL otherwise)
  // For nginx upgrades, we use IP URL directly but need to handle authentication properly
  let containerDetails;
  let workingContainerId = containerId; // Use the ID that works for subsequent operations
  const normalizedId = normalizeContainerId(containerId);

  // Helper function to get container details with proper error handling
  // For nginx upgrades, use original URL first (nginx is still up), then fall back to IP if needed
  const fetchContainerDetails = async (containerIdToTry) => {
    try {
      // For nginx upgrades, try original URL first (nginx is still up at this point)
      // The IP URL will be used automatically via requestWithIpFallback if original fails
      // For non-nginx containers, use normal method
      if (isNginxProxyManager) {
        // Try original URL first - nginx is still up, so this should work
        try {
          return await portainerService.getContainerDetails(
            portainerUrl,
            endpointId,
            containerIdToTry
          );
        } catch (originalError) {
          // If original URL fails (nginx went down), try IP URL directly
          if (
            originalError.code === "ECONNREFUSED" ||
            originalError.code === "ETIMEDOUT" ||
            originalError.code === "ERR_NETWORK" ||
            originalError.message?.includes("getaddrinfo") ||
            !originalError.response
          ) {
            logger.info("Original URL failed, trying IP URL", {
              originalUrl: portainerUrl,
              ipUrl: workingPortainerUrl,
            });
            // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
            const ssrfValidation = validateUrlForSSRF(workingPortainerUrl, true);
            if (!ssrfValidation.valid) {
              throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
            }

            // Validate path components to prevent path traversal attacks
            const endpointValidation = validatePathComponent(endpointId);
            const containerIdValidation = validatePathComponent(containerIdToTry);

            if (!endpointValidation.valid || !containerIdValidation.valid) {
              throw new Error(
                `Invalid path component: ${endpointValidation.error || containerIdValidation.error}`
              );
            }

            // Use proper URL construction instead of string interpolation
            const url = new URL(
              `/api/endpoints/${endpointValidation.sanitized}/docker/containers/${containerIdValidation.sanitized}/json`,
              workingPortainerUrl
            );

            const baseConfig = { headers: portainerService.getAuthHeaders(workingPortainerUrl) };
            const ipConfig = portainerService.getIpFallbackConfig(
              workingPortainerUrl,
              portainerUrl,
              baseConfig
            );
            const response = await axios.get(url.toString(), ipConfig);
            return response.data;
          }
          throw originalError;
        }
      } else {
        // Use normal method for non-nginx containers
        return await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          containerIdToTry
        );
      }
    } catch (error) {
      // If 401, try to authenticate and retry
      if (error.response?.status === 401) {
        try {
          // Get credentials from instance for authentication
          const instances = await getAllPortainerInstances();
          const instance = instances.find((inst) => inst.url === portainerUrl);

          if (instance) {
            const authType = instance.auth_type || "apikey";
            const apiKey = instance.api_key || null;
            const username = instance.username || null;
            const password = instance.password || null;

            // Try authenticating with original URL first (nginx is still up)
            try {
              await portainerService.authenticatePortainer(
                portainerUrl,
                username,
                password,
                apiKey,
                authType,
                false // skipCache
              );
            } catch (originalAuthError) {
              // If original URL fails, try IP URL
              if (
                originalAuthError.code === "ECONNREFUSED" ||
                originalAuthError.code === "ETIMEDOUT" ||
                originalAuthError.code === "ERR_NETWORK" ||
                originalAuthError.message?.includes("getaddrinfo") ||
                !originalAuthError.response
              ) {
                logger.info("Original URL auth failed, trying IP URL", {
                  originalUrl: portainerUrl,
                  ipUrl: workingPortainerUrl,
                });
                await portainerService.authenticatePortainer(
                  workingPortainerUrl,
                  username,
                  password,
                  apiKey,
                  authType,
                  false, // skipCache
                  portainerUrl // originalUrl for Host header
                );

                // Store token for both URLs
                const authHeaders = portainerService.getAuthHeaders(workingPortainerUrl);
                const token =
                  authHeaders["X-API-Key"] || authHeaders["Authorization"]?.replace("Bearer ", "");
                if (token) {
                  portainerService.storeTokenForBothUrls(
                    workingPortainerUrl,
                    portainerUrl,
                    token,
                    authType
                  );
                }
              } else {
                throw originalAuthError;
              }
            }
          } else {
            // Fallback: try authentication without instance data
            try {
              await portainerService.authenticatePortainer(
                portainerUrl,
                null,
                null,
                null,
                "apikey",
                false
              );
            } catch (fallbackError) {
              // If original URL fails, try IP URL
              if (
                fallbackError.code === "ECONNREFUSED" ||
                fallbackError.code === "ETIMEDOUT" ||
                fallbackError.code === "ERR_NETWORK"
              ) {
                await portainerService.authenticatePortainer(
                  workingPortainerUrl,
                  null,
                  null,
                  null,
                  "apikey",
                  false,
                  portainerUrl
                );
              } else {
                throw fallbackError;
              }
            }
          }

          // Retry the request - try original URL first, then IP URL if needed
          if (isNginxProxyManager) {
            try {
              // Try original URL first
              return await portainerService.getContainerDetails(
                portainerUrl,
                endpointId,
                containerIdToTry
              );
            } catch (retryError) {
              // If original URL fails, try IP URL
              if (
                retryError.code === "ECONNREFUSED" ||
                retryError.code === "ETIMEDOUT" ||
                retryError.code === "ERR_NETWORK" ||
                retryError.message?.includes("getaddrinfo") ||
                !retryError.response
              ) {
                // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
                const ssrfValidation = validateUrlForSSRF(workingPortainerUrl, true);
                if (!ssrfValidation.valid) {
                  throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
                }

                // Validate path components to prevent path traversal attacks
                const endpointValidation = validatePathComponent(endpointId);
                const containerIdValidation = validatePathComponent(containerIdToTry);

                if (!endpointValidation.valid || !containerIdValidation.valid) {
                  throw new Error(
                    `Invalid path component: ${endpointValidation.error || containerIdValidation.error}`
                  );
                }

                // Use proper URL construction instead of string interpolation
                const url = new URL(
                  `/api/endpoints/${endpointValidation.sanitized}/docker/containers/${containerIdValidation.sanitized}/json`,
                  workingPortainerUrl
                );

                const baseConfig = {
                  headers: portainerService.getAuthHeaders(workingPortainerUrl),
                };
                const ipConfig = portainerService.getIpFallbackConfig(
                  workingPortainerUrl,
                  portainerUrl,
                  baseConfig
                );
                const response = await axios.get(url.toString(), ipConfig);
                return response.data;
              }
              throw retryError;
            }
          } else {
            return await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              containerIdToTry
            );
          }
        } catch (authError) {
          logger.error("Authentication retry failed", {
            error: authError.message,
            status: authError.response?.status,
          });
          throw error; // Throw original error if auth retry fails
        }
      }
      throw error;
    }
  };

  try {
    // Try with the original ID first
    containerDetails = await fetchContainerDetails(containerId);
  } catch (error) {
    // If 404 and we haven't tried the shortened version, try that
    if (error.response?.status === 404 && normalizedId !== containerId) {
      logger.info("Container not found with full ID, trying shortened version", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        originalId: containerId.substring(0, 12),
        shortenedId: normalizedId,
      });
      try {
        containerDetails = await fetchContainerDetails(normalizedId);
        // Use the normalized ID for subsequent operations
        workingContainerId = normalizedId;
      } catch (shortError) {
        // If still 404, provide a better error message
        if (shortError.response?.status === 404) {
          throw new Error(
            `Container not found. It may have been deleted, stopped, or the container ID is incorrect. ` +
              `Please refresh the container list and try again. Container ID: ${containerId.substring(0, 12)}...`
          );
        }
        throw shortError;
      }
    } else if (error.response?.status === 404) {
      // Already tried shortened version or it's the same, provide helpful error
      throw new Error(
        `Container not found. It may have been deleted, stopped, or the container ID is incorrect. ` +
          `Please refresh the container list and try again. Container ID: ${containerId.substring(0, 12)}...`
      );
    } else {
      // Re-throw other errors
      throw error;
    }
  }

  // Preserve the original container name (important for stacks)
  const originalContainerName = containerDetails.Name;
  const cleanContainerName = originalContainerName.replace(/^\//, "");

  // Check if this container is part of a stack
  const labels = containerDetails.Config.Labels || {};
  const stackName =
    labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

  // Extract current and new image info
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const imageRepo = imageParts[0];
  const currentTag = imageParts[1];

  // Get the image digest from registry for the current tag
  const latestImageInfo = await dockerRegistryService.getLatestImageDigest(imageRepo, currentTag);
  // Use the current tag for upgrades (to get the latest version of that tag)
  const newTag = currentTag;
  const newImageName = `${imageRepo}:${newTag}`;

  logger.info("Starting container upgrade", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    containerId: containerId.substring(0, 12),
    portainerUrl: workingPortainerUrl,
    endpointId: endpointId,
    currentImage: imageName,
    newImage: newImageName,
    usingIpFallback: isNginxProxyManager,
  });

  // CRITICAL: Find and stop dependent containers BEFORE removing the main container
  // Containers using network_mode: service:containerName will break if we remove
  // the main container while they're still running (they reference the old container ID)
  const dependentContainersToStop = [];

  try {
    logger.info("🔍 Checking for containers that depend on this container via network_mode...");
    const allContainers = await portainerService.getContainers(workingPortainerUrl, endpointId);
    for (const container of allContainers) {
      if (container.Id === workingContainerId) {
        continue;
      } // Skip the one we're upgrading

      try {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );

        // Check if this container uses network_mode: service:containerName
        const networkMode = details.HostConfig?.NetworkMode || "";
        if (networkMode && networkMode.startsWith("service:")) {
          const serviceName = networkMode.replace("service:", "");
          if (serviceName === cleanContainerName) {
            const containerStatus =
              details.State?.Status || (details.State?.Running ? "running" : "exited");
            if (containerStatus === "running") {
              dependentContainersToStop.push({
                id: container.Id,
                name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              });
            }
          }
        }
      } catch (err) {
        // Skip containers we can't inspect
        logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
        continue;
      }
    }

    // Stop dependent containers BEFORE removing the main container
    if (dependentContainersToStop.length > 0) {
      logger.info(
        `🛑 Stopping ${dependentContainersToStop.length} dependent container(s) before removing main container...`
      );
      for (const container of dependentContainersToStop) {
        try {
          logger.info(
            `   Stopping ${container.name} (uses network_mode: service:${cleanContainerName})...`
          );
          await portainerService.stopContainer(portainerUrl, endpointId, container.id);
          logger.info(`   ✅ ${container.name} stopped`);
        } catch (err) {
          logger.warn(`   ⚠️  Failed to stop ${container.name}:`, err.message);
          // Continue anyway - we'll try to restart them later
        }
      }
      // Wait a moment for containers to fully stop and release network references
      logger.info("Waiting for dependent containers to fully stop...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (err) {
    logger.warn(
      "Could not check for dependent containers before stopping, proceeding anyway:",
      err.message
    );
  }

  // Stop the container
  logger.info("Stopping container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    containerId: workingContainerId.substring(0, 12),
  });
  await portainerService.stopContainer(portainerUrl, endpointId, workingContainerId);

  // Wait for container to fully stop (important for databases and services)
  // For nginx upgrades, use IP URL directly after stop (nginx is down now)
  const checkStatusUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  logger.debug("Waiting for container to stop", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    usingUrl: checkStatusUrl,
  });
  let stopped = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const details = await portainerService.getContainerDetails(
        checkStatusUrl,
        endpointId,
        workingContainerId
      );
      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running === false ? "exited" : "unknown");
      if (containerStatus === "exited" || containerStatus === "stopped") {
        stopped = true;
        break;
      }
    } catch (err) {
      // Container might be removed already
      if (err.response?.status === 404) {
        stopped = true;
        break;
      }
    }
  }
  if (!stopped) {
    logger.warn("Container did not stop within timeout, proceeding anyway", {
      module: "containerService",
      operation: "upgradeSingleContainer",
      containerName: originalContainerName,
      containerId: containerId.substring(0, 12),
    });
  }

  // Pull the latest image
  // For nginx upgrades, use IP URL directly (nginx is down now)
  // Pass original URL for authentication lookup
  const pullImageUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  const pullImageOriginalUrl = isNginxProxyManager ? portainerUrl : null;
  logger.info("Pulling latest image", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    image: newImageName,
    usingUrl: pullImageUrl,
    originalUrl: pullImageOriginalUrl,
  });
  await portainerService.pullImage(pullImageUrl, endpointId, newImageName, pullImageOriginalUrl);

  // Remove old container
  // For nginx upgrades, use IP URL directly (nginx is down now)
  const removeContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  logger.info("Removing old container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    containerId: workingContainerId.substring(0, 12),
    usingUrl: removeContainerUrl,
  });
  await portainerService.removeContainer(removeContainerUrl, endpointId, workingContainerId);

  // Clean HostConfig - remove container-specific references and invalid fields
  const cleanHostConfig = { ...containerDetails.HostConfig };
  delete cleanHostConfig.ContainerIDFile;
  // Remove fields that shouldn't be in create request
  delete cleanHostConfig.Runtime;
  delete cleanHostConfig.RestartCount;
  delete cleanHostConfig.AutoRemove;

  // CRITICAL: When using network_mode: service:*, Docker doesn't allow PortBindings
  // This matches what Portainer does - filter out conflicting fields
  const networkMode = cleanHostConfig.NetworkMode || "";
  if (networkMode && networkMode.startsWith("service:")) {
    // Remove port bindings - they conflict with service network mode
    // Ports are exposed on the service container (tunnel), not this one
    if (cleanHostConfig.PortBindings) {
      logger.info("Removing PortBindings (conflicts with network_mode: service)", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        containerName: originalContainerName,
        networkMode: networkMode,
      });
      delete cleanHostConfig.PortBindings;
    }
    if (cleanHostConfig.PublishAllPorts !== undefined) {
      delete cleanHostConfig.PublishAllPorts;
    }
  }

  // Ensure RestartPolicy is valid
  if (cleanHostConfig.RestartPolicy && typeof cleanHostConfig.RestartPolicy === "object") {
    // Keep restart policy but ensure it's valid
    if (!cleanHostConfig.RestartPolicy.Name) {
      cleanHostConfig.RestartPolicy = { Name: "no" };
    }
  }

  // Clean NetworkingConfig - Docker API expects specific format
  // BUT: Containers using network_mode: service:* don't have their own network config
  let networkingConfig = undefined;
  const isServiceNetworkMode = networkMode && networkMode.startsWith("service:");

  if (!isServiceNetworkMode && containerDetails.NetworkSettings?.Networks) {
    const networks = containerDetails.NetworkSettings.Networks;
    // Convert network settings to the format Docker API expects
    const endpointsConfig = {};
    for (const [networkName, networkData] of Object.entries(networks)) {
      if (networkData && typeof networkData === "object") {
        endpointsConfig[networkName] = {
          IPAMConfig: networkData.IPAMConfig || undefined,
          Links: networkData.Links || undefined,
          Aliases: networkData.Aliases || undefined,
        };
        // Remove empty objects
        if (!endpointsConfig[networkName].IPAMConfig) {
          delete endpointsConfig[networkName].IPAMConfig;
        }
        if (!endpointsConfig[networkName].Links) {
          delete endpointsConfig[networkName].Links;
        }
        if (!endpointsConfig[networkName].Aliases) {
          delete endpointsConfig[networkName].Aliases;
        }
        // If all fields are empty, remove the network entry
        if (Object.keys(endpointsConfig[networkName]).length === 0) {
          delete endpointsConfig[networkName];
        }
      }
    }
    if (Object.keys(endpointsConfig).length > 0) {
      networkingConfig = { EndpointsConfig: endpointsConfig };
    }
  }
  // If using service network mode, networkingConfig stays undefined (correct behavior)

  // Create new container with same configuration
  logger.info("Creating new container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    image: newImageName,
  });

  // Build container config, only including defined values
  const containerConfig = {
    Image: newImageName,
  };

  // Add optional fields only if they exist and are valid
  if (containerDetails.Config.Cmd) {
    containerConfig.Cmd = containerDetails.Config.Cmd;
  }
  if (containerDetails.Config.Env && Array.isArray(containerDetails.Config.Env)) {
    containerConfig.Env = containerDetails.Config.Env;
  }
  if (
    containerDetails.Config.ExposedPorts &&
    Object.keys(containerDetails.Config.ExposedPorts).length > 0
  ) {
    containerConfig.ExposedPorts = containerDetails.Config.ExposedPorts;
  }
  if (cleanHostConfig && Object.keys(cleanHostConfig).length > 0) {
    containerConfig.HostConfig = cleanHostConfig;
  }
  if (containerDetails.Config.Labels && Object.keys(containerDetails.Config.Labels).length > 0) {
    containerConfig.Labels = containerDetails.Config.Labels;
  }
  if (containerDetails.Config.WorkingDir) {
    containerConfig.WorkingDir = containerDetails.Config.WorkingDir;
  }
  if (containerDetails.Config.Entrypoint) {
    containerConfig.Entrypoint = containerDetails.Config.Entrypoint;
  }
  if (networkingConfig) {
    containerConfig.NetworkingConfig = networkingConfig;
  }

  // Pass container name as separate parameter (Docker API uses it as query param)
  // For nginx upgrades, use IP URL directly (nginx is down now)
  const createContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  let newContainer;
  try {
    newContainer = await portainerService.createContainer(
      createContainerUrl,
      endpointId,
      containerConfig,
      originalContainerName
    );
  } catch (error) {
    // Provide more detailed error information
    if (error.response?.status === 400) {
      const errorMessage =
        error.response?.data?.message || error.message || "Invalid container configuration";
      logger.error("Failed to create container - invalid configuration", {
        module: "containerService",
        operation: "upgradeSingleContainer",
        containerName: originalContainerName,
        error: errorMessage,
        errorDetails: error.response?.data,
      });
      throw new Error(
        `Failed to create container: ${errorMessage}. ` +
          `This may be due to invalid network configuration, port conflicts, or other container settings. ` +
          `Please check the container configuration in Portainer.`
      );
    }
    throw error;
  }

  // Start the new container
  // For nginx upgrades, use IP URL directly (nginx is still down)
  const startContainerUrl = isNginxProxyManager ? workingPortainerUrl : portainerUrl;
  logger.info("Starting new container", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    newContainerId: newContainer.Id.substring(0, 12),
    usingUrl: startContainerUrl,
  });
  await portainerService.startContainer(startContainerUrl, endpointId, newContainer.Id);

  // Wait for container to be healthy/ready (CRITICAL for databases)
  // Initialize wait time variables before using them
  const maxWaitTime = 120000; // 2 minutes max for databases with health checks
  const checkInterval = 2000; // Check every 2 seconds
  const startTime = Date.now();
  let consecutiveRunningChecks = 0;
  const requiredStableChecks = 3; // Container must be running for 3 consecutive checks (6 seconds)
  let isReady = false;

  logger.info("Waiting for container to be ready", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    maxWaitTime: `${maxWaitTime / 1000}s`,
  });

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));

    try {
      const details = await portainerService.getContainerDetails(
        workingPortainerUrl,
        endpointId,
        newContainer.Id
      );

      // Check if container is running
      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running ? "running" : "unknown");
      if (containerStatus !== "running") {
        consecutiveRunningChecks = 0; // Reset counter
        if (containerStatus === "exited") {
          // Container exited - get logs for debugging
          try {
            const logs = await portainerService.getContainerLogs(
              workingPortainerUrl,
              endpointId,
              newContainer.Id,
              50
            );
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(
              `Container exited with code ${exitCode}. Last 50 lines of logs:\n${logs}`
            );
          } catch (logErr) {
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(`Container exited with code ${exitCode}. Could not retrieve logs.`);
          }
        }
        continue; // Still starting up
      }

      // Container is running - increment counter
      consecutiveRunningChecks++;

      // Check health status if health check is configured
      if (details.State?.Health) {
        const healthStatus = details.State.Health.Status;
        if (healthStatus === "healthy") {
          isReady = true;
          logger.info("Container health check passed", {
            module: "containerService",
            operation: "upgradeSingleContainer",
            containerName: originalContainerName,
            waitTime: `${(Date.now() - startTime) / 1000}s`,
          });
          break;
        } else if (healthStatus === "unhealthy") {
          try {
            const logs = await portainerService.getContainerLogs(
              workingPortainerUrl,
              endpointId,
              newContainer.Id,
              50
            );
            throw new Error(`Container health check failed. Last 50 lines of logs:\n${logs}`);
          } catch (logErr) {
            throw new Error("Container health check failed. Could not retrieve logs.");
          }
        }
        // Status is 'starting' or 'none', continue waiting
        // However, if container has been running for a while and health check is still starting,
        // consider it ready (some containers never report healthy but work fine)
        const waitTime = Date.now() - startTime;
        if (waitTime >= 30000 && consecutiveRunningChecks >= 5) {
          // Container has been running for 30+ seconds with 5+ stable checks
          // and health check is still starting - likely a container that doesn't properly report health
          logger.info(
            "Health check still starting but container is running stably, considering ready",
            {
              module: "containerService",
              operation: "upgradeSingleContainer",
              containerName: originalContainerName,
              waitTime: `${waitTime / 1000}s`,
              consecutiveChecks: consecutiveRunningChecks,
            }
          );
          isReady = true;
          break;
        }
        // For health checks, we'll wait up to maxWaitTime
      } else {
        // No health check configured - use stability check instead
        // For databases and services, wait a minimum time for initialization
        const waitTime = Date.now() - startTime;
        const minInitTime = 15000; // Wait at least 15 seconds for initialization (databases need this)

        if (waitTime >= minInitTime && consecutiveRunningChecks >= requiredStableChecks) {
          // Container has been running stably for required checks
          isReady = true;
          logger.info("Container is running and stable", {
            module: "containerService",
            operation: "upgradeSingleContainer",
            containerName: originalContainerName,
            stableTime: `${(consecutiveRunningChecks * checkInterval) / 1000}s`,
            waitTime: `${waitTime / 1000}s`,
          });
          break;
        }

        // If we've waited a reasonable time and container is running, consider it ready
        // This handles containers that start quickly (non-databases)
        if (waitTime >= 5000 && consecutiveRunningChecks >= 2) {
          // Check if this looks like a database container (common database image names)
          const isLikelyDatabase =
            /postgres|mysql|mariadb|redis|mongodb|couchdb|influxdb|elasticsearch/i.test(imageName);
          if (!isLikelyDatabase) {
            // Not a database, and it's been running stably - consider it ready
            isReady = true;
            logger.info("Container is running and stable (non-database service)", {
              module: "containerService",
              operation: "upgradeSingleContainer",
              containerName: originalContainerName,
              waitTime: `${waitTime / 1000}s`,
            });
            break;
          }
          // For databases, continue waiting for minInitTime
        }
      }
    } catch (err) {
      if (err.message.includes("exited") || err.message.includes("health check")) {
        throw err;
      }
      // Continue waiting on other errors
      consecutiveRunningChecks = 0; // Reset on error
    }
  }

  if (!isReady) {
    // Final check - if container is running, consider it ready even if we hit timeout
    try {
      const details = await portainerService.getContainerDetails(
        workingPortainerUrl,
        endpointId,
        newContainer.Id
      );
      // Docker API returns State as an object with Status property
      const containerStatus =
        details.State?.Status || (details.State?.Running ? "running" : "unknown");
      const isRunning = containerStatus === "running" || details.State?.Running === true;
      if (isRunning) {
        logger.warn("Timeout reached but container is running, considering it ready", {
          module: "containerService",
          operation: "upgradeSingleContainer",
          containerName: originalContainerName,
          waitTime: `${maxWaitTime / 1000}s`,
        });
        isReady = true;
      } else {
        // Format state info for error message
        const stateInfo =
          containerStatus || (details.State ? JSON.stringify(details.State) : "unknown");
        throw new Error(
          `Container did not become ready within timeout period (2 minutes). Current state: ${stateInfo}`
        );
      }
    } catch (err) {
      if (err.message.includes("Current state")) {
        throw err;
      }
      // If we can't check, throw the timeout error
      throw new Error(
        "Container did not become ready within timeout period (2 minutes). Container may have failed to start."
      );
    }
  }

  logger.info("Container upgrade completed and container is ready", {
    module: "containerService",
    operation: "upgradeSingleContainer",
    containerName: originalContainerName,
    totalWaitTime: `${(Date.now() - startTime) / 1000}s`,
  });

  // Find and restart dependent containers
  // This handles containers that depend on the upgraded container via:
  // 1. network_mode: service:containerName
  // 2. depends_on relationships (containers in the same stack)
  logger.info(`🔄 Checking for dependent containers...`);
  try {
    const allContainers = await portainerService.getContainers(workingPortainerUrl, endpointId);
    const dependentContainers = [];

    for (const container of allContainers) {
      if (container.Id === newContainer.Id) {
        continue;
      } // Skip the one we just upgraded

      try {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );

        // Check if container is running or stopped (we'll restart stopped ones too if they depend on us)
        const containerStatus =
          details.State?.Status || (details.State?.Running ? "running" : "exited");
        const isRunning = containerStatus === "running";
        const isStopped = containerStatus === "exited" || containerStatus === "stopped";

        // Check if this container depends on the upgraded container
        let dependsOnUpgraded = false;
        let dependencyReason = "";

        // Check 1: network_mode: service:containerName
        const networkMode = details.HostConfig?.NetworkMode || "";
        if (networkMode && networkMode.startsWith("service:")) {
          const serviceName = networkMode.replace("service:", "");
          if (serviceName === cleanContainerName) {
            dependsOnUpgraded = true;
            dependencyReason = "network_mode";
          }
        }

        // Check 2: Same stack (compose project or stack namespace)
        if (!dependsOnUpgraded && stackName) {
          const containerStackName =
            details.Config.Labels?.["com.docker.compose.project"] ||
            details.Config.Labels?.["com.docker.stack.namespace"] ||
            null;
          if (containerStackName === stackName) {
            // If in same stack and was running or stopped, it might depend on us
            // We'll restart it to ensure it reconnects
            if (isRunning || isStopped) {
              dependsOnUpgraded = true;
              dependencyReason = "stack";
            }
          }
        }

        if (dependsOnUpgraded) {
          dependentContainers.push({
            id: container.Id,
            name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
            isRunning,
            isStopped,
            dependencyReason,
          });
        }
      } catch (err) {
        // Skip containers we can't inspect
        logger.debug(`Could not inspect container ${container.Id}: ${err.message}`);
        continue;
      }
    }

    // Restart dependent containers to reconnect to the upgraded service
    if (dependentContainers.length > 0) {
      logger.info(
        `🔄 Found ${dependentContainers.length} dependent container(s) (${dependentContainers.filter((c) => c.isRunning).length} running, ${dependentContainers.filter((c) => c.isStopped).length} stopped)`
      );

      // Wait a bit more for the upgraded container to be fully ready
      // Especially important if it has a health check that dependents rely on
      // Check the new container's health status
      try {
        const newContainerDetails = await portainerService.getContainerDetails(
          workingPortainerUrl,
          endpointId,
          newContainer.Id
        );
        if (newContainerDetails.State?.Health) {
          const healthStatus = newContainerDetails.State.Health.Status;
          if (healthStatus === "starting" || healthStatus === "none") {
            logger.info(
              "Waiting for upgraded container health check to pass before restarting dependents..."
            );
            // Wait up to 30 seconds for health check to pass
            let healthReady = false;
            for (let i = 0; i < 15; i++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              const currentDetails = await portainerService.getContainerDetails(
                workingPortainerUrl,
                endpointId,
                newContainer.Id
              );
              const currentHealth = currentDetails.State?.Health?.Status;
              if (currentHealth === "healthy") {
                healthReady = true;
                logger.info("Upgraded container is now healthy");
                break;
              }
            }
            if (!healthReady) {
              logger.warn(
                "Upgraded container health check not ready, but proceeding with dependent restarts"
              );
            }
          } else if (healthStatus === "healthy") {
            logger.info("Upgraded container is already healthy");
          }
        } else {
          // No health check, wait a brief moment for container to stabilize
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        logger.warn("Could not check upgraded container health, proceeding anyway:", err.message);
        // Wait a brief moment anyway
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Prioritize containers that use network_mode (they were stopped earlier)
      // These need to be RECREATED (not just restarted) to reconnect to the new container
      // Docker caches the container ID internally, so we must recreate them
      const networkModeContainers = dependentContainers.filter(
        (c) => c.dependencyReason === "network_mode"
      );
      const otherContainers = dependentContainers.filter(
        (c) => c.dependencyReason !== "network_mode"
      );

      // Recreate network_mode containers first (they're critical)
      for (const container of networkModeContainers) {
        try {
          logger.info(
            `   Recreating ${container.name} (network_mode: service:${cleanContainerName})...`
          );

          // Get the container details to recreate it
          const containerDetails = await portainerService.getContainerDetails(
            portainerUrl,
            endpointId,
            container.id
          );

          // Remove the old container (it's already stopped)
          try {
            await portainerService.removeContainer(portainerUrl, endpointId, container.id);
            logger.info(`   Removed old ${container.name}`);
          } catch (removeErr) {
            // Container might already be removed, continue anyway
            logger.debug(
              `   Could not remove ${container.name} (may already be removed): ${removeErr.message}`
            );
          }

          // Prepare container configuration for recreation
          const cleanHostConfig = { ...containerDetails.HostConfig };
          // Remove fields that shouldn't be in create request
          delete cleanHostConfig.Runtime;
          delete cleanHostConfig.RestartCount;
          delete cleanHostConfig.AutoRemove;

          // Ensure RestartPolicy is valid
          if (cleanHostConfig.RestartPolicy && typeof cleanHostConfig.RestartPolicy === "string") {
            cleanHostConfig.RestartPolicy = { Name: cleanHostConfig.RestartPolicy };
          }

          // Check if this container uses network_mode: service:*
          const networkMode = cleanHostConfig.NetworkMode || "";
          const usesServiceNetworkMode = networkMode && networkMode.startsWith("service:");

          // If using network_mode: service:*, remove port bindings (conflicts with service network mode)
          if (usesServiceNetworkMode) {
            if (cleanHostConfig.PortBindings) {
              delete cleanHostConfig.PortBindings;
            }
            if (cleanHostConfig.PublishAllPorts !== undefined) {
              delete cleanHostConfig.PublishAllPorts;
            }
          }

          // Prepare networking config
          // Skip NetworkingConfig entirely if using network_mode: service:*
          let networkingConfig = null;
          if (!usesServiceNetworkMode && containerDetails.NetworkSettings?.Networks) {
            const networks = containerDetails.NetworkSettings.Networks;
            networkingConfig = { EndpointsConfig: {} };
            for (const [networkName, networkData] of Object.entries(networks)) {
              networkingConfig.EndpointsConfig[networkName] = {
                IPAMConfig: networkData.IPAMConfig || {},
                Links: networkData.Links || [],
                Aliases: networkData.Aliases || [],
              };
              // Remove empty objects
              if (
                Object.keys(networkingConfig.EndpointsConfig[networkName].IPAMConfig).length === 0
              ) {
                delete networkingConfig.EndpointsConfig[networkName].IPAMConfig;
              }
              if (networkingConfig.EndpointsConfig[networkName].Links.length === 0) {
                delete networkingConfig.EndpointsConfig[networkName].Links;
              }
              if (networkingConfig.EndpointsConfig[networkName].Aliases.length === 0) {
                delete networkingConfig.EndpointsConfig[networkName].Aliases;
              }
              if (Object.keys(networkingConfig.EndpointsConfig[networkName]).length === 0) {
                delete networkingConfig.EndpointsConfig[networkName];
              }
            }
            if (Object.keys(networkingConfig.EndpointsConfig).length === 0) {
              networkingConfig = null;
            }
          }

          // Build container config
          const containerConfig = {
            Image: containerDetails.Config.Image,
            Cmd: containerDetails.Config.Cmd,
            Env: containerDetails.Config.Env,
            ExposedPorts: containerDetails.Config.ExposedPorts,
            HostConfig: cleanHostConfig,
            Labels: containerDetails.Config.Labels,
            WorkingDir: containerDetails.Config.WorkingDir,
          };

          if (containerDetails.Config.Entrypoint) {
            containerConfig.Entrypoint = containerDetails.Config.Entrypoint;
          }
          if (networkingConfig) {
            containerConfig.NetworkingConfig = networkingConfig;
          }

          // Create the new container (it will automatically connect to the new tunnel by name)
          const containerName = containerDetails.Name?.replace("/", "") || container.name;
          const newDependentContainer = await portainerService.createContainer(
            portainerUrl,
            endpointId,
            containerConfig,
            containerName
          );

          // Start the new container
          await portainerService.startContainer(portainerUrl, endpointId, newDependentContainer.Id);
          logger.info(`   ✅ ${container.name} recreated and started successfully`);
        } catch (err) {
          logger.error(`   ⚠️  Failed to recreate ${container.name}:`, err.message);
          // Continue with other containers
        }
      }

      // Then handle other dependent containers (stack-based)
      for (const container of otherContainers) {
        try {
          if (container.isRunning) {
            logger.info(`   Restarting ${container.name} (${container.dependencyReason})...`);
            await portainerService.stopContainer(portainerUrl, endpointId, container.id);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief wait
            await portainerService.startContainer(portainerUrl, endpointId, container.id);
            logger.info(`   ✅ ${container.name} restarted successfully`);
          } else if (container.isStopped) {
            // Container was stopped (possibly because dependency was down)
            // Try to start it now that the dependency is back up
            logger.info(
              `   Starting ${container.name} (was stopped, ${container.dependencyReason})...`
            );
            try {
              await portainerService.startContainer(portainerUrl, endpointId, container.id);
              logger.info(`   ✅ ${container.name} started successfully`);
            } catch (startErr) {
              // If start fails, it might need a full restart
              logger.info(`   Attempting full restart of ${container.name}...`);
              await portainerService
                .stopContainer(workingPortainerUrl, endpointId, container.id)
                .catch(() => {
                  // Ignore if already stopped
                });
              await new Promise((resolve) => setTimeout(resolve, 1000));
              await portainerService.startContainer(portainerUrl, endpointId, container.id);
              logger.info(`   ✅ ${container.name} restarted successfully`);
            }
          }
        } catch (err) {
          logger.error(`   ⚠️  Failed to restart ${container.name}:`, err.message);
          // Continue with other containers
        }
      }
      logger.info(`✅ Dependent container restart process completed`);
    } else {
      logger.info(`ℹ️  No dependent containers found`);
    }
  } catch (err) {
    logger.error("⚠️  Error restarting dependent containers:", err.message);
    // Don't fail the upgrade if dependent restart fails
  }

  // Invalidate cache for this image so next check gets fresh data
  dockerRegistryService.clearDigestCache(imageRepo, currentTag);

  // Update the container cache to mark this container as no longer having an update
  // This ensures the cache persists across app restarts
  try {
    const cached = await getContainerCache("containers");
    if (cached && cached.containers && Array.isArray(cached.containers)) {
      let cacheUpdated = false;
      const updatedContainers = cached.containers.map((cachedContainer) => {
        // Match by containerId (can be full or shortened)
        const matchesId =
          cachedContainer.id === containerId ||
          cachedContainer.id === workingContainerId ||
          cachedContainer.id === newContainer.Id ||
          cachedContainer.id?.substring(0, 12) === containerId.substring(0, 12) ||
          cachedContainer.id?.substring(0, 12) === workingContainerId.substring(0, 12);

        // Also match by name as fallback
        const matchesName = cachedContainer.name === originalContainerName.replace("/", "");

        if (matchesId || matchesName) {
          cacheUpdated = true;
          return { ...cachedContainer, hasUpdate: false };
        }
        return cachedContainer;
      });

      if (cacheUpdated) {
        // Update the cache with the modified container
        const updatedCache = {
          ...cached,
          containers: updatedContainers,
        };
        await setContainerCache("containers", updatedCache);
        logger.info("Updated container cache to mark upgraded container as up-to-date", {
          module: "containerService",
          operation: "upgradeSingleContainer",
          containerName: originalContainerName,
          containerId: containerId.substring(0, 12),
        });
      }
    }
  } catch (cacheError) {
    // Don't fail the upgrade if cache update fails
    logger.warn("Failed to update container cache after upgrade:", cacheError.message);
  }

  logger.info(`✅ Upgrade completed successfully for ${originalContainerName}`);

  return {
    success: true,
    containerId: containerId,
    containerName: originalContainerName.replace("/", ""),
    newContainerId: newContainer.Id,
    oldImage: imageName,
    newImage: newImageName,
  };
}

/**
 * Get all containers with update status from all Portainer instances
 * @returns {Promise<Object>} - Containers grouped by stack
 */
/**
 * Get all containers with update status
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data
 * @returns {Promise<Object>} - Containers with update information
 */
async function getAllContainersWithUpdates(forceRefresh = false, filterPortainerUrl = null) {
  // Get previous cache to compare for newly detected updates
  let previousCache = null;
  if (forceRefresh) {
    previousCache = await getContainerCache("containers");
  }

  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    const cached = await getContainerCache("containers");
    if (cached) {
      // Reduced logging - only log in debug mode
      if (process.env.DEBUG) {
        logger.debug("✅ Using cached container data from database");
      }
      return cached;
    }
    // No cached data found - return empty result instead of fetching from Docker Hub
    // User must explicitly click "Pull" or batch process must run to fetch fresh data
    if (process.env.DEBUG) {
      logger.debug(
        '📦 No cached data found, returning empty result. User must click "Pull" to fetch data.'
      );
    }
    // IMPORTANT: Do NOT call Docker Hub here - only return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  } else {
    // Only when forceRefresh=true (explicit pull request or batch process)
    if (filterPortainerUrl) {
      logger.info(
        `🔄 Force refresh requested for instance ${filterPortainerUrl}, fetching fresh data from Docker Hub...`
      );
    } else {
      logger.info("🔄 Force refresh requested, fetching fresh data from Docker Hub...");
    }
    // Don't clear cache immediately - keep old data visible until new data is ready
    // Cache will be replaced when new data is saved
  }
  const allContainers = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();

  // Filter to specific instance if requested
  const instancesToProcess = filterPortainerUrl
    ? portainerInstances.filter((inst) => inst.url === filterPortainerUrl)
    : portainerInstances;

  if (instancesToProcess.length === 0) {
    // Only log warning, not every time
    if (process.env.DEBUG) {
      logger.debug("⚠️  No Portainer instances to process.");
    }
    // Return empty result and cache it so we don't keep trying to fetch
    const emptyResult = {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
    // Cache empty result to prevent repeated attempts
    try {
      await setContainerCache("containers", emptyResult);
    } catch (error) {
      logger.error("Error caching empty result:", error.message);
    }
    return emptyResult;
  }

  // If filtering by specific instance, get existing cache to merge with
  let existingCache = null;
  if (filterPortainerUrl && previousCache) {
    existingCache = previousCache;
  }

  // Fetch containers from Portainer instances (filtered if specified)
  for (const instance of instancesToProcess) {
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);
    const username = instance.username;
    const password = instance.password;

    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        logger.warn(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      // Use first endpoint for each Portainer instance
      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      const containersWithUpdates = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;

            // Reduced logging - only log in debug mode or for errors
            const updateInfo = await checkImageUpdates(
              imageName,
              details,
              portainerUrl,
              endpointId
            );

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

            // Get image creation date by inspecting the image
            let currentImageCreated = null;
            const imageId = details.Image || "";
            if (imageId) {
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  imageId
                );
                if (imageDetails.Created) {
                  currentImageCreated = imageDetails.Created;
                }
              } catch (imageError) {
                // If we can't get image details, just continue without created date
                logger.debug(`Could not get image details for ${imageId}: ${imageError.message}`);
              }
            }

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: updateInfo.hasUpdate,
              currentTag: updateInfo.currentTag,
              currentVersion: updateInfo.currentVersion,
              currentDigest: updateInfo.currentDigest,
              latestTag: updateInfo.latestTag,
              newVersion: updateInfo.newVersion,
              latestDigest: updateInfo.latestDigest,
              currentDigestFull: updateInfo.currentDigestFull,
              latestDigestFull: updateInfo.latestDigestFull,
              latestPublishDate: updateInfo.latestPublishDate,
              currentVersionPublishDate: updateInfo.currentVersionPublishDate,
              currentImageCreated: currentImageCreated,
              imageRepo: updateInfo.imageRepo,
              stackName: stackName,
              existsInDockerHub: updateInfo.existsInDockerHub || false,
            };
          } catch (error) {
            // If rate limit exceeded, propagate the error to stop the entire process
            if (error.isRateLimitExceeded) {
              throw error;
            }
            // If a single container fails, log it but don't break the entire process
            if (process.env.DEBUG) {
              logger.error(
                `   ❌ Error checking updates for container ${container.Names[0]?.replace("/", "") || container.Id.substring(0, 12)}:`,
                error.message
              );
            }
            // Return a basic container object without update info
            // Try to check if image exists in Docker Hub even if update check failed
            let existsInDockerHub = false;
            try {
              const imageName = container.Image || "unknown";
              const imageParts = imageName.includes(":")
                ? imageName.split(":")
                : [imageName, "latest"];
              const repo = imageParts[0];
              existsInDockerHub = await dockerRegistryService.checkImageExistsInDockerHub(repo);
            } catch (error) {
              // Silently continue - assume false if check fails
              existsInDockerHub = false;
            }

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: container.Image || "unknown",
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false,
              currentTag: null,
              currentVersion: null,
              currentDigest: null,
              latestTag: null,
              newVersion: null,
              latestDigest: null,
              currentDigestFull: null,
              latestDigestFull: null,
              latestPublishDate: null,
              imageRepo: null,
              stackName: null,
              existsInDockerHub: existsInDockerHub,
            };
          }
        })
      );

      allContainers.push(...containersWithUpdates);
    } catch (error) {
      // If rate limit exceeded, propagate the error immediately
      if (error.isRateLimitExceeded) {
        throw error;
      }
      logger.error(`Error fetching containers from ${portainerUrl}:`, error.message);
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

  // If filtering by specific instance, merge with existing cache
  if (filterPortainerUrl && existingCache) {
    // Remove containers from the filtered instance from existing cache
    const otherContainers = existingCache.containers.filter(
      (c) => c.portainerUrl !== filterPortainerUrl
    );
    // Combine with new containers from the filtered instance
    allContainers.push(...otherContainers);

    // Re-group containers by stack
    const mergedGroupedByStack = allContainers.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    // Convert to array format with stack names
    const mergedGroupedContainers = Object.keys(mergedGroupedByStack).map((stackName) => ({
      stackName: stackName,
      containers: mergedGroupedByStack[stackName],
    }));

    // Sort stacks: named stacks first, then "Standalone"
    mergedGroupedContainers.sort((a, b) => {
      if (a.stackName === "Standalone") {
        return 1;
      }
      if (b.stackName === "Standalone") {
        return -1;
      }
      return a.stackName.localeCompare(b.stackName);
    });

    // Update groupedContainers with merged data
    groupedContainers.length = 0;
    groupedContainers.push(...mergedGroupedContainers);

    // Use existing unused images count (or recalculate if needed)
    unusedImagesCount = existingCache.unusedImagesCount || 0;
  } else {
    // Get unused images count for all instances
    unusedImagesCount = 0;
    for (const instance of portainerInstances) {
      const portainerUrl = instance.url || instance;
      const username = instance.username;
      const password = instance.password;
      const apiKey = instance.api_key;
      const authType = instance.auth_type || "apikey";

      try {
        await portainerService.authenticatePortainer(
          portainerUrl,
          username,
          password,
          apiKey,
          authType
        );
        const endpoints = await portainerService.getEndpoints(portainerUrl);
        if (endpoints.length === 0) {
          continue;
        }

        const endpointId = endpoints[0].Id;
        const images = await portainerService.getImages(portainerUrl, endpointId);
        const containers = await portainerService.getContainers(portainerUrl, endpointId);

        // Get all used image IDs (normalize to handle both full and shortened IDs)
        const usedIds = new Set();
        const normalizeImageId = (id) => {
          const cleanId = id.replace(/^sha256:/, "");
          return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
        };

        for (const container of containers) {
          const details = await portainerService.getContainerDetails(
            portainerUrl,
            endpointId,
            container.Id
          );
          if (details.Image) {
            usedIds.add(details.Image);
            usedIds.add(normalizeImageId(details.Image));
          }
        }

        // Count unused images
        for (const image of images) {
          const imageIdNormalized = normalizeImageId(image.Id);
          const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);
          if (!isUsed) {
            unusedImagesCount++;
          }
        }
      } catch (error) {
        logger.error(`Error counting unused images from ${portainerUrl}:`, error.message);
      }
    }
  }

  // Build portainerInstances array for frontend
  const portainerInstancesArray = portainerInstances.map((instance) => {
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);

    // Get containers for this instance
    const instanceContainers = allContainers.filter((c) => c.portainerUrl === portainerUrl);
    const withUpdates = instanceContainers.filter((c) => c.hasUpdate);
    const upToDate = instanceContainers.filter((c) => !c.hasUpdate);

    return {
      id: instance.id,
      name: instanceName,
      url: portainerUrl,
      containers: instanceContainers,
      withUpdates: withUpdates,
      upToDate: upToDate,
      totalContainers: instanceContainers.length,
    };
  });

  const result = {
    grouped: true,
    stacks: groupedContainers,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  // Save to cache for future requests
  // This replaces the old cache with fresh data (or merges if filtering by instance)
  try {
    await setContainerCache("containers", result);
    if (filterPortainerUrl) {
      logger.info(
        `💾 Container data cached in database (merged data for instance ${filterPortainerUrl})`
      );
    } else {
      logger.info("💾 Container data cached in database (replaced old cache)");
    }
  } catch (error) {
    logger.error("Error saving container cache:", error.message);
    // Continue even if cache save fails
  }

  // Send Discord notifications for newly detected container updates
  if (previousCache && previousCache.containers) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        // Create a map of previous containers by unique identifier
        // Use combination of name, portainerUrl, and endpointId for uniqueness
        // (Name is more stable than ID, which changes after upgrades)
        const previousContainersMap = new Map();
        previousCache.containers.forEach((container) => {
          // Use name as primary key since container IDs change after upgrades
          const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
          previousContainersMap.set(key, container);
        });

        // Check each new container for newly detected updates
        for (const container of allContainers) {
          if (container.hasUpdate) {
            // Match by name (more stable than ID which changes after upgrades)
            const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
            const previousContainer = previousContainersMap.get(key);

            // Only notify if this is a newly detected update (didn't have update before)
            // Match by name instead of ID since container IDs change after upgrades.
            // This is the key fix: by matching by name, we can track the same container across upgrades,
            // preventing false notifications when the container ID changes but name stays the same.
            //
            // Key fix: If previous container (matched by name) had hasUpdate: false, we skip notification
            // even if new one shows hasUpdate: true. This prevents false notifications after upgrades
            // when the cache shows hasUpdate: false but a fresh fetch shows hasUpdate: true again.
            //
            // We notify if:
            // 1. No previous container exists (truly new container)
            //
            // We do NOT notify if:
            // - Previous container had hasUpdate: false (was up-to-date or just upgraded - prevents false notifications)
            // - Previous container had hasUpdate: true (already had update - don't notify again)
            //
            // Note: This means we won't notify for containers that were truly up-to-date and now have a new update,
            // but that's acceptable to prevent false notifications after upgrades.
            const shouldNotify = !previousContainer;

            if (shouldNotify) {
              // Format container data for notification
              const imageName = container.image || "Unknown";
              const currentVersion = container.currentVersion || container.currentTag || "Unknown";
              const latestVersion =
                container.newVersion || container.latestTag || container.latestVersion || "Unknown";

              await discord.queueNotification({
                id: container.id,
                name: container.name,
                imageName: imageName,
                githubRepo: null,
                sourceType: "docker",
                currentVersion: currentVersion,
                latestVersion: latestVersion,
                latestVersionPublishDate: container.latestPublishDate || null,
                releaseUrl: null, // Containers don't have release URLs
                notificationType: "portainer-container",
              });
            }
          }
        }
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notifications for container updates:", error);
    }
  }

  return result;
}

/**
 * Get containers from Portainer without Docker Hub update checks
 * This allows viewing current containers and unused images without Docker Hub data
 * @returns {Promise<Object>} - Containers with basic information (no update status)
 */
async function getContainersFromPortainer() {
  logger.info("⏳ Fetching containers from Portainer");
  const allContainers = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();

  if (portainerInstances.length === 0) {
    logger.warn("⚠️  No Portainer instances configured.");
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Fetch containers from all Portainer instances
  for (const instance of portainerInstances) {
    const portainerUrl = instance.url;
    const instanceName = instance.name || new URL(portainerUrl).hostname;
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || "password";

    try {
      await portainerService.authenticatePortainer(
        portainerUrl,
        username,
        password,
        apiKey,
        authType
      );
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        logger.warn(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      const containersBasic = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;

            // Extract image digest from Image field (format: sha256:...)
            const imageId = details.Image || "";
            const currentDigest = imageId.startsWith("sha256:")
              ? imageId.split(":")[1].substring(0, 12)
              : imageId.substring(0, 12);

            // Extract tag from image name
            const imageParts = imageName.includes(":")
              ? imageName.split(":")
              : [imageName, "latest"];
            const repo = imageParts[0];
            const currentTag = imageParts[1];

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

            // Get image creation date by inspecting the image
            let currentImageCreated = null;
            if (imageId) {
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  imageId
                );
                if (imageDetails.Created) {
                  currentImageCreated = imageDetails.Created;
                }
              } catch (imageError) {
                // If we can't get image details, just continue without created date
                logger.debug(`Could not get image details for ${imageId}: ${imageError.message}`);
              }
            }

            // In portainerOnly mode, we don't check Docker Hub, so existsInDockerHub is unknown
            // It will be determined when Docker Hub data is pulled
            const existsInDockerHub = false;

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false, // No Docker Hub check
              currentDigest: currentDigest,
              currentTag: currentTag,
              currentVersion: currentTag,
              latestDigest: null,
              latestTag: null,
              latestVersion: null,
              currentVersionPublishDate: null,
              currentImageCreated: currentImageCreated,
              stackName: stackName,
              imageId: details.Image,
              existsInDockerHub: existsInDockerHub,
            };
          } catch (error) {
            logger.error(`Error processing container ${container.Id}:`, error.message);
            return null;
          }
        })
      );

      // Filter out null results
      const validContainers = containersBasic.filter((c) => c !== null);
      allContainers.push(...validContainers);
    } catch (error) {
      logger.error(`Error fetching containers from ${portainerUrl}:`, error.message);
    }
  }

  // Group containers by stack
  const stacksMap = new Map();
  const unstackedContainers = [];

  for (const container of allContainers) {
    if (container.stackName) {
      if (!stacksMap.has(container.stackName)) {
        stacksMap.set(container.stackName, []);
      }
      stacksMap.get(container.stackName).push(container);
    } else {
      unstackedContainers.push(container);
    }
  }

  const stacks = Array.from(stacksMap.entries()).map(([name, containers]) => ({
    name,
    containers,
  }));

  if (unstackedContainers.length > 0) {
    stacks.push({
      name: "Unstacked",
      containers: unstackedContainers,
    });
  }

  // Get unused images count
  const unusedImages = await getUnusedImages();
  const unusedImagesCount = unusedImages.length;

  // Group containers by Portainer instance
  const portainerInstancesArray = portainerInstances.map((instance) => {
    const instanceContainers = allContainers.filter((c) => c.portainerUrl === instance.url);
    return {
      name: instance.name || new URL(instance.url).hostname,
      url: instance.url,
      id: instance.id,
      containers: instanceContainers,
      withUpdates: [], // No Docker Hub data
      upToDate: instanceContainers, // All are "up to date" since we don't check
    };
  });

  const result = {
    grouped: true,
    stacks: stacks,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  return result;
}

/**
 * Get unused images from all Portainer instances
 * @returns {Promise<Array>} - Array of unused images
 */
async function getUnusedImages() {
  const unusedImages = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();

  if (portainerInstances.length === 0) {
    return [];
  }

  for (const instance of portainerInstances) {
    const portainerUrl = instance.url;
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || "apikey";

    try {
      await portainerService.authenticatePortainer(
        portainerUrl,
        username,
        password,
        apiKey,
        authType
      );
      const endpoints = await portainerService.getEndpoints(portainerUrl);
      if (endpoints.length === 0) {
        continue;
      }

      const endpointId = endpoints[0].Id;
      const images = await portainerService.getImages(portainerUrl, endpointId);
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Get all used image IDs
      const usedIds = new Set();
      const normalizeImageId = (id) => {
        const cleanId = id.replace(/^sha256:/, "");
        return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
      };

      for (const container of containers) {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );
        if (details.Image) {
          usedIds.add(details.Image);
          usedIds.add(normalizeImageId(details.Image));
        }
      }

      // Find unused images
      for (const image of images) {
        const imageIdNormalized = normalizeImageId(image.Id);
        const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);

        if (!isUsed) {
          let repoTags = image.RepoTags;

          // If RepoTags is null or empty, try to get from RepoDigests
          if (
            !repoTags ||
            repoTags.length === 0 ||
            (repoTags.length === 1 && repoTags[0] === "<none>:<none>")
          ) {
            if (image.RepoDigests && image.RepoDigests.length > 0) {
              repoTags = image.RepoDigests.map((digest) => {
                const repoPart = digest.split("@sha256:")[0];
                return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
              });
            } else {
              // Try to inspect the image to get more details
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  image.Id
                );
                if (imageDetails.RepoTags && imageDetails.RepoTags.length > 0) {
                  repoTags = imageDetails.RepoTags;
                } else if (imageDetails.RepoDigests && imageDetails.RepoDigests.length > 0) {
                  repoTags = imageDetails.RepoDigests.map((digest) => {
                    const repoPart = digest.split("@sha256:")[0];
                    return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                  });
                }
              } catch (err) {
                logger.debug(`Could not inspect image ${image.Id}: ${err.message}`);
              }
            }
          }

          // Fallback to default if still no tags
          if (!repoTags || repoTags.length === 0) {
            repoTags = ["<none>:<none>"];
          }

          const instanceName = instance.name || new URL(portainerUrl).hostname;
          unusedImages.push({
            id: image.Id,
            repoTags: repoTags,
            size: image.Size,
            created: image.Created,
            portainerUrl: portainerUrl,
            endpointId: endpointId,
            portainerName: instanceName,
          });
        }
      }
    } catch (error) {
      logger.error(`Error fetching unused images from ${portainerUrl}:`, error.message);
    }
  }

  return unusedImages;
}

module.exports = {
  checkImageUpdates,
  upgradeSingleContainer,
  getAllContainersWithUpdates,
  getContainersFromPortainer,
  getUnusedImages,
};
