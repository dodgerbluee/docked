/**
 * Portainer API Service
 * Handles all interactions with Portainer instances
 *
 * @module services/portainerService
 * @typedef {Object} PortainerInstance
 * @property {number} id - Instance ID
 * @property {number} user_id - User ID
 * @property {string} name - Instance name
 * @property {string} url - Portainer URL
 * @property {string} [username] - Username for password auth
 * @property {string} [password] - Password for password auth
 * @property {string} [api_key] - API key for API key auth
 * @property {string} auth_type - Authentication type ('apikey' or 'password')
 */

const axios = require("axios");
const { URL } = require("url");
const logger = require("../utils/logger");
const { validatePathComponent } = require("../utils/validation");
const authService = require("./portainer/authService");
const ipFallbackService = require("./portainer/ipFallbackService");

// Re-export auth and IP fallback functions for backward compatibility
const clearAuthToken = authService.clearAuthToken;
const storeTokenForBothUrls = authService.storeTokenForBothUrls;
const authenticatePortainer = authService.authenticatePortainer;
const getAuthHeaders = authService.getAuthHeaders;
const getIpFallbackConfig = ipFallbackService.getIpFallbackConfig;
const createAxiosConfig = ipFallbackService.createAxiosConfig;
const requestWithIpFallback = ipFallbackService.requestWithIpFallback;

/**
 * Get all endpoints (Docker environments) for a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @returns {Promise<Array>} - Array of endpoints
 */
async function getEndpoints(portainerUrl) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = {
        headers: getAuthHeaders(url), // Use url parameter (may be IP URL)
      };
      // Merge IP fallback config if using IP address
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(`${url}/api/endpoints`, ipConfig);
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getEndpoints(portainerUrl);
    }
    throw error;
  }
}

/**
 * Get all containers for an endpoint
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Array>} - Array of containers
 */
async function getContainers(portainerUrl, endpointId) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(
        `${url}/api/endpoints/${endpointId}/docker/containers/json?all=true`,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getContainers(portainerUrl, endpointId);
    }
    throw error;
  }
}

/**
 * Get container details including image info
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<Object>} - Container details
 */
async function getContainerDetails(portainerUrl, endpointId, containerId) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(
        `${url}/api/endpoints/${endpointId}/docker/containers/${containerId}/json`,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getContainerDetails(portainerUrl, endpointId, containerId);
    }
    throw error;
  }
}

/**
 * Get all images from an endpoint
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Array>} - Array of images
 */
async function getImages(portainerUrl, endpointId) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(
        `${url}/api/endpoints/${endpointId}/docker/images/json?all=true`,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getImages(portainerUrl, endpointId);
    }
    throw error;
  }
}

/**
 * Get image details
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageId - Image ID
 * @returns {Promise<Object>} - Image details
 */
async function getImageDetails(portainerUrl, endpointId, imageId) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(
        `${url}/api/endpoints/${endpointId}/docker/images/${imageId}/json`,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getImageDetails(portainerUrl, endpointId, imageId);
    }
    throw error;
  }
}

/**
 * Delete an image
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageId - Image ID
 * @param {boolean} force - Force deletion
 * @returns {Promise<Object>} - Deletion result
 */
async function deleteImage(portainerUrl, endpointId, imageId, force = false) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const apiUrl = `${url}/api/endpoints/${endpointId}/docker/images/${imageId}${
        force ? "?force=true" : ""
      }`;
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.delete(apiUrl, ipConfig);
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return deleteImage(portainerUrl, endpointId, imageId, force);
    }
    throw error;
  }
}

/**
 * Pull new image
 * @param {string} portainerUrl - Portainer instance URL (can be IP URL for nginx upgrades)
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageName - Image name (repo:tag)
 * @param {string} originalUrl - Original URL with domain (for authentication when using IP URL)
 * @returns {Promise<Object>} - Pull result
 */
