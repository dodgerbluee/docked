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
 * Check if error is connection-related
 * @param {Error} error - Error object
 * @returns {boolean} - True if connection error
 */
function isConnectionError(error) {
  return (
    error.code === "ECONNREFUSED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ERR_NETWORK" ||
    error.message?.includes("getaddrinfo") ||
    !error.response
  );
}

/**
 * Make direct IP request for nginx containers
 * @param {string} workingPortainerUrl - Working Portainer URL (IP)
 * @param {string} portainerUrl - Original Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerIdToTry - Container ID to try
 * @returns {Promise<Object>} - Container details
 */
async function makeDirectIpRequest(
  workingPortainerUrl,
  portainerUrl,
  endpointId,
  containerIdToTry
) {
  const ssrfValidation = validateUrlForSSRF(workingPortainerUrl, true);
  if (!ssrfValidation.valid) {
    throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
  }

  const endpointValidation = validatePathComponent(endpointId);
  const containerIdValidation = validatePathComponent(containerIdToTry);

  if (!endpointValidation.valid || !containerIdValidation.valid) {
    throw new Error(
      `Invalid path component: ${endpointValidation.error || containerIdValidation.error}`
    );
  }

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

/**
 * Try fetching with original URL first, then IP URL
 * @param {string} portainerUrl - Original Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerIdToTry - Container ID
 * @param {boolean} isNginxProxyManager - Whether nginx container
 * @returns {Promise<Object>} - Container details
 */
async function tryFetchWithFallback(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  containerIdToTry,
  isNginxProxyManager
) {
  if (isNginxProxyManager) {
    try {
      return portainerService.getContainerDetails(portainerUrl, endpointId, containerIdToTry);
    } catch (originalError) {
      if (isConnectionError(originalError)) {
        logger.info("Original URL failed, trying IP URL", {
          originalUrl: portainerUrl,
          ipUrl: workingPortainerUrl,
        });
        return makeDirectIpRequest(workingPortainerUrl, portainerUrl, endpointId, containerIdToTry);
      }
      throw originalError;
    }
  }
  return portainerService.getContainerDetails(portainerUrl, endpointId, containerIdToTry);
}

/**
 * Authenticate with instance credentials
 * @param {Object} instance - Portainer instance
 * @param {string} portainerUrl - Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @returns {Promise<void>}
 */
async function authenticateWithInstance(instance, portainerUrl, workingPortainerUrl) {
  const authType = instance.auth_type || "apikey";
  const apiKey = instance.api_key || null;
  const username = instance.username || null;
  const password = instance.password || null;

  try {
    await portainerService.authenticatePortainer({
      portainerUrl,
      username,
      password,
      apiKey,
      authType,
      skipCache: false,
    });
  } catch (originalAuthError) {
    if (isConnectionError(originalAuthError)) {
      logger.info("Original URL auth failed, trying IP URL", {
        originalUrl: portainerUrl,
        ipUrl: workingPortainerUrl,
      });
      await portainerService.authenticatePortainer({
        portainerUrl: workingPortainerUrl,
        username,
        password,
        apiKey,
        authType,
        skipCache: false,
        originalUrl: portainerUrl,
      });

      const authHeaders = portainerService.getAuthHeaders(workingPortainerUrl);
      const token = authHeaders["X-API-Key"] || authHeaders.Authorization?.replace("Bearer ", "");
      if (token) {
        portainerService.storeTokenForBothUrls(workingPortainerUrl, portainerUrl, token, authType);
      }
    } else {
      throw originalAuthError;
    }
  }
}

/**
 * Retry fetch after authentication
 * @param {string} portainerUrl - Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerIdToTry - Container ID
 * @param {boolean} isNginxProxyManager - Whether nginx container
 * @returns {Promise<Object>} - Container details
 */
async function retryFetchAfterAuth(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  containerIdToTry,
  isNginxProxyManager
) {
  if (isNginxProxyManager) {
    try {
      return portainerService.getContainerDetails(portainerUrl, endpointId, containerIdToTry);
    } catch (retryError) {
      if (isConnectionError(retryError)) {
        return makeDirectIpRequest(workingPortainerUrl, portainerUrl, endpointId, containerIdToTry);
      }
      throw retryError;
    }
  }
  return portainerService.getContainerDetails(portainerUrl, endpointId, containerIdToTry);
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
// eslint-disable-next-line max-lines-per-function -- Container details fetching requires comprehensive error handling
async function fetchContainerDetails(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  containerId,
  isNginxProxyManager
) {
  // eslint-disable-next-line max-lines-per-function -- Container fetching with retry requires comprehensive error handling
  const fetchWithRetry = async (containerIdToTry) => {
    try {
      return tryFetchWithFallback(
        portainerUrl,
        workingPortainerUrl,
        endpointId,
        containerIdToTry,
        isNginxProxyManager
      );
    } catch (error) {
      if (error.response?.status === 401) {
        try {
          const instances = await getAllPortainerInstances();
          const instance = instances.find((inst) => inst.url === portainerUrl);

          if (instance) {
            await authenticateWithInstance(instance, portainerUrl, workingPortainerUrl);
          } else {
            try {
              await portainerService.authenticatePortainer({
                portainerUrl,
                username: null,
                password: null,
                apiKey: null,
                authType: "apikey",
                skipCache: false,
              });
            } catch (fallbackError) {
              if (!isConnectionError(fallbackError)) {
                throw fallbackError;
              }
              await portainerService.authenticatePortainer({
                portainerUrl: workingPortainerUrl,
                username: null,
                password: null,
                apiKey: null,
                authType: "apikey",
                skipCache: false,
                originalUrl: portainerUrl,
              });
            }
          }

          return retryFetchAfterAuth(
            portainerUrl,
            workingPortainerUrl,
            endpointId,
            containerIdToTry,
            isNginxProxyManager
          );
        } catch (authError) {
          logger.error("Authentication retry failed", {
            error: authError.message,
            status: authError.response?.status,
          });
          throw error;
        }
      }
      throw error;
    }
  };

  try {
    // Try with the original ID first
    const details = await fetchWithRetry(containerId);
    return { containerDetails: details, workingContainerId: containerId };
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
        const details = await fetchWithRetry(normalizedId);
        return { containerDetails: details, workingContainerId: normalizedId };
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

/**
 * Get container details with normalization
 * Wrapper function that returns both container details and the working container ID
 * This is a convenience wrapper around fetchContainerDetails that maintains the expected API
 * @param {string} portainerUrl - Original Portainer URL
 * @param {string} workingPortainerUrl - Working Portainer URL (IP URL for nginx, original otherwise)
 * @param {string|number} endpointId - Docker endpoint ID
 * @param {string} containerId - Container ID (full or shortened)
 * @param {boolean} isNginxProxyManager - Whether this is nginx-proxy-manager container
 * @returns {Promise<Object>} - Object with containerDetails and workingContainerId
 * @throws {Error} If container not found or other error occurs
 */
async function getContainerDetailsWithNormalization(
  portainerUrl,
  workingPortainerUrl,
  endpointId,
  containerId,
  isNginxProxyManager
) {
  // fetchContainerDetails now returns both containerDetails and workingContainerId
  return fetchContainerDetails(
    portainerUrl,
    workingPortainerUrl,
    endpointId,
    containerId,
    isNginxProxyManager
  );
}

module.exports = {
  normalizeContainerId,
  fetchContainerDetails,
  getContainerDetailsWithNormalization,
};
