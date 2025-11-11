/**
 * Portainer API Service
 * Handles all interactions with Portainer instances
 */

const axios = require('axios');
const https = require('https');
const { URL } = require('url');
const config = require('../config');
const { urlWithIp } = require('../utils/dnsResolver');
const { getAllPortainerInstances } = require('../db/database');

// Store auth tokens per Portainer instance
const authTokens = new Map();
// Store auth type per Portainer instance to determine correct header format
const authTypes = new Map();

/**
 * Clear authentication token for a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 */
function clearAuthToken(portainerUrl) {
  authTokens.delete(portainerUrl);
  authTypes.delete(portainerUrl);
}

/**
 * Get axios config for IP fallback requests
 * Disables SSL verification and sets Host header when using IP address
 * @param {string} ipUrl - IP-based URL (e.g., "https://192.168.69.50:9443")
 * @param {string} originalUrl - Original URL with domain (e.g., "https://toybox.dbluee.net")
 * @param {Object} existingConfig - Existing axios config to merge
 * @returns {Object} - Axios config with SSL bypass and Host header
 */
function getIpFallbackConfig(ipUrl, originalUrl, existingConfig = {}) {
  const ipUrlObj = new URL(ipUrl);
  const originalUrlObj = new URL(originalUrl);
  
  // Check if we're using an IP address (not a hostname)
  const isIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(ipUrlObj.hostname);
  
  if (isIpAddress) {
    // Create config with SSL bypass and Host header
    const config = {
      ...existingConfig,
      headers: {
        ...existingConfig.headers,
        'Host': originalUrlObj.host, // Set Host header to original domain
      },
    };
    
    // Disable SSL certificate verification for HTTPS IP requests
    if (ipUrlObj.protocol === 'https:') {
      config.httpsAgent = new https.Agent({
        rejectUnauthorized: false, // Disable SSL verification for IP addresses
      });
    }
    
    return config;
  }
  
  return existingConfig;
}

/**
 * Helper to create axios config with IP fallback support
 * Use this in request functions to automatically merge IP fallback config
 */
function createAxiosConfig(url, originalUrl, baseConfig = {}) {
  return getIpFallbackConfig(url, originalUrl, baseConfig);
}

/**
 * Make an axios request with IP fallback on DNS failure
 * @param {Function} requestFn - Function that makes the axios request (receives URL and optional config)
 * @param {string} portainerUrl - Original Portainer URL
 * @returns {Promise} - Request result
 */
