/**
 * DNS Resolution Utility
 * Resolves URLs to IP addresses for fallback when DNS fails
 */

const dns = require("dns").promises;
const { URL } = require("url");
const logger = require("./logger");

/**
 * Resolve a URL to its IP address
 * @param {string} urlString - URL to resolve (e.g., "https://portainer.example.com")
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

/**
 * Convert a URL to use an IP address instead of hostname
 * @param {string} originalUrl - Original URL with hostname
 * @param {string} ipAddress - IP address to use
 * @returns {string} - URL with IP address
 */
function urlWithIp(originalUrl, ipAddress) {
  try {
    const url = new URL(originalUrl);

    // Replace hostname with IP, preserving port if present
    url.hostname = ipAddress;

    // If original URL had a port, keep it
    // Otherwise, use default ports (80 for http, 443 for https)
    if (!url.port) {
      if (url.protocol === "https:") {
        url.port = "443";
      } else if (url.protocol === "http:") {
        url.port = "80";
      }
    }

    return url.toString();
  } catch (error) {
    logger.error(`Failed to convert URL ${originalUrl} with IP ${ipAddress}:`, { error });
    return originalUrl;
  }
}

/**
 * Generate list of test IPs based on proxy IP
 * @param {string} proxyIp - Proxy IP address
 * @returns {Array<string>} - Array of test IPs
 */
function generateTestIps(proxyIp) {
  const ipParts = proxyIp.split(".");
  if (ipParts.length !== 4) {
    return [];
  }

  const subnet = ipParts.slice(0, 3).join(".");
  const proxyLastOctet = parseInt(ipParts[3], 10);
  const testIps = [];
  const offsets = [40, 50, 20, 30, 10, 5, 15, 25, 35, 45, 100, 200];

  for (const offset of offsets) {
    const testIp = `${subnet}.${proxyLastOctet + offset}`;
    if (testIp !== proxyIp) {
      testIps.push(testIp);
    }
  }

  const commonBackendIps = [
    `${subnet}.50`,
    `${subnet}.20`,
    `${subnet}.30`,
    `${subnet}.100`,
    `${subnet}.200`,
  ];

  for (const ip of commonBackendIps) {
    if (ip !== proxyIp && !testIps.includes(ip)) {
      testIps.push(ip);
    }
  }

  return testIps;
}

/**
 * Build authentication headers
 * @param {string} authType - Authentication type
 * @param {string} apiKey - API key
 * @param {string} _username - Username (unused)
 * @param {string} _password - Password (unused)
 * @returns {Object} - Headers object
 */
function buildAuthHeaders(authType, apiKey, _username, _password) {
  if (authType === "apikey" && apiKey) {
    return {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    };
  }
  return {
    "Content-Type": "application/json",
  };
}

/**
 * Test IP with API key authentication
 * @param {string} testUrl - Test URL
 * @param {Object} headers - Request headers
 * @returns {Promise<Object|null>} - Response status or null
 */
async function testIpWithApiKey(testUrl, headers) {
  const axios = require("axios");
  try {
    const response = await axios.get(`${testUrl}/api/endpoints`, {
      headers,
      timeout: 2000,
    });
    if (response.status === 200 || response.status === 401) {
      return { status: response.status };
    }
  } catch (error) {
    if (error.response) {
      return { status: error.response.status };
    }
  }
  return null;
}

/**
 * Test IP with password authentication
 * @param {string} testUrl - Test URL
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<boolean>} - True if successful
 */
async function testIpWithPassword(testUrl, username, password) {
  const axios = require("axios");
  try {
    const authResponse = await axios.post(
      `${testUrl}/api/auth`,
      { username, password },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 2000,
      },
    );
    return Boolean(authResponse.data.jwt || authResponse.data.token);
  } catch (authErr) {
    if (authErr.code === "ECONNREFUSED" || authErr.code === "ETIMEDOUT") {
      return false;
    }
    return authErr.response?.status === 401;
  }
}

/**
 * Test a single IP address
 * @param {string} testIp - IP to test
 * @param {Object} options - Options object
 * @param {Array<number>} options.portsToTry - Ports to try
 * @param {string} options.authType - Authentication type
 * @param {Object} options.headers - Request headers
 * @param {string} options.username - Username
 * @param {string} options.password - Password
 * @returns {Promise<string|null>} - Detected IP or null
 */
async function testIpAddress(testIp, options) {
  const { portsToTry, authType, headers, username, password } = options;
  for (const port of portsToTry) {
    const testProtocol = port === 443 || port === 9443 ? "https:" : "http:";
    const testUrl = `${testProtocol}//${testIp}:${port}`;

    let result = null;
    if (authType === "apikey" && headers["X-API-Key"]) {
      result = await testIpWithApiKey(testUrl, headers);
    } else if (username && password) {
      const success = await testIpWithPassword(testUrl, username, password);
      result = success ? { status: 200 } : null;
    }

    if (result) {
      logger.warn(
        `⚠️  Detected potential backend IP: ${testIp}:${port} (status: ${result.status}). ` +
          `This is a heuristic - please verify this is the correct Portainer instance IP in Settings > Portainer Instances.`,
        {
          detectedIp: testIp,
          port,
          status: result.status,
          warning: "Auto-detected IP may be incorrect - verify manually",
        },
      );
      return testIp;
    }
  }
  return null;
}

/**
 * Try to detect the actual backend IP when behind a proxy
 * Tests common IPs in the same subnet as the proxy IP
 * @param {string} proxyIp - Proxy IP address (e.g., "192.168.69.10")
 * @param {string} originalUrl - Original URL to test against
 * @param {Object} options - Options object
 * @param {string} options.apiKey - API key for authentication (optional)
 * @param {string} options.username - Username for authentication (optional)
 * @param {string} options.password - Password for authentication (optional)
 * @param {string} options.authType - Authentication type
 * @returns {Promise<string|null>} - Detected backend IP or null
 */
async function detectBackendIp(proxyIp, originalUrl, options = {}) {
  const {
    apiKey = null,
    username = null,
    password = null,
    authType = "apikey",
  } = options;

  try {
    const testIps = generateTestIps(proxyIp);
    if (testIps.length === 0) {
      return null;
    }

    logger.debug(`Testing ${testIps.length} potential backend IPs for proxy ${proxyIp}`, {
      proxyIp,
      testIps: testIps.slice(0, 10),
      note: "This is a heuristic - detected IP may be incorrect. Verify in Settings > Portainer Instances.",
    });

    const portsToTry = [9000, 9443, 80, 443];
    const headers = buildAuthHeaders(authType, apiKey, username, password);

    for (const testIp of testIps) {
      const detected = await testIpAddress(testIp, {
        portsToTry,
        authType,
        headers,
        username,
        password,
      });
      if (detected) {
        return detected;
      }
    }

    return null;
  } catch (error) {
    logger.error(`Error detecting backend IP:`, { error });
    return null;
  }
}

module.exports = {
  resolveUrlToIp,
  urlWithIp,
  detectBackendIp,
};
