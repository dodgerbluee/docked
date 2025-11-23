/**
 * Container Details Service
 * 
 * Handles fetching container details with proper error handling, authentication retry,
 * and nginx proxy manager IP fallback support.
 * Extracted from containerUpgradeService to improve modularity.
 */

const axios = require("axios");
const { URL } = require("url");
const portainerService = require("../portainerService");
const { getAllPortainerInstances } = require("../../db/index");
const logger = require("../../utils/logger");
const { validateUrlForSSRF, validatePathComponent } = require("../../utils/validation");
const nginxProxyManagerService = require("./nginxProxyManagerService");

/**
 * Normalize container ID - Docker API accepts both full and shortened IDs
 * @param {string} id - Container ID
 * @returns {string} - Normalized container ID (shortened if full 64-char hash)
 */
function normalizeContainerId(id) {
  // If it's a full 64-character hash, try both full and shortened
  if (id && id.length === 64) {
    return id.substring(0, 12);
  }
  return id;
}

/**
 * Fetch container details with proper error handling and retry logic
 * Handles nginx proxy manager IP fallback, authentication retry, and ID normalization
 * @param {string} portainerUrl - Original Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string|number} endpointId - Docker endpoint ID
 * @param {string} containerId - Container ID (full or shortened)
 * @param {boolean} isNginxProxyManager - Whether this is nginx-proxy-manager container
 * @returns {Promise<Object>} - Container details from Docker API
 * @throws {Error} If container not found or other error occurs
 */
async function fetchContainerDetails(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  containerId,
  isNginxProxyManager
) {
  const fetchWithRetry = async (containerIdToTry) => {
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
    return await fetchWithRetry(containerId);
  } catch (error) {
    // If 404 and we haven't tried the shortened version, try that
    const normalizedId = normalizeContainerId(containerId);
    if (error.response?.status === 404 && normalizedId !== containerId) {
      logger.info("Container not found with full ID, trying shortened version", {
        module: "containerUpgradeService",
        operation: "fetchContainerDetails",
        originalId: containerId.substring(0, 12),
        shortenedId: normalizedId,
      });
      try {
        return await fetchWithRetry(normalizedId);
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
}

module.exports = {
  normalizeContainerId,
  fetchContainerDetails,
};

