/**
 * Log Level Utility
 * Manages logging level preference (info/debug)
 * Stores preference in database and provides getter/setter
 */

const { getSetting, setSetting } = require("../db/database");

const LOG_LEVEL_KEY = "log_level";
const DEFAULT_LOG_LEVEL = "info";

// Don't use logger here to avoid circular dependency
// Use console.error directly for rare error cases
function logError(message, error) {
  // Only log to console to avoid circular dependency
  // These errors are rare and only occur during initialization
  if (process.env.NODE_ENV !== "production") {
    console.error(`[logLevel] ${message}`, error?.message || error);
  }
}

/**
 * Get current log level
 * @returns {Promise<string>} - 'info' or 'debug'
 */
async function getLogLevel() {
  try {
    const level = await getSetting(LOG_LEVEL_KEY);
    return level || DEFAULT_LOG_LEVEL;
  } catch (err) {
    // Don't use logger to avoid circular dependency
    logError("Error getting log level", err);
    return DEFAULT_LOG_LEVEL;
  }
}

/**
 * Set log level
 * @param {string} level - 'info' or 'debug'
 * @returns {Promise<void>}
 */
async function setLogLevel(level) {
  if (level !== "info" && level !== "debug") {
    throw new Error('Log level must be "info" or "debug"');
  }
  try {
    await setSetting(LOG_LEVEL_KEY, level);
  } catch (err) {
    // Don't use logger to avoid circular dependency
    logError("Error setting log level", err);
    throw err;
  }
}

/**
 * Check if debug logging is enabled
 * @returns {Promise<boolean>}
 */
async function isDebugEnabled() {
  const level = await getLogLevel();
  return level === "debug";
}

// Cache for log level (updated when changed)
let cachedLogLevel = DEFAULT_LOG_LEVEL;
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get cached log level (faster, but may be stale)
 * @returns {string} - 'info' or 'debug'
 */
function getCachedLogLevel() {
  const now = Date.now();
  if (now - lastCacheUpdate > CACHE_TTL) {
    // Cache expired, but we'll use the cached value anyway for performance
    // The cache will be updated when setLogLevel is called
  }
  return cachedLogLevel;
}

/**
 * Update cached log level
 * @param {string} level - 'info' or 'debug'
 */
function updateCachedLogLevel(level) {
  cachedLogLevel = level;
  lastCacheUpdate = Date.now();
}

/**
 * Initialize cached log level from database
 */
async function initializeLogLevel() {
  try {
    const level = await getLogLevel();
    updateCachedLogLevel(level);
  } catch (err) {
    // Don't use logger to avoid circular dependency
    logError("Error initializing log level", err);
  }
}

module.exports = {
  getLogLevel,
  setLogLevel,
  isDebugEnabled,
  getCachedLogLevel,
  updateCachedLogLevel,
  initializeLogLevel,
  DEFAULT_LOG_LEVEL,
};
