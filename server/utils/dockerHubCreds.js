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
 * @param {number} userId - User ID (required for per-user credentials)
 * @returns {Promise<{username: string|null, token: string|null}>}
 */
async function getDockerHubCreds(userId) {
  if (!userId) {
    logger.warn("getDockerHubCreds called without userId - returning null credentials");
    return { username: null, token: null };
  }

  // Check cache first (cache key includes userId)
  const cacheKey = `dockerhub_creds_${userId}`;
  const now = Date.now();
  if (cachedCreds && cachedCreds.userId === userId && now - cacheTimestamp < CACHE_TTL) {
    return { username: cachedCreds.username, token: cachedCreds.token };
  }

  try {
    // Get credentials from database
    const dbCreds = await getDockerHubCredentials(userId);
    if (dbCreds && dbCreds.username && dbCreds.token) {
      cachedCreds = {
        userId: userId,
        username: dbCreds.username,
        token: dbCreds.token,
      };
      cacheTimestamp = now;
      return { username: dbCreds.username, token: dbCreds.token };
    }
  } catch (error) {
    logger.error("Error fetching Docker Hub credentials from database:", { error });
  }

  // No credentials available
  cachedCreds = { userId: userId, username: null, token: null };
  cacheTimestamp = now;
  return { username: null, token: null };
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
