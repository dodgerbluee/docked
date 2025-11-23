/**
 * Portainer Authentication Service
 *
 * Handles authentication with Portainer instances, including token management
 * and credential fetching. Extracted from portainerService to improve modularity.
 */

const axios = require("axios");
const { URL } = require("url");
const { getAllPortainerInstances } = require("../../db/index");
const logger = require("../../utils/logger");
const { validateUrlForSSRF } = require("../../utils/validation");
const {
  getIpFallbackConfig,
  requestWithIpFallback,
  normalizeUrlForStorage,
} = require("./ipFallbackService");

// Store auth tokens per Portainer instance
const authTokens = new Map();
// Store auth type per Portainer instance to determine correct header format
const authTypes = new Map();

/**
 * Clear authentication token for a specific Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @returns {void}
 */
function clearAuthToken(portainerUrl) {
  authTokens.delete(portainerUrl);
  authTypes.delete(portainerUrl);
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
 * Get Portainer API headers for a specific instance
 * @param {string} portainerUrl - Portainer instance URL (original or IP-based)
 * @returns {Object} - Headers object with Authorization or X-API-Key
 */
function getAuthHeaders(portainerUrl) {
  const normalizedUrl = normalizeUrlForStorage(portainerUrl);

  // Try to get token with the provided URL first (both original and normalized)
  let token = authTokens.get(portainerUrl) || authTokens.get(normalizedUrl);
  let authType = authTypes.get(portainerUrl) || authTypes.get(normalizedUrl);

  if (!token) {
    // If no token found, return empty headers (will trigger authentication)
    return {};
  }

  // Return appropriate header based on auth type
  if (authType === "apikey") {
    return {
      "X-API-Key": token,
    };
  } else {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
}

/**
 * Fetch credentials from database for a Portainer instance
 * @param {string} portainerUrl - Portainer URL (may be IP URL)
 * @param {string} originalUrl - Original URL with domain
 * @returns {Promise<{username: string|null, password: string|null, apiKey: string|null, authType: string, originalUrl: string|null}>}
 */
async function fetchCredentialsFromDatabase(portainerUrl, originalUrl = null) {
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
      const authType = instance.auth_type || "apikey";
      let username = null;
      let password = null;
      let apiKey = null;

      if (authType === "apikey") {
        apiKey = instance.api_key;
      } else {
        username = instance.username;
        password = instance.password;
      }

      // Use original URL for matching if we found instance by IP
      const finalOriginalUrl = originalUrl || (instance.url !== portainerUrl ? instance.url : null);

      logger.debug("Fetched credentials from database for authentication", {
        portainerUrl: portainerUrl,
        originalUrl: finalOriginalUrl || instance.url,
        instanceName: instance.name,
        authType: authType,
      });

      return {
        username,
        password,
        apiKey,
        authType,
        originalUrl: finalOriginalUrl,
      };
    }

    return {
      username: null,
      password: null,
      apiKey: null,
      authType: "apikey",
      originalUrl: originalUrl,
    };
  } catch (error) {
    logger.warn("Failed to fetch credentials from database", {
      error: error.message,
      portainerUrl: portainerUrl,
    });
    return {
      username: null,
      password: null,
      apiKey: null,
      authType: "apikey",
      originalUrl: originalUrl,
    };
  }
}

/**
 * Authenticate with a Portainer instance
 * @param {string} portainerUrl - Portainer instance URL
 * @param {string|null} [username=null] - Username for password authentication
 * @param {string|null} [password=null] - Password for password authentication
 * @param {string|null} [apiKey=null] - API key for API key authentication
 * @param {string} [authType="apikey"] - Authentication type ('apikey' or 'password')
 * @param {boolean} [skipCache=false] - Skip cached token and force re-authentication
 * @param {string|null} [originalUrl=null] - Original URL for Host header (if using IP fallback)
 * @returns {Promise<string>} Authentication token
 * @throws {Error} If authentication fails
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
    const credentials = await fetchCredentialsFromDatabase(portainerUrl, originalUrl);
    authType = credentials.authType;
    apiKey = credentials.apiKey;
    username = credentials.username;
    password = credentials.password;
    if (!originalUrl && credentials.originalUrl) {
      originalUrl = credentials.originalUrl;
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
        // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
        const ssrfValidation = validateUrlForSSRF(portainerUrl, true);
        if (!ssrfValidation.valid) {
          throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
        }
        const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
        logger.debug("IP fallback config", {
          headers: ipConfig.headers,
          hasHttpsAgent: !!ipConfig.httpsAgent,
        });
        // Use proper URL construction instead of string interpolation
        const url = new URL("/api/endpoints", portainerUrl);
        testResponse = await axios.get(url.toString(), ipConfig);
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
          // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
          const ssrfValidation = validateUrlForSSRF(url, true);
          if (!ssrfValidation.valid) {
            throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
          }
          const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
          // Use proper URL construction instead of string interpolation
          const requestUrl = new URL("/api/endpoints", url);
          return await axios.get(requestUrl.toString(), ipConfig);
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
        // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
        const ssrfValidation = validateUrlForSSRF(portainerUrl, true);
        if (!ssrfValidation.valid) {
          throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
        }
        const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
        // Use proper URL construction instead of string interpolation
        const url = new URL("/api/auth", portainerUrl);
        response = await axios.post(
          url.toString(),
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
          // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
          const ssrfValidation = validateUrlForSSRF(url, true);
          if (!ssrfValidation.valid) {
            throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
          }
          const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
          // Use proper URL construction instead of string interpolation
          const requestUrl = new URL("/api/auth", url);
          return await axios.post(
            requestUrl.toString(),
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
          const config = require("../../config");
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
        logger.error(`Portainer authentication failed for ${portainerUrl}:`, { error });
      }
      throw new Error(
        `Failed to authenticate with Portainer at ${portainerUrl}: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  }
}

module.exports = {
  authenticatePortainer,
  getAuthHeaders,
  clearAuthToken,
  storeTokenForBothUrls,
  normalizeUrlForStorage,
};
