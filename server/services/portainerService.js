/**
 * Portainer API Service
 * Handles all interactions with Portainer instances
 */

const axios = require("axios");
const https = require("https");
const { URL } = require("url");
const config = require("../config");
const { urlWithIp } = require("../utils/dnsResolver");
const { getAllPortainerInstances } = require("../db/database");
const logger = require("../utils/logger");

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
 * Normalize URL (remove trailing slash for consistency)
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrlForStorage(url) {
  try {
    const urlObj = new URL(url);
    // Reconstruct URL without trailing slash
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/**
 * Store authentication token for both IP URL and original URL
 * This ensures tokens can be found regardless of which URL is used
 * @param {string} ipUrl - IP-based URL
 * @param {string} originalUrl - Original URL with domain
 * @param {string} token - Authentication token
 * @param {string} authType - Authentication type ('apikey' or 'password')
 */
function storeTokenForBothUrls(ipUrl, originalUrl, token, authType) {
  // Normalize URLs before storing to ensure consistency
  const normalizedIpUrl = normalizeUrlForStorage(ipUrl);
  const normalizedOriginalUrl = normalizeUrlForStorage(originalUrl);

  // Store with both original and normalized versions
  authTokens.set(ipUrl, token);
  authTokens.set(originalUrl, token);
  authTokens.set(normalizedIpUrl, token);
  authTokens.set(normalizedOriginalUrl, token);

  authTypes.set(ipUrl, authType);
  authTypes.set(originalUrl, authType);
  authTypes.set(normalizedIpUrl, authType);
  authTypes.set(normalizedOriginalUrl, authType);

  logger.debug("Stored token for both URLs", {
    ipUrl: normalizedIpUrl,
    originalUrl: normalizedOriginalUrl,
    authType: authType,
  });
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
        Host: originalUrlObj.host, // Set Host header to original domain
      },
    };

    // Disable SSL certificate verification for HTTPS IP requests
    if (ipUrlObj.protocol === "https:") {
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
    const isDnsError =
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      (error.message &&
        (error.message.includes("getaddrinfo") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED")));

    if (isDnsError) {
      // Try to get instance with IP fallback
      try {
        const instances = await getAllPortainerInstances();
        const instance = instances.find((inst) => inst.url === portainerUrl);

        if (instance && instance.ip_address) {
          logger.info(
            `DNS resolution failed for ${portainerUrl}, using IP fallback: ${instance.ip_address}`
          );

          // Try multiple URL variations with the IP address
          const originalUrl = new URL(portainerUrl);
          const ipAddress = instance.ip_address;
          const originalPort = originalUrl.port; // This can be empty string if not specified

          // List of URL variations to try (in order of preference)
          const ipUrlVariations = [];

          // 1. Try with original protocol and port (if port was explicitly set and not empty)
          if (originalPort && originalPort.trim() !== "") {
            ipUrlVariations.push(`${originalUrl.protocol}//${ipAddress}:${originalPort}`);
          } else {
            // 2. If no port specified, use Portainer defaults
            if (originalUrl.protocol === "https:") {
              // For HTTPS, only try 9443 (Portainer's default HTTPS port)
              ipUrlVariations.push(`https://${ipAddress}:9443`);
            } else {
              // For HTTP, only try 9000 (Portainer's default HTTP port)
              ipUrlVariations.push(`http://${ipAddress}:9000`);
            }
          }

          // Try each variation until one works
          for (const ipUrl of ipUrlVariations) {
            try {
              logger.info(`Trying IP fallback URL: ${ipUrl}`);

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
                logger.info(`IP fallback succeeded with: ${ipUrl}`);
                return result;
              } catch (ipError) {
                // Check if it's an SSL/certificate error
                const isSSLError =
                  ipError.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
                  ipError.code === "CERT_HAS_EXPIRED" ||
                  ipError.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
                  ipError.message?.includes("certificate") ||
                  ipError.message?.includes("SSL") ||
                  ipError.message?.includes("self-signed");

                if (isSSLError) {
                  logger.warn(
                    `SSL error with IP fallback - request function may need to merge IP config: ${ipError.message}`
                  );
                }
                throw ipError;
              }
            } catch (ipError) {
              // If this variation failed, try the next one
              // Only log if it's the last variation
              if (ipUrl === ipUrlVariations[ipUrlVariations.length - 1]) {
                logger.error(
                  `All IP fallback variations failed for ${portainerUrl}. Last attempt (${ipUrl}):`,
                  ipError.message
                );
              }
              // Continue to next variation
            }
          }
        }
      } catch (ipError) {
        logger.error(`IP fallback failed for ${portainerUrl}:`, ipError.message);
      }
    }

    // Re-throw original error if not DNS error or IP fallback failed
    throw error;
  }
}

/**
 * Authenticate with a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL (can be IP URL for nginx upgrades)
 * @param {string} username - Username for this instance (required for password auth)
 * @param {string} password - Password for this instance (required for password auth)
 * @param {string} apiKey - API key for this instance (required for API key auth)
 * @param {string} authType - Authentication type: 'password' or 'apikey'
 * @param {boolean} skipCache - If true, skip cache check and always re-authenticate (for validation)
 * @param {string} originalUrl - Original URL with domain (for setting Host header when using IP URL)
 * @returns {Promise<string>} - Authentication token
 */
async function authenticatePortainer(
  portainerUrl,
  username = null,
  password = null,
  apiKey = null,
  authType = "apikey",
  skipCache = false,
  originalUrl = null
) {
  // Use originalUrl for Host header if provided, otherwise use portainerUrl
  const urlForHostHeader = originalUrl || portainerUrl;
  // Check if we already have a valid token for this instance (unless skipping cache for validation)
  if (!skipCache && authTokens.has(portainerUrl)) {
    return authTokens.get(portainerUrl);
  }

  // If credentials are not provided, try to fetch them from the database
  // This is especially important when using IP URLs for nginx upgrades
  if (!apiKey && !username && !password) {
    try {
      const instances = await getAllPortainerInstances();
      // Try to match by IP URL first, then by original URL
      const instance = instances.find((inst) => {
        try {
          const instUrl = new URL(inst.url);
          const portainerUrlObj = new URL(portainerUrl);
          // Match by IP if portainerUrl is an IP
          if (/^\d+\.\d+\.\d+\.\d+$/.test(portainerUrlObj.hostname)) {
            // Check if instance IP matches
            if (inst.ip_address === portainerUrlObj.hostname) {
              return true;
            }
          }
          // Match by original URL
          if (inst.url === portainerUrl || inst.url === originalUrl) {
            return true;
          }
          // Match by normalized URLs
          const normalizedInstUrl = normalizeUrlForStorage(inst.url);
          const normalizedPortainerUrl = normalizeUrlForStorage(portainerUrl);
          if (
            normalizedInstUrl === normalizedPortainerUrl ||
            normalizedInstUrl === normalizeUrlForStorage(originalUrl || "")
          ) {
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      });

      if (instance) {
        authType = instance.auth_type || "apikey";
        if (authType === "apikey") {
          apiKey = instance.api_key;
        } else {
          username = instance.username;
          password = instance.password;
        }
        // Use original URL for matching if we found instance by IP
        if (!originalUrl && instance.url !== portainerUrl) {
          originalUrl = instance.url;
        }
        logger.debug("Fetched credentials from database for authentication", {
          portainerUrl: portainerUrl,
          originalUrl: originalUrl || instance.url,
          instanceName: instance.name,
          authType: authType,
        });
      }
    } catch (error) {
      logger.warn("Failed to fetch credentials from database", {
        error: error.message,
        portainerUrl: portainerUrl,
      });
    }
  }

  // Validate credentials based on auth type
  if (authType === "apikey") {
    if (!apiKey) {
      throw new Error("API key is required for API key authentication");
    }
    // For API key auth, validate the key by making an actual API call
    // Portainer API keys use X-API-Key header, not Authorization Bearer
    // Check if portainerUrl is an IP URL and originalUrl is provided
    const isIpUrl = /^\d+\.\d+\.\d+\.\d+$/.test(new URL(portainerUrl).hostname);

    try {
      let testResponse;

      if (isIpUrl && originalUrl) {
        // Direct request with IP URL, using original URL for Host header
        logger.debug("Validating API key with IP URL", {
          ipUrl: portainerUrl,
          originalUrl: originalUrl,
        });
        const baseConfig = {
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
        };
        const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
        logger.debug("IP fallback config", {
          headers: ipConfig.headers,
          hasHttpsAgent: !!ipConfig.httpsAgent,
        });
        testResponse = await axios.get(`${portainerUrl}/api/endpoints`, ipConfig);
      } else {
        // Use normal IP fallback flow
        logger.debug("Validating API key with normal flow", {
          portainerUrl,
          urlForHostHeader,
        });
        testResponse = await requestWithIpFallback(async (url) => {
          const baseConfig = {
            headers: {
              "X-API-Key": apiKey,
              "Content-Type": "application/json",
            },
          };
          const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
          return await axios.get(`${url}/api/endpoints`, ipConfig);
        }, portainerUrl);
      }
      // If we get here, the API key is valid
      // Store with both original and normalized URL
      const normalizedUrl = normalizeUrlForStorage(portainerUrl);
      authTokens.set(portainerUrl, apiKey);
      authTokens.set(normalizedUrl, apiKey);
      authTypes.set(portainerUrl, "apikey");
      authTypes.set(normalizedUrl, "apikey");
      return apiKey;
    } catch (apiKeyError) {
      // Enhanced error logging for debugging
      logger.error("API key validation failed", {
        portainerUrl,
        originalUrl,
        isIpUrl: isIpUrl,
        status: apiKeyError.response?.status,
        statusText: apiKeyError.response?.statusText,
        responseData: apiKeyError.response?.data,
        message: apiKeyError.message,
        code: apiKeyError.code,
        stack: apiKeyError.stack,
      });

      if (apiKeyError.response?.status === 401 || apiKeyError.response?.status === 403) {
        throw new Error("Invalid API key. Please check your API key and try again.");
      }
      // For other errors (network, etc.), throw the original error
      throw new Error(`Failed to validate API key: ${apiKeyError.message}`);
    }
  } else {
    // Password-based authentication
    if (!username || !password) {
      throw new Error("Username and password are required for Portainer authentication");
    }
  }

  const authUsername = username;
  const authPassword = password;

  try {
    // Try the standard Portainer API v2 format
    // If portainerUrl is an IP URL and originalUrl is provided, use IP URL directly
    const isIpUrl = /^\d+\.\d+\.\d+\.\d+$/.test(new URL(portainerUrl).hostname);
    let response;

    if (isIpUrl && originalUrl) {
      // Direct request with IP URL, using original URL for Host header
      const baseConfig = {
        headers: {
          "Content-Type": "application/json",
        },
      };
      const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
      response = await axios.post(
        `${portainerUrl}/api/auth`,
        {
          username: authUsername,
          password: authPassword,
        },
        ipConfig
      );
    } else {
      // Use normal IP fallback flow
      response = await requestWithIpFallback(async (url) => {
        const baseConfig = {
          headers: {
            "Content-Type": "application/json",
          },
        };
        const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
        return await axios.post(
          `${url}/api/auth`,
          {
            username: authUsername,
            password: authPassword,
          },
          ipConfig
        );
      }, portainerUrl);
    }

    // Portainer returns jwt in response.data
    const authToken = response.data.jwt || response.data.token;
    if (!authToken) {
      logger.error(`No token in response for ${portainerUrl}:`, response.data);
      throw new Error("Authentication response missing token");
    }

    // Store token for this instance (both original and normalized URL)
    const normalizedUrl = normalizeUrlForStorage(portainerUrl);
    authTokens.set(portainerUrl, authToken);
    authTokens.set(normalizedUrl, authToken);
    authTypes.set(portainerUrl, "password");
    authTypes.set(normalizedUrl, "password");
    return authToken;
  } catch (error) {
    // Enhanced error logging
    if (error.response) {
      logger.error(`Portainer authentication failed for ${portainerUrl}:`);
      logger.error("Status:", error.response.status);
      logger.error("Status Text:", error.response.statusText);

      // Try alternative authentication formats
      if (error.response.status === 422) {
        const altFormats = [
          { Username: config.portainer.username, Password: config.portainer.password },
          { user: config.portainer.username, password: config.portainer.password },
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
              const normalizedUrl = normalizeUrlForStorage(portainerUrl);
              authTokens.set(portainerUrl, altToken);
              authTokens.set(normalizedUrl, altToken);
              authTypes.set(portainerUrl, "password");
              authTypes.set(normalizedUrl, "password");
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
      logger.error(`Portainer authentication failed for ${portainerUrl}:`, error.message);
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
  const normalizedUrl = normalizeUrlForStorage(portainerUrl);

  // Try to get token with the provided URL first (both original and normalized)
  let token = authTokens.get(portainerUrl) || authTokens.get(normalizedUrl);
  let authType = authTypes.get(portainerUrl) || authTypes.get(normalizedUrl);

  // If not found, check all stored tokens to find a match
  // This handles cases where token was stored with original URL but we're using IP URL or vice versa
  if (!token) {
    // Check all stored tokens - if portainerUrl is an IP URL, find the matching original URL token
    // or vice versa
    for (const [storedUrl, storedToken] of authTokens.entries()) {
      const normalizedStoredUrl = normalizeUrlForStorage(storedUrl);

      // First try exact match (both original and normalized)
      if (
        storedUrl === portainerUrl ||
        storedUrl === normalizedUrl ||
        normalizedStoredUrl === portainerUrl ||
        normalizedStoredUrl === normalizedUrl
      ) {
        token = storedToken;
        authType = authTypes.get(storedUrl);
        break;
      }

      // If exact match fails, try to match by checking if one is an IP URL and the other is the original
      // Extract hostnames/IPs from both URLs and compare ports/protocols
      try {
        const storedUrlObj = new URL(storedUrl);
        const portainerUrlObj = new URL(portainerUrl);
        const storedHost = storedUrlObj.hostname;
        const portainerHost = portainerUrlObj.hostname;

        // Check if one is an IP address and they have the same port and protocol
        const storedIsIp = /^\d+\.\d+\.\d+\.\d+$/.test(storedHost);
        const portainerIsIp = /^\d+\.\d+\.\d+\.\d+$/.test(portainerHost);

        // Normalize ports - if not specified, use defaults (9443 for HTTPS, 9000 for HTTP)
        const getNormalizedPort = (urlObj) => {
          if (urlObj.port) {
            return urlObj.port;
          }
          return urlObj.protocol === "https:" ? "9443" : "9000";
        };

        const storedPort = getNormalizedPort(storedUrlObj);
        const portainerPort = getNormalizedPort(portainerUrlObj);

        // If one is IP and one is domain, and they match on protocol/port, they're the same instance
        if (
          storedIsIp !== portainerIsIp &&
          storedUrlObj.protocol === portainerUrlObj.protocol &&
          storedPort === portainerPort
        ) {
          // They're likely the same instance (one is IP, one is domain)
          // Use the stored token
          token = storedToken;
          authType = authTypes.get(storedUrl);
          break;
        }
      } catch (urlError) {
        // Invalid URL format, skip this check
        continue;
      }
    }
  }

  if (!token) {
    // Log available tokens for debugging
    const availableUrls = Array.from(authTokens.keys());
    logger.error(`No authentication token for ${portainerUrl}`, {
      requestedUrl: portainerUrl,
      normalizedUrl: normalizedUrl,
      availableTokens: availableUrls,
    });
    throw new Error(`No authentication token for ${portainerUrl}`);
  }

  authType = authType || "apikey";

  // Portainer API keys use X-API-Key header, JWT tokens use Authorization Bearer
  if (authType === "apikey") {
    return {
      "X-API-Key": token,
      "Content-Type": "application/json",
    };
  } else {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
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
