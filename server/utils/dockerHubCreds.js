/**
 * Docker Hub Credentials Utility
 * Gets Docker Hub credentials from database
 * Note: Environment variables are no longer used. Configure credentials through the Settings UI.
 */

const { getDockerHubCredentials } = require("../db/database");
const logger = require("./logger");

// Cache credentials in memory to avoid DB queries on every request
let cachedCreds = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get Docker Hub credentials from database
 * Uses in-memory cache to minimize database queries
 * @returns {Promise<{username: string|null, token: string|null}>}
 */
async function getDockerHubCreds() {
  // Check cache first
  const now = Date.now();
  if (cachedCreds && now - cacheTimestamp < CACHE_TTL) {
    return cachedCreds;
  }

  try {
    // Get credentials from database
    const dbCreds = await getDockerHubCredentials();
    if (dbCreds && dbCreds.username && dbCreds.token) {
      cachedCreds = {
        username: dbCreds.username,
        token: dbCreds.token,
      };
      cacheTimestamp = now;
      return cachedCreds;
    }
  } catch (error) {
    logger.error("Error fetching Docker Hub credentials from database:", error.message);
  }

  // No credentials available
  cachedCreds = { username: null, token: null };
  cacheTimestamp = now;
  return cachedCreds;
}

/**
 * Clear the credentials cache
 * Call this after updating credentials in the database
 */
function clearCache() {
  cachedCreds = null;
  cacheTimestamp = 0;
}

module.exports = {
  getDockerHubCreds,
  clearCache,
};