async function pullImage(portainerUrl, endpointId, imageName, originalUrl = null) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = {
        headers: getAuthHeaders(url),
        params: {
          fromImage: imageName.split(":")[0],
          tag: imageName.includes(":") ? imageName.split(":")[1] : "latest",
        },
      };
      // Use originalUrl for Host header if provided, otherwise use portainerUrl
      const urlForHostHeader = originalUrl || portainerUrl;
      const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
      return await axios.post(
        `${url}/api/endpoints/${endpointId}/docker/images/create`,
        null,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      // Pass originalUrl for authentication so it can fetch credentials from database
      await authenticatePortainer(
        portainerUrl,
        null,
        null,
        null,
        "apikey",
        false,
        originalUrl || portainerUrl
      );
      return pullImage(portainerUrl, endpointId, imageName, originalUrl);
    }
    throw error;
  }
}

/**
 * Stop container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
async function stopContainer(portainerUrl, endpointId, containerId) {
  try {
    await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.post(
        `${url}/api/endpoints/${endpointId}/docker/containers/${containerId}/stop`,
        null,
        ipConfig
      );
    }, portainerUrl);
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return stopContainer(portainerUrl, endpointId, containerId);
    }
    // Handle connection errors (socket hang up, ECONNRESET) - nginx might have gone down
    // Retry with IP fallback if available
    if (
      error.code === "ECONNRESET" ||
      error.code === "ECONNREFUSED" ||
      error.message === "socket hang up"
    ) {
      logger.warn(
        "Connection error during stopContainer, container may have stopped or nginx went down",
        {
          module: "portainerService",
          operation: "stopContainer",
          containerId: containerId.substring(0, 12),
          error: error.message,
          code: error.code,
        }
      );
      // Try to verify if container is actually stopped
      try {
        const details = await getContainerDetails(portainerUrl, endpointId, containerId);
        const status = details.State?.Status || (details.State?.Running ? "running" : "exited");
        if (status === "exited" || status === "stopped") {
          logger.debug("Container is stopped despite connection error", {
            module: "portainerService",
            operation: "stopContainer",
            containerId: containerId.substring(0, 12),
          });
          return; // Container is stopped, which is what we wanted
        }
      } catch (checkErr) {
        // If we can't verify, assume the stop command succeeded before the connection dropped
        logger.warn(
          "Could not verify container state after connection error, assuming stop succeeded",
          {
            module: "portainerService",
            operation: "stopContainer",
            containerId: containerId.substring(0, 12),
          }
        );
        return; // Assume stop succeeded
      }
    }
    // Handle "already stopped" scenarios gracefully
    // 304 = Not Modified (container already in desired state)
    // 304 can occur when container is already stopped
    if (error.response?.status === 304) {
      logger.debug("Container already stopped (304 Not Modified)", {
        module: "portainerService",
        operation: "stopContainer",
        containerId: containerId.substring(0, 12),
      });
      return; // Container is already stopped, which is fine
    }
    // 409 = Conflict (container might already be stopped or in transition)
    if (error.response?.status === 409) {
      // Check if container is actually stopped
      try {
        const details = await getContainerDetails(portainerUrl, endpointId, containerId);
        const status = details.State?.Status || (details.State?.Running ? "running" : "exited");
        if (status === "exited" || status === "stopped") {
          logger.debug("Container already stopped (409 Conflict, but verified stopped)", {
            module: "portainerService",
            operation: "stopContainer",
            containerId: containerId.substring(0, 12),
          });
          return; // Container is already stopped, which is fine
        }
      } catch (checkErr) {
        // If we can't verify, log and continue anyway
        logger.warn("Could not verify container state after 409, assuming stopped", {
          module: "portainerService",
          operation: "stopContainer",
          containerId: containerId.substring(0, 12),
        });
        return;
      }
    }
    throw error;
  }
}

/**
 * Remove container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
async function removeContainer(portainerUrl, endpointId, containerId) {
  try {
    await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.delete(
        `${url}/api/endpoints/${endpointId}/docker/containers/${containerId}`,
        ipConfig
      );
    }, portainerUrl);
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return removeContainer(portainerUrl, endpointId, containerId);
    }
    // Handle "already removed" scenarios gracefully
    // 404 = Not Found (container already removed)
    if (error.response?.status === 404) {
      logger.debug("Container already removed (404 Not Found)", {
        module: "portainerService",
        operation: "removeContainer",
        containerId: containerId.substring(0, 12),
      });
      return; // Container is already removed, which is fine
    }
    // 304 = Not Modified (container already in desired state)
    if (error.response?.status === 304) {
      logger.debug("Container already removed (304 Not Modified)", {
        module: "portainerService",
        operation: "removeContainer",
        containerId: containerId.substring(0, 12),
      });
      return; // Container is already removed, which is fine
    }
    throw error;
  }
}

/**
 * Create container from image (recreate with same config)
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {Object} containerConfig - Container configuration
 * @param {string} containerName - Container name
 * @returns {Promise<Object>} - Created container info
 */
