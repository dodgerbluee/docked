/**
 * Docker Hub Credentials Utility
 * Gets Docker Hub credentials from database
 * Note: Environment variables are no longer used. Configure credentials through the Settings UI.
 */

const { getDockerHubCredentials } = require("../db/index");
const logger = require("./logger");

// Cache credentials in memory to avoid DB queries on every request
// Store cache as a single object to avoid race conditions
let cache = null;
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
  const now = Date.now();
  // Read cache atomically by storing reference
  const currentCache = cache;
  if (currentCache && currentCache.userId === userId && now - currentCache.timestamp < CACHE_TTL) {
    return { username: currentCache.username, token: currentCache.token };
  }

  try {
    // Get credentials from database
    const dbCreds = await getDockerHubCredentials(userId);
    if (dbCreds && dbCreds.username && dbCreds.token) {
      // Atomic update: assign entire cache object at once
      // eslint-disable-next-line require-atomic-updates -- Cache update is intentional
      cache = {
        userId,
        username: dbCreds.username,
        token: dbCreds.token,
        timestamp: now,
      };
      return { username: dbCreds.username, token: dbCreds.token };
    }
  } catch (error) {
    logger.error("Error fetching Docker Hub credentials from database:", { error });
  }

  // No credentials available - atomic update
  // eslint-disable-next-line require-atomic-updates -- Cache update is intentional
  cache = { userId, username: null, token: null, timestamp: now };
  return { username: null, token: null };
}

/**
 * Clear the credentials cache
 * Call this after updating credentials in the database
 */
function clearCache() {
  cache = null;
}

module.exports = {
  getDockerHubCreds,
  clearCache,
};
