/**
 * DNS Resolution Utility
 * Resolves URLs to IP addresses (used by the config import flow to record
 * the resolved IP of source instance URLs).
 */

const dns = require("dns").promises;
const { URL } = require("url");
const logger = require("./logger");

/**
 * Resolve a URL to its IP address
 * @param {string} urlString - URL to resolve (e.g., "https://example.com")
 * @returns {Promise<string|null>} - IP address or null if resolution fails
 */
async function resolveUrlToIp(urlString) {
  try {
    const url = new URL(urlString);
    const { hostname } = url;

    // Skip resolution for IP addresses
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\[?[0-9a-fA-F:]+]?$/.test(hostname)) {
      return hostname;
    }

    // Resolve hostname to IP
    const addresses = await dns.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      // Return the first IPv4 address
      return addresses[0];
    }

    return null;
  } catch (error) {
    logger.error(`Failed to resolve ${urlString} to IP:`, { error });
    return null;
  }
}

module.exports = {
  resolveUrlToIp,
};
