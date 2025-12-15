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
    authType,
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
  const token = authTokens.get(portainerUrl) || authTokens.get(normalizedUrl);
  const authType = authTypes.get(portainerUrl) || authTypes.get(normalizedUrl);

  if (!token) {
    // If no token found, return empty headers (will trigger authentication)
    return {};
  }

  // Return appropriate header based on auth type
  if (authType === "apikey") {
    return {
      "X-API-Key": token,
    };
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Check if instance matches by IP
 * @param {Object} inst - Instance object
 * @param {URL} portainerUrlObj - Parsed Portainer URL
 * @returns {boolean} - True if matches
 */
function matchesByIp(inst, portainerUrlObj) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(portainerUrlObj.hostname)) {
    return false;
  }
  return inst.ip_address === portainerUrlObj.hostname;
}

/**
 * Check if instance matches by URL
 * @param {Object} inst - Instance object
 * @param {string} portainerUrl - Portainer URL
 * @param {string} originalUrl - Original URL
 * @returns {boolean} - True if matches
 */
function matchesByUrl(inst, portainerUrl, originalUrl) {
  if (inst.url === portainerUrl || inst.url === originalUrl) {
    return true;
  }
  const normalizedInstUrl = normalizeUrlForStorage(inst.url);
  const normalizedPortainerUrl = normalizeUrlForStorage(portainerUrl);
  return (
    normalizedInstUrl === normalizedPortainerUrl ||
    normalizedInstUrl === normalizeUrlForStorage(originalUrl || "")
  );
}

/**
 * Find matching instance from database
 * @param {Array} instances - Array of instances
 * @param {string} portainerUrl - Portainer URL
 * @param {string} originalUrl - Original URL
 * @returns {Object|null} - Matching instance or null
 */
function findMatchingInstance(instances, portainerUrl, originalUrl) {
  return (
    instances.find((inst) => {
      try {
        const _instUrl = new URL(inst.url);
        const portainerUrlObj = new URL(portainerUrl);
        return matchesByIp(inst, portainerUrlObj) || matchesByUrl(inst, portainerUrl, originalUrl);
      } catch {
        return false;
      }
    }) || null
  );
}

/**
 * Extract credentials from instance
 * @param {Object} instance - Instance object
 * @returns {Object} - Credentials object
 */
function extractCredentials(instance) {
  const authType = instance.auth_type || "apikey";
  if (authType === "apikey") {
    return {
      username: null,
      password: null,
      apiKey: instance.api_key,
      authType,
    };
  }
  return {
    username: instance.username,
    password: instance.password,
    apiKey: null,
    authType,
  };
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
    const instance = findMatchingInstance(instances, portainerUrl, originalUrl);

    if (!instance) {
      return {
        username: null,
        password: null,
        apiKey: null,
        authType: "apikey",
        originalUrl,
      };
    }

    const creds = extractCredentials(instance);
    const finalOriginalUrl = originalUrl || (instance.url !== portainerUrl ? instance.url : null);

    logger.debug("Fetched credentials from database for authentication", {
      portainerUrl,
      originalUrl: finalOriginalUrl || instance.url,
      instanceName: instance.name,
      authType: creds.authType,
    });

    return {
      ...creds,
      originalUrl: finalOriginalUrl,
    };
  } catch (error) {
    logger.warn("Failed to fetch credentials from database", {
      error: error.message,
      portainerUrl,
    });
    return {
      username: null,
      password: null,
      apiKey: null,
      authType: "apikey",
      originalUrl,
    };
  }
}

/**
 * Store authentication token
 * @param {string} portainerUrl - Portainer URL
 * @param {string} token - Authentication token
 * @param {string} authType - Authentication type
 */
function storeAuthToken(portainerUrl, token, authType) {
  const normalizedUrl = normalizeUrlForStorage(portainerUrl);
  authTokens.set(portainerUrl, token);
  authTokens.set(normalizedUrl, token);
  authTypes.set(portainerUrl, authType);
  authTypes.set(normalizedUrl, authType);
}

/**
 * Validate API key with IP URL
 * @param {string} portainerUrl - Portainer URL (IP)
 * @param {string} originalUrl - Original URL
 * @param {string} apiKey - API key
 */
async function validateApiKeyWithIpUrl(portainerUrl, originalUrl, apiKey) {
  logger.debug("Validating API key with IP URL", {
    ipUrl: portainerUrl,
    originalUrl,
  });
  const baseConfig = {
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
  };
  const ssrfValidation = validateUrlForSSRF(portainerUrl, true);
  if (!ssrfValidation.valid) {
    throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
  }
  const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
  const url = new URL("/api/endpoints", portainerUrl);
  await axios.get(url.toString(), ipConfig);
}

/**
 * Validate API key with normal flow
 * @param {string} portainerUrl - Portainer URL
 * @param {string} urlForHostHeader - URL for Host header
 * @param {string} apiKey - API key
 */