async function createContainer(portainerUrl, endpointId, containerConfig, containerName) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const apiUrl = `${url}/api/endpoints/${endpointId}/docker/containers/create`;
      const baseConfig = {
        headers: getAuthHeaders(url),
      };

      // Add name as query parameter if provided
      if (containerName) {
        // Remove leading slash if present (Docker API expects name without leading slash)
        const cleanName = containerName.startsWith("/")
          ? containerName.substring(1)
          : containerName;
        baseConfig.params = { name: cleanName };
      }

      const config = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.post(apiUrl, containerConfig, config);
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return createContainer(portainerUrl, endpointId, containerConfig, containerName);
    }
    throw error;
  }
}

/**
 * Start container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
async function startContainer(portainerUrl, endpointId, containerId) {
  try {
    await requestWithIpFallback(async (url) => {
      const baseConfig = { headers: getAuthHeaders(url) };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.post(
        `${url}/api/endpoints/${endpointId}/docker/containers/${containerId}/start`,
        null,
        ipConfig
      );
    }, portainerUrl);
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return startContainer(portainerUrl, endpointId, containerId);
    }
    // Handle "already started" scenarios gracefully
    // 304 = Not Modified (container already running)
    if (error.response?.status === 304) {
      logger.debug("Container already started (304 Not Modified)", {
        module: "portainerService",
        operation: "startContainer",
        containerId: containerId.substring(0, 12),
      });
      return; // Container is already running, which is fine
    }
    // 409 = Conflict (container might already be running or in transition)
    if (error.response?.status === 409) {
      // Check if container is actually running
      try {
        const details = await getContainerDetails(portainerUrl, endpointId, containerId);
        const status = details.State?.Status || (details.State?.Running ? "running" : "exited");
        if (status === "running") {
          logger.debug("Container already running (409 Conflict, but verified running)", {
            module: "portainerService",
            operation: "startContainer",
            containerId: containerId.substring(0, 12),
          });
          return; // Container is already running, which is fine
        }
      } catch (checkErr) {
        // If we can't verify, re-throw the original error
        logger.warn("Could not verify container state after 409", {
          module: "portainerService",
          operation: "startContainer",
          containerId: containerId.substring(0, 12),
        });
      }
    }
    throw error;
  }
}

/**
 * Get container logs
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {number} tail - Number of lines to return (default: 100)
 * @returns {Promise<string>} - Container logs
 */
async function getContainerLogs(portainerUrl, endpointId, containerId, tail = 100) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = {
        headers: getAuthHeaders(url),
        params: {
          stdout: 1,
          stderr: 1,
          tail: tail,
          timestamps: 1,
        },
        responseType: "text",
      };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.get(
        `${url}/api/endpoints/${endpointId}/docker/containers/${containerId}/logs`,
        ipConfig
      );
    }, portainerUrl);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      await authenticatePortainer(portainerUrl);
      return getContainerLogs(portainerUrl, endpointId, containerId, tail);
    }
    throw error;
  }
}

module.exports = {
  authenticatePortainer,
  clearAuthToken,
  storeTokenForBothUrls,
  getAuthHeaders,
  getIpFallbackConfig,
  getEndpoints,
  getContainers,
  getContainerDetails,
  getImages,
  getImageDetails,
  deleteImage,
  pullImage,
  stopContainer,
  removeContainer,
  createContainer,
  startContainer,
  getContainerLogs,
};
