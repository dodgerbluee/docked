/**
 * Portainer IP Fallback Service
 *
 * Handles IP-based URL fallback for Portainer API requests when DNS is unavailable
 * (e.g., during nginx-proxy-manager upgrades). Extracted from portainerService to improve modularity.
 */

const { URL } = require("url");
const { urlWithIp } = require("../../utils/dnsResolver");
const logger = require("../../utils/logger");
const { validateUrlForSSRF } = require("../../utils/validation");

/**
 * Normalize URL (remove trailing slash for consistency)
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL without trailing slash
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

  if (!isIpAddress) {
    // Not using IP, return config as-is
    return existingConfig;
  }

  // We're using an IP address - need to:
  // 1. Disable SSL verification (IP addresses don't have valid SSL certs)
  // 2. Set Host header to original domain (so Portainer knows which virtual host)
  const config = { ...existingConfig };

  // Set Host header to original domain
  config.headers = {
    ...existingConfig.headers,
    Host: originalUrlObj.host, // e.g., "toybox.dbluee.net:9443"
  };

  // SSL certificate validation for IP addresses
  // Note: We do NOT disable certificate validation (rejectUnauthorized: false) as this creates
  // a security vulnerability (man-in-the-middle attacks).
  // The URL is validated for SSRF attacks before this function is called.
  // If a Portainer instance uses a self-signed certificate with an IP address, users should:
  // 1. Configure the trusted CA certificate via the 'ca' option in https.Agent (future enhancement)
  // 2. Or use HTTP instead of HTTPS for IP-based access
  // 3. Or use the domain name instead of IP address (recommended)
  // We use default certificate validation (rejectUnauthorized: true) - no httpsAgent needed

  return config;
}

/**
 * Create axios config with IP fallback support
 * @param {string} url - URL to use for request
 * @param {string} originalUrl - Original URL with domain
 * @param {Object} baseConfig - Base axios config
 * @returns {Object} - Axios config with IP fallback
 */
function createAxiosConfig(url, originalUrl, baseConfig = {}) {
  return getIpFallbackConfig(url, originalUrl, baseConfig);
}

/**
 * Check if error is DNS-related
 * @param {Error} error - Error object
 * @returns {boolean} - True if DNS error
 */
function isDnsError(error) {
  return (
    error.code === "ENOTFOUND" ||
    error.code === "ECONNREFUSED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ERR_NETWORK" ||
    error.message?.includes("getaddrinfo") ||
    (!error.response && error.request)
  );
}

/**
 * Try IP fallback for DNS errors
 * @param {Function} requestFn - Request function
 * @param {string} portainerUrl - Original URL
 * @param {Error} originalError - Original error
 * @returns {Promise<any>} - Response data
 */
async function tryIpFallback(requestFn, portainerUrl, originalError) {
  logger.info("DNS resolution failed, attempting IP fallback", {
    portainerUrl,
    error: originalError.message,
  });

  try {
    const ipUrl = await urlWithIp(portainerUrl);
    if (!ipUrl || ipUrl === portainerUrl) {
      throw originalError;
    }

    logger.info("Using IP fallback for Portainer request", {
      originalUrl: portainerUrl,
      ipUrl,
    });

    const ssrfValidation = validateUrlForSSRF(ipUrl, true);
    if (!ssrfValidation.valid) {
      throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
    }

    return requestFn(ipUrl);
  } catch (ipError) {
    logger.warn("IP fallback also failed", {
      originalUrl: portainerUrl,
      ipError: ipError.message,
    });
    throw originalError;
  }
}

const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 1;

/**
 * Make a request with retry on connection errors and automatic IP fallback if DNS fails
 * @param {Function} requestFn - Function that makes the axios request (receives URL as parameter)
 * @param {string} portainerUrl - Original Portainer URL
 * @returns {Promise<any>} - Response data
 */
async function requestWithIpFallback(requestFn, portainerUrl) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        logger.debug("Retrying Portainer request after connection error", {
          portainerUrl,
          attempt,
        });
      }
      return await requestFn(portainerUrl);
    } catch (error) {
      lastError = error;
      const isConnectionError =
        error.code === "ECONNREFUSED" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ECONNRESET" ||
        error.message === "socket hang up";
      if (!isConnectionError || attempt >= MAX_RETRIES) {
        break;
      }
    }
  }
  if (!isDnsError(lastError)) {
    throw lastError;
  }
  return tryIpFallback(requestFn, portainerUrl, lastError);
}

module.exports = {
  getIpFallbackConfig,
  createAxiosConfig,
  requestWithIpFallback,
  normalizeUrlForStorage,
};