async function validateApiKeyNormal(portainerUrl, urlForHostHeader, apiKey) {
  logger.debug("Validating API key with normal flow", {
    portainerUrl,
    urlForHostHeader,
  });
  await requestWithIpFallback(async (url) => {
    const baseConfig = {
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    };
    const ssrfValidation = validateUrlForSSRF(url, true);
    if (!ssrfValidation.valid) {
      throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
    }
    const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
    const requestUrl = new URL("/api/endpoints", url);
    return axios.get(requestUrl.toString(), ipConfig);
  }, portainerUrl);
}

/**
 * Handle API key validation error
 * @param {Error} apiKeyError - Error object
 * @param {string} portainerUrl - Portainer URL
 * @param {string} originalUrl - Original URL
 * @param {boolean} isIpUrl - Whether IP URL
 * @returns {never}
 */
function handleApiKeyError(apiKeyError, portainerUrl, originalUrl, isIpUrl) {
  logger.error("API key validation failed", {
    portainerUrl,
    originalUrl,
    isIpUrl,
    status: apiKeyError.response?.status,
    statusText: apiKeyError.response?.statusText,
    responseData: apiKeyError.response?.data,
    message: apiKeyError.message,
    code: apiKeyError.code,
  });
  if (apiKeyError.response?.status === 401 || apiKeyError.response?.status === 403) {
    throw new Error("Invalid API key. Please check your API key and try again.");
  }
  throw new Error(`Failed to validate API key: ${apiKeyError.message}`);
}

/**
 * Authenticate with API key
 * @param {string} portainerUrl - Portainer URL
 * @param {string} originalUrl - Original URL
 * @param {string} urlForHostHeader - URL for Host header
 * @param {string} apiKey - API key
 * @returns {Promise<string>} - API key (validated)
 */
async function authenticateWithApiKey(portainerUrl, originalUrl, urlForHostHeader, apiKey) {
  const isIpUrl = /^\d+\.\d+\.\d+\.\d+$/.test(new URL(portainerUrl).hostname);
  try {
    if (isIpUrl && originalUrl) {
      await validateApiKeyWithIpUrl(portainerUrl, originalUrl, apiKey);
    } else {
      await validateApiKeyNormal(portainerUrl, urlForHostHeader, apiKey);
    }
    storeAuthToken(portainerUrl, apiKey, "apikey");
    return apiKey;
  } catch (apiKeyError) {
    return handleApiKeyError(apiKeyError, portainerUrl, originalUrl, isIpUrl);
  }
}

/**
 * Authenticate with password using IP URL
 * @param {string} portainerUrl - Portainer URL (IP)
 * @param {string} originalUrl - Original URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Object>} - Response object
 */
async function authenticatePasswordWithIpUrl(portainerUrl, originalUrl, username, password) {
  const baseConfig = {
    headers: {
      "Content-Type": "application/json",
    },
  };
  const ssrfValidation = validateUrlForSSRF(portainerUrl, true);
  if (!ssrfValidation.valid) {
    throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
  }
  const ipConfig = getIpFallbackConfig(portainerUrl, originalUrl, baseConfig);
  const url = new URL("/api/auth", portainerUrl);
  return axios.post(url.toString(), { username, password }, ipConfig);
}

/**
 * Authenticate with password using normal flow
 * @param {string} portainerUrl - Portainer URL
 * @param {string} urlForHostHeader - URL for Host header
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Object>} - Response object
 */
async function authenticatePasswordNormal(portainerUrl, urlForHostHeader, username, password) {
  return requestWithIpFallback(async (url) => {
    const baseConfig = {
      headers: {
        "Content-Type": "application/json",
      },
    };
    const ssrfValidation = validateUrlForSSRF(url, true);
    if (!ssrfValidation.valid) {
      throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
    }
    const ipConfig = getIpFallbackConfig(url, urlForHostHeader, baseConfig);
    const requestUrl = new URL("/api/auth", url);
    return axios.post(requestUrl.toString(), { username, password }, ipConfig);
  }, portainerUrl);
}

/**
 * Try alternative authentication formats
 * @param {string} portainerUrl - Portainer URL
 * @returns {Promise<string|null>} - Token or null
 */
