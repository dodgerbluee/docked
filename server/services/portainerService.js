/**
 * Portainer API Service
 * Handles all interactions with Portainer instances
 */

const axios = require('axios');
const config = require('../config');

// Store auth tokens per Portainer instance
const authTokens = new Map();

/**
 * Authenticate with a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string} username - Username for this instance
 * @param {string} password - Password for this instance
 * @returns {Promise<string>} - Authentication token
 */
async function authenticatePortainer(portainerUrl, username = null, password = null) {
  // Check if we already have a valid token for this instance
  if (authTokens.has(portainerUrl)) {
    return authTokens.get(portainerUrl);
  }

  // Use provided credentials (required)
  if (!username || !password) {
    throw new Error('Username and password are required for Portainer authentication');
  }
  const authUsername = username;
  const authPassword = password;

  try {
    // Try the standard Portainer API v2 format
    const response = await axios.post(
      `${portainerUrl}/api/auth`,
      {
        username: authUsername,
        password: authPassword,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // Portainer returns jwt in response.data
    const authToken = response.data.jwt || response.data.token;
    if (!authToken) {
      console.error(`No token in response for ${portainerUrl}:`, response.data);
      throw new Error('Authentication response missing token');
    }

    // Store token for this instance
    authTokens.set(portainerUrl, authToken);
    return authToken;
  } catch (error) {
    // Enhanced error logging
    if (error.response) {
      console.error(`Portainer authentication failed for ${portainerUrl}:`);
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);

      // Try alternative authentication formats
      if (error.response.status === 422) {
        const altFormats = [
          { Username: config.portainer.username, Password: config.portainer.password },
          { user: config.portainer.username, password: config.portainer.password },
        ];

        for (const format of altFormats) {
          console.log(
            `Attempting alternative authentication format for ${portainerUrl}...`,
            Object.keys(format)
          );
          try {
            const altResponse = await axios.post(
              `${portainerUrl}/api/auth`,
              format,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );
            const altToken = altResponse.data.jwt || altResponse.data.token;
            if (altToken) {
              console.log(
                `Alternative authentication format succeeded for ${portainerUrl}`
              );
              authTokens.set(portainerUrl, altToken);
              return altToken;
            }
          } catch (altError) {
            if (altError.response) {
              console.error(
                `Alternative format failed for ${portainerUrl}:`,
                altError.response.status,
                altError.response.data
              );
            }
          }
        }
      }
    } else {
      console.error(
        `Portainer authentication failed for ${portainerUrl}:`,
        error.message
      );
    }
    throw new Error(
      `Failed to authenticate with Portainer at ${portainerUrl}: ${
        error.response?.data?.message || error.message
      }`
    );
  }
}

/**
 * Get Portainer API headers for a specific instance
 * @param {string} portainerUrl - Portainer instance URL
 * @returns {Object} - Headers object with Authorization
 */
function getAuthHeaders(portainerUrl) {
  const token = authTokens.get(portainerUrl);
  if (!token) {
    throw new Error(`No authentication token for ${portainerUrl}`);
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Get all endpoints (Docker environments) for a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @returns {Promise<Array>} - Array of endpoints
 */
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

/**
 * Get all containers for an endpoint
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Array>} - Array of containers
 */
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

/**
 * Get container details including image info
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<Object>} - Container details
 */
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

/**
 * Get all images from an endpoint
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Array>} - Array of images
 */
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

/**
 * Get image details
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageId - Image ID
 * @returns {Promise<Object>} - Image details
 */
async function getImageDetails(portainerUrl, endpointId, imageId) {
  try {
    const response = await axios.get(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/images/${imageId}/json`,
      { headers: getAuthHeaders(portainerUrl) }
    );
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
    const url = `${portainerUrl}/api/endpoints/${endpointId}/docker/images/${imageId}${
      force ? '?force=true' : ''
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

/**
 * Pull new image
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageName - Image name (repo:tag)
 * @returns {Promise<Object>} - Pull result
 */
async function pullImage(portainerUrl, endpointId, imageName) {
  try {
    const response = await axios.post(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/images/create`,
      null,
      {
        headers: getAuthHeaders(portainerUrl),
        params: {
          fromImage: imageName.split(':')[0],
          tag: imageName.includes(':') ? imageName.split(':')[1] : 'latest',
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

/**
 * Stop container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
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

/**
 * Remove container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
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

/**
 * Create container from image (recreate with same config)
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {Object} containerConfig - Container configuration
 * @param {string} containerName - Container name
 * @returns {Promise<Object>} - Created container info
 */
async function createContainer(
  portainerUrl,
  endpointId,
  containerConfig,
  containerName
) {
  try {
    const url = `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/create`;
    const config = {
      headers: getAuthHeaders(portainerUrl),
    };

    // Add name as query parameter if provided
    if (containerName) {
      // Remove leading slash if present (Docker API expects name without leading slash)
      const cleanName = containerName.startsWith('/')
        ? containerName.substring(1)
        : containerName;
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

/**
 * Start container
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @returns {Promise<void>}
 */
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
    const response = await axios.get(
      `${portainerUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/logs`,
      {
        headers: getAuthHeaders(portainerUrl),
        params: {
          stdout: 1,
          stderr: 1,
          tail: tail,
          timestamps: 1,
        },
        responseType: 'text',
      }
    );
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