async function requestWithIpFallback(requestFn, portainerUrl) {
  try {
    // Try the original request first
    return await requestFn(portainerUrl);
  } catch (error) {
    // Check if it's a DNS/network error
    const isDnsError = error.code === 'ENOTFOUND' || 
                       error.code === 'ECONNREFUSED' ||
                       error.code === 'ETIMEDOUT' ||
                       (error.message && (
                         error.message.includes('getaddrinfo') ||
                         error.message.includes('ENOTFOUND') ||
                         error.message.includes('ECONNREFUSED')
                       ));
    
    if (isDnsError) {
      // Try to get instance with IP fallback
      try {
        const instances = await getAllPortainerInstances();
        const instance = instances.find(inst => inst.url === portainerUrl);
        
        if (instance && instance.ip_address) {
          console.log(`DNS resolution failed for ${portainerUrl}, using IP fallback: ${instance.ip_address}`);
          
          // Try multiple URL variations with the IP address
          const originalUrl = new URL(portainerUrl);
          const ipAddress = instance.ip_address;
          const originalPort = originalUrl.port;
          
          // List of URL variations to try (in order of preference)
          const ipUrlVariations = [];
          
          // 1. Try with original protocol and port (if port was explicitly set)
          if (originalPort) {
            ipUrlVariations.push(`${originalUrl.protocol}//${ipAddress}:${originalPort}`);
          }
          
          // 2. Try with original protocol and default/common ports
          if (originalUrl.protocol === 'https:') {
            ipUrlVariations.push(`https://${ipAddress}:443`);
            ipUrlVariations.push(`https://${ipAddress}:9443`); // Common Portainer HTTPS port
            // Also try HTTP versions (in case HTTPS doesn't work with IP)
            ipUrlVariations.push(`http://${ipAddress}:9000`); // Portainer default HTTP port
            ipUrlVariations.push(`http://${ipAddress}:80`);
          } else {
            ipUrlVariations.push(`http://${ipAddress}:80`);
            ipUrlVariations.push(`http://${ipAddress}:9000`); // Common Portainer HTTP port
          }
          
          // Try each variation until one works
          for (const ipUrl of ipUrlVariations) {
            try {
              console.log(`Trying IP fallback URL: ${ipUrl}`);
              
              // Update auth token map to use IP URL as key if we have a token
              if (authTokens.has(portainerUrl)) {
                const token = authTokens.get(portainerUrl);
                const authType = authTypes.get(portainerUrl);
                authTokens.set(ipUrl, token);
                // Don't delete original - keep it for other requests
                if (authType) {
                  authTypes.set(ipUrl, authType);
                }
              }
              
              // Try the request with IP fallback
              // The requestFn should merge IP config using getIpFallbackConfig
              try {
                const result = await requestFn(ipUrl);
                console.log(`IP fallback succeeded with: ${ipUrl}`);
                return result;
              } catch (ipError) {
                // Check if it's an SSL/certificate error
                const isSSLError = ipError.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || 
                                  ipError.code === 'CERT_HAS_EXPIRED' ||
                                  ipError.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
                                  ipError.message?.includes('certificate') ||
                                  ipError.message?.includes('SSL') ||
                                  ipError.message?.includes('self-signed');
                
                if (isSSLError) {
                  console.warn(`SSL error with IP fallback - request function may need to merge IP config: ${ipError.message}`);
                }
                throw ipError;
              }
            } catch (ipError) {
              // If this variation failed, try the next one
              // Only log if it's the last variation
              if (ipUrl === ipUrlVariations[ipUrlVariations.length - 1]) {
                console.error(`All IP fallback variations failed for ${portainerUrl}. Last attempt (${ipUrl}):`, ipError.message);
              }
              // Continue to next variation
            }
          }
        }
      } catch (ipError) {
        console.error(`IP fallback failed for ${portainerUrl}:`, ipError.message);
      }
    }
    
    // Re-throw original error if not DNS error or IP fallback failed
    throw error;
  }
}

/**
 * Authenticate with a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string} username - Username for this instance (required for password auth)
 * @param {string} password - Password for this instance (required for password auth)
 * @param {string} apiKey - API key for this instance (required for API key auth)
 * @param {string} authType - Authentication type: 'password' or 'apikey'
 * @param {boolean} skipCache - If true, skip cache check and always re-authenticate (for validation)
 * @returns {Promise<string>} - Authentication token
 */