async function tryAlternativeAuthFormats(portainerUrl) {
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
      const ssrfValidation = validateUrlForSSRF(portainerUrl, true);
      if (!ssrfValidation.valid) {
        throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
      }
      const altResponse = await axios.post(`${portainerUrl}/api/auth`, format, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      const altToken = altResponse.data.jwt || altResponse.data.token;
      if (altToken) {
        logger.info(`Alternative authentication format succeeded for ${portainerUrl}`);
        storeAuthToken(portainerUrl, altToken, "password");
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
  return null;
}

/**
 * Extract auth token from response
 * @param {Object} response - Response object
 * @param {string} portainerUrl - Portainer URL
 * @returns {string} - Auth token
 */
function extractAuthToken(response, portainerUrl) {
  const authToken = response.data.jwt || response.data.token;
  if (!authToken) {
    logger.error(`No token in response for ${portainerUrl}:`, response.data);
    throw new Error("Authentication response missing token");
  }
  return authToken;
}

/**
 * Handle password authentication error
 * @param {Error} error - Error object
 * @param {string} portainerUrl - Portainer URL
 * @returns {Promise<string|null>} - Alternative token or null
 */
async function handlePasswordAuthError(error, portainerUrl) {
  if (error.response) {
    logger.error(`Portainer authentication failed for ${portainerUrl}:`);
    logger.error("Status:", error.response.status);
    logger.error("Status Text:", error.response.statusText);

    if (error.response.status === 422) {
      const altToken = await tryAlternativeAuthFormats(portainerUrl);
      if (altToken) {
        return altToken;
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

/**
 * Authenticate with password
 * @param {string} portainerUrl - Portainer URL
 * @param {string} originalUrl - Original URL
 * @param {string} urlForHostHeader - URL for Host header
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<string>} - Authentication token
 */
async function authenticateWithPassword(
  portainerUrl,
  originalUrl,
  urlForHostHeader,
  username,
  password
) {
  const isIpUrl = /^\d+\.\d+\.\d+\.\d+$/.test(new URL(portainerUrl).hostname);
  try {
    const response =
      isIpUrl && originalUrl
        ? await authenticatePasswordWithIpUrl(portainerUrl, originalUrl, username, password)
        : await authenticatePasswordNormal(portainerUrl, urlForHostHeader, username, password);

    const authToken = extractAuthToken(response, portainerUrl);
    storeAuthToken(portainerUrl, authToken, "password");
    return authToken;
  } catch (error) {
    return handlePasswordAuthError(error, portainerUrl);
  }
}

/**
 * Load credentials from database if not provided
 * @param {string} portainerUrl - Portainer URL
 * @param {string|null} originalUrl - Original URL
 * @param {string|null} apiKey - API key
 * @param {string|null} username - Username
 * @param {string|null} password - Password
 * @returns {Promise<Object>} - Credentials object
 */
async function loadCredentialsIfNeeded(portainerUrl, originalUrl, apiKey, username, password) {
  if (apiKey || username || password) {
    return { apiKey, username, password, originalUrl };
  }

  const credentials = await fetchCredentialsFromDatabase(portainerUrl, originalUrl);
  return {
    apiKey: credentials.apiKey,
    username: credentials.username,
    password: credentials.password,
    originalUrl: credentials.originalUrl || originalUrl,
    authType: credentials.authType,
  };
}

/**
 * Authenticate with a Portainer instance
 * @param {Object} options - Options object
 * @param {string} options.portainerUrl - Portainer URL
 * @param {string|null} [options.username=null] - Username for password authentication
 * @param {string|null} [options.password=null] - Password for password authentication
 * @param {string|null} [options.apiKey=null] - API key for API key authentication
 * @param {string} [options.authType="apikey"] - Authentication type ('apikey' or 'password')
 * @param {boolean} [options.skipCache=false] - Skip cached token and force re-authentication
 * @param {string|null} [options.originalUrl=null] - Original URL for Host header (if using IP fallback)
 * @returns {Promise<string>} Authentication token
 * @throws {Error} If authentication fails
 */
// eslint-disable-next-line complexity -- Portainer authentication requires complex auth logic
async function authenticatePortainer({
  portainerUrl,
  username = null,
  password = null,
  apiKey = null,
  authType = "apikey",
  skipCache = false,
  originalUrl = null,
}) {
  const urlForHostHeader = originalUrl || portainerUrl;

  if (!skipCache && authTokens.has(portainerUrl)) {
    return authTokens.get(portainerUrl);
  }

  const credentials = await loadCredentialsIfNeeded(
    portainerUrl,
    originalUrl,
    apiKey,
    username,
    password
  );
  const finalAuthType = credentials.authType || authType;
  const finalOriginalUrl = credentials.originalUrl || originalUrl;

  if (finalAuthType === "apikey") {
    if (!credentials.apiKey) {
      throw new Error("API key is required for API key authentication");
    }
    return authenticateWithApiKey(
      portainerUrl,
      finalOriginalUrl,
      urlForHostHeader,
      credentials.apiKey
    );
  }

  if (!credentials.username || !credentials.password) {
    throw new Error("Username and password are required for Portainer authentication");
  }

  return authenticateWithPassword(
    portainerUrl,
    finalOriginalUrl,
    urlForHostHeader,
    credentials.username,
    credentials.password
  );
}

module.exports = {
  authenticatePortainer,
  getAuthHeaders,
  clearAuthToken,
  storeTokenForBothUrls,
  normalizeUrlForStorage,
};
