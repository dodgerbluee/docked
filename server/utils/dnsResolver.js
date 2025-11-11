/**
 * DNS Resolution Utility
 * Resolves URLs to IP addresses for fallback when DNS fails
 */

const dns = require('dns').promises;
const { URL } = require('url');

/**
 * Resolve a URL to its IP address
 * @param {string} urlString - URL to resolve (e.g., "https://portainer.example.com")
 * @returns {Promise<string|null>} - IP address or null if resolution fails
 */
async function resolveUrlToIp(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    
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
    console.error(`Failed to resolve ${urlString} to IP:`, error.message);
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
    const originalHostname = url.hostname;
    
    // Replace hostname with IP, preserving port if present
    url.hostname = ipAddress;
    
    // If original URL had a port, keep it
    // Otherwise, use default ports (80 for http, 443 for https)
    if (!url.port) {
      if (url.protocol === 'https:') {
        url.port = '443';
      } else if (url.protocol === 'http:') {
        url.port = '80';
      }
    }
    
    return url.toString();
  } catch (error) {
    console.error(`Failed to convert URL ${originalUrl} with IP ${ipAddress}:`, error.message);
    return originalUrl;
  }
}

/**
 * Try to detect the actual backend IP when behind a proxy
 * Tests common IPs in the same subnet as the proxy IP
 * @param {string} proxyIp - Proxy IP address (e.g., "192.168.69.10")
 * @param {string} originalUrl - Original URL to test against
 * @param {string} apiKey - API key for authentication (optional)
 * @param {string} username - Username for authentication (optional)
 * @param {string} password - Password for authentication (optional)
 * @param {string} authType - Authentication type
 * @returns {Promise<string|null>} - Detected backend IP or null
 */
async function detectBackendIp(proxyIp, originalUrl, apiKey = null, username = null, password = null, authType = 'apikey') {
  try {
    const axios = require('axios');
    const originalUrlObj = new URL(originalUrl);
    const protocol = originalUrlObj.protocol;
    
    // Extract subnet from proxy IP (e.g., "192.168.69" from "192.168.69.10")
    const ipParts = proxyIp.split('.');
    if (ipParts.length !== 4) {
      return null; // Invalid IP format
    }
    
    const subnet = ipParts.slice(0, 3).join('.');
    const proxyLastOctet = parseInt(ipParts[3]);
    
    // Generate list of IPs to test:
    // 1. Common backend IPs (proxy + 40, +50, +20, +30, etc.)
    // 2. IPs near the proxy IP
    const testIps = [];
    const offsets = [40, 50, 20, 30, 10, 5, 15, 25, 35, 45, 100, 200];
    
    for (const offset of offsets) {
      const testIp = `${subnet}.${proxyLastOctet + offset}`;
      // Skip the proxy IP itself
      if (testIp !== proxyIp) {
        testIps.push(testIp);
      }
    }
    
    // Also try some common backend IPs regardless of proxy IP
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
    
    // Try common Portainer ports
    const portsToTry = [9000, 9443, 80, 443];
    
    // Prepare auth headers
    const getAuthHeaders = () => {
      if (authType === 'apikey' && apiKey) {
        return {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        };
      } else if (username && password) {
        // For password auth, we'd need to authenticate first
        // For now, just return basic auth structure
        return {
          'Content-Type': 'application/json',
        };
      }
      return {
        'Content-Type': 'application/json',
      };
    };
    
    // Test each IP and port combination
    for (const testIp of testIps) {
      for (const port of portsToTry) {
        const testProtocol = (port === 443 || port === 9443) ? 'https:' : 'http:';
        const testUrl = `${testProtocol}//${testIp}:${port}`;
        
        try {
          // Try to authenticate or make a simple API call
          if (authType === 'apikey' && apiKey) {
            // Test API key auth
            const response = await axios.get(
              `${testUrl}/api/endpoints`,
              {
                headers: getAuthHeaders(),
                timeout: 2000, // Short timeout for testing
              }
            );
            // If we get a response (even 401 means the server is there), this might be the backend
            if (response.status === 200 || response.status === 401) {
              console.log(`Detected potential backend IP: ${testIp}:${port} (status: ${response.status})`);
              return testIp;
            }
          } else if (username && password) {
            // Try password auth
            try {
              const authResponse = await axios.post(
                `${testUrl}/api/auth`,
                { username, password },
                {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 2000,
                }
              );
              if (authResponse.data.jwt || authResponse.data.token) {
                console.log(`Detected backend IP via authentication: ${testIp}:${port}`);
                return testIp;
              }
            } catch (authErr) {
              // If we get 401, the server exists but credentials might be wrong
              // If we get connection refused, try next IP
              if (authErr.code === 'ECONNREFUSED' || authErr.code === 'ETIMEDOUT') {
                continue;
              }
              // 401 means server is there, might be the backend
              if (authErr.response?.status === 401) {
                console.log(`Detected potential backend IP: ${testIp}:${port} (auth failed but server exists)`);
                return testIp;
              }
            }
          }
        } catch (error) {
          // Connection refused or timeout - not this IP, continue
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            continue;
          }
          // Other errors might mean the server exists
          if (error.response) {
            console.log(`Detected potential backend IP: ${testIp}:${port} (got response: ${error.response.status})`);
            return testIp;
          }
        }
      }
    }
    
    return null; // Could not detect backend IP
  } catch (error) {
    console.error(`Error detecting backend IP:`, error.message);
    return null;
  }
}

module.exports = {
  resolveUrlToIp,
  urlWithIp,
  detectBackendIp,
};