async function authenticatePortainer(portainerUrl, username = null, password = null, apiKey = null, authType = 'apikey', skipCache = false) {
  // Check if we already have a valid token for this instance (unless skipping cache for validation)
  if (!skipCache && authTokens.has(portainerUrl)) {
    return authTokens.get(portainerUrl);
  }

  // Validate credentials based on auth type
  if (authType === 'apikey') {
    if (!apiKey) {
      throw new Error('API key is required for API key authentication');
    }
    // For API key auth, validate the key by making an actual API call
    // Portainer API keys use X-API-Key header, not Authorization Bearer
    try {
      // Test the API key by making a request to a protected endpoint with IP fallback
      const testResponse = await requestWithIpFallback(async (url) => {
        const baseConfig = {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        };
        const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
        return await axios.get(`${url}/api/endpoints`, ipConfig);
      }, portainerUrl);
      // If we get here, the API key is valid
      authTokens.set(portainerUrl, apiKey);
      authTypes.set(portainerUrl, 'apikey');
      return apiKey;
    } catch (apiKeyError) {
      if (apiKeyError.response?.status === 401 || apiKeyError.response?.status === 403) {
        throw new Error('Invalid API key. Please check your API key and try again.');
      }
      // For other errors (network, etc.), throw the original error
      throw new Error(`Failed to validate API key: ${apiKeyError.message}`);
    }
  } else {
    // Password-based authentication
    if (!username || !password) {
      throw new Error('Username and password are required for Portainer authentication');
    }
  }

  const authUsername = username;
  const authPassword = password;

  try {
    // Try the standard Portainer API v2 format with IP fallback
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = {
        headers: {
          'Content-Type': 'application/json',
        },
      };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.post(
        `${url}/api/auth`,
        {
          username: authUsername,
          password: authPassword,
        },
        ipConfig
      );
    }, portainerUrl);

    // Portainer returns jwt in response.data
    const authToken = response.data.jwt || response.data.token;
    if (!authToken) {
      console.error(`No token in response for ${portainerUrl}:`, response.data);
      throw new Error('Authentication response missing token');
    }

    // Store token for this instance
    authTokens.set(portainerUrl, authToken);
    authTypes.set(portainerUrl, 'password');
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
              authTypes.set(portainerUrl, 'password');
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
 * @param {string} portainerUrl - Portainer instance URL (original or IP-based)
 * @returns {Object} - Headers object with Authorization or X-API-Key
 */
function getAuthHeaders(portainerUrl) {
  // Try to get token with the provided URL first
  let token = authTokens.get(portainerUrl);
  let authType = authTypes.get(portainerUrl);
  
  // If not found, check all stored tokens to find a match
  // This handles cases where token was stored with original URL but we're using IP URL or vice versa
  if (!token) {
    // Check all stored tokens - if portainerUrl is an IP URL, find the matching original URL token
    for (const [storedUrl, storedToken] of authTokens.entries()) {
      // Check if this stored URL's IP matches the portainerUrl, or if portainerUrl contains an IP
      const { urlWithIp } = require('../utils/dnsResolver');
      const { getAllPortainerInstances } = require('../db/database');
      
      // Try to find instance by checking if storedUrl or portainerUrl match
      // This is a synchronous check - we'll iterate through stored tokens
      if (storedUrl === portainerUrl) {
        token = storedToken;
        authType = authTypes.get(storedUrl);
        break;
      }
    }
  }
  
  if (!token) {
    throw new Error(`No authentication token for ${portainerUrl}`);
  }
  
  authType = authType || 'apikey';
  
  // Portainer API keys use X-API-Key header, JWT tokens use Authorization Bearer
  if (authType === 'apikey') {
    return {
      'X-API-Key': token,
      'Content-Type': 'application/json',
    };
  } else {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
}

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
        force ? '?force=true' : ''
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
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} imageName - Image name (repo:tag)
 * @returns {Promise<Object>} - Pull result
 */
async function pullImage(portainerUrl, endpointId, imageName) {
  try {
    const response = await requestWithIpFallback(async (url) => {
      const baseConfig = {
        headers: getAuthHeaders(url),
        params: {
          fromImage: imageName.split(':')[0],
          tag: imageName.includes(':') ? imageName.split(':')[1] : 'latest',
        },
      };
      const ipConfig = getIpFallbackConfig(url, portainerUrl, baseConfig);
      return await axios.post(
        `${url}/api/endpoints/${endpointId}/docker/images/create`,
        null,
        ipConfig
      );
    }, portainerUrl);
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
    const response = await requestWithIpFallback(async (url) => {
      const apiUrl = `${url}/api/endpoints/${endpointId}/docker/containers/create`;
      const baseConfig = {
        headers: getAuthHeaders(url),
      };

      // Add name as query parameter if provided
      if (containerName) {
        // Remove leading slash if present (Docker API expects name without leading slash)
        const cleanName = containerName.startsWith('/')
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
        responseType: 'text',
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

