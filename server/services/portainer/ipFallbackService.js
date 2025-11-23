/**
 * Portainer IP Fallback Service
 *
 * Handles IP-based URL fallback for Portainer API requests when DNS is unavailable
 * (e.g., during nginx-proxy-manager upgrades). Extracted from portainerService to improve modularity.
 */

const axios = require("axios");
const https = require("https");
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
 * Make a request with automatic IP fallback if DNS fails
 * @param {Function} requestFn - Function that makes the axios request (receives URL as parameter)
 * @param {string} portainerUrl - Original Portainer URL
 * @returns {Promise<any>} - Response data
 */
async function requestWithIpFallback(requestFn, portainerUrl) {
  try {
    // Try with original URL first
    return await requestFn(portainerUrl);
  } catch (error) {
    // Check if error is DNS-related
    const isDnsError =
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ERR_NETWORK" ||
      error.message?.includes("getaddrinfo") ||
      (!error.response && error.request);

    if (!isDnsError) {
      // Not a DNS error, re-throw
      throw error;
    }

    // DNS failed - try IP fallback
    logger.info("DNS resolution failed, attempting IP fallback", {
      portainerUrl: portainerUrl,
      error: error.message,
    });

    try {
      // Resolve IP address from URL
      const ipUrl = await urlWithIp(portainerUrl);
      if (!ipUrl || ipUrl === portainerUrl) {
        // No IP available or same as original, throw original error
        throw error;
      }

      logger.info("Using IP fallback for Portainer request", {
        originalUrl: portainerUrl,
        ipUrl: ipUrl,
      });

      // Validate URL for SSRF (allow private IPs for user-configured Portainer instances)
      const ssrfValidation = validateUrlForSSRF(ipUrl, true);
      if (!ssrfValidation.valid) {
        throw new Error(`SSRF validation failed: ${ssrfValidation.error}`);
      }

      // Try request with IP URL
      return await requestFn(ipUrl);
    } catch (ipError) {
      // IP fallback also failed - throw original error
      logger.warn("IP fallback also failed", {
        originalUrl: portainerUrl,
        ipError: ipError.message,
      });
      throw error;
    }
  }
}

module.exports = {
  getIpFallbackConfig,
  createAxiosConfig,
  requestWithIpFallback,
  normalizeUrlForStorage,
};
