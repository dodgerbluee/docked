/**
 * Settings Controller
 * Handles HTTP requests for application settings
 */

const { getSetting, setSetting } = require("../db/index");
const { DEFAULT_BLOCKED_PATTERNS } = require("../constants/blocklistDefaults");
const logger = require("../utils/logger");

const COLOR_SCHEME_KEY = "color_scheme";
const DEFAULT_COLOR_SCHEME = "system";
const REFRESHING_TOGGLES_ENABLED_KEY = "refreshing_toggles_enabled";
const DEFAULT_REFRESHING_TOGGLES_ENABLED = false;
const DISALLOWED_CONTAINERS_KEY = "disallowed_containers";

/**
 * Get color scheme preference
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

async function getColorSchemeHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const colorScheme = await getSetting(COLOR_SCHEME_KEY, userId);
    return res.json({
      success: true,
      colorScheme: colorScheme || DEFAULT_COLOR_SCHEME,
    });
  } catch (error) {
    logger.error("Error getting color scheme:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get color scheme",
    });
  }
}

/**
 * Set color scheme preference
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

async function setColorSchemeHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { colorScheme } = req.body;

    if (!colorScheme || !["system", "light", "dark"].includes(colorScheme)) {
      return res.status(400).json({
        success: false,
        error: 'colorScheme must be "system", "light", or "dark"',
      });
    }

    await setSetting(COLOR_SCHEME_KEY, colorScheme, userId);

    return res.json({
      success: true,
      colorScheme,
      message: `Color scheme set to ${colorScheme}`,
    });
  } catch (error) {
    logger.error("Error setting color scheme:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to set color scheme",
    });
  }
}

/**
 * Get refreshing toggles enabled setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

async function getRefreshingTogglesEnabledHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const value = await getSetting(REFRESHING_TOGGLES_ENABLED_KEY, userId);
    // Convert string to boolean, default to false if not set
    const enabled =
      value === null || value === undefined
        ? DEFAULT_REFRESHING_TOGGLES_ENABLED
        : value === "true" || value === true;
    return res.json({
      success: true,
      enabled,
    });
  } catch (error) {
    logger.error("Error getting refreshing toggles enabled:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get refreshing toggles enabled",
    });
  }
}

/**
 * Set refreshing toggles enabled setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

async function setRefreshingTogglesEnabledHandler(req, res, _next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean value",
      });
    }

    await setSetting(REFRESHING_TOGGLES_ENABLED_KEY, enabled.toString(), userId);

    return res.json({
      success: true,
      enabled,
      message: `Refreshing toggles ${enabled ? "enabled" : "disabled"}`,
    });
  } catch (error) {
    logger.error("Error setting refreshing toggles enabled:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to set refreshing toggles enabled",
    });
  }
}

/**
 * Get disallowed containers list
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getDisallowedContainersHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const raw = await getSetting(DISALLOWED_CONTAINERS_KEY, userId);
    const containers = raw ? JSON.parse(raw) : null; // null = use client-side defaults
    return res.json({ success: true, containers, defaultPatterns: DEFAULT_BLOCKED_PATTERNS });
  } catch (error) {
    logger.error("Error getting disallowed containers:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get disallowed containers",
    });
  }
}

/**
 * Set disallowed containers list
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function setDisallowedContainersHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const { containers } = req.body;
    if (!Array.isArray(containers)) {
      return res.status(400).json({ success: false, error: "containers must be an array" });
    }

    const MAX_ITEMS = 1000;
    const MAX_ITEM_LENGTH = 255;

    const original = containers;
    let filtered = original
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().substring(0, MAX_ITEM_LENGTH));

    if (filtered.length > MAX_ITEMS) {
      filtered = filtered.slice(0, MAX_ITEMS);
    }

    const droppedCount = original.length - filtered.length;
    if (droppedCount > 0) {
      logger.warn("setDisallowedContainersHandler: dropped invalid or oversized items", {
        userId,
        droppedCount,
      });
    }

    await setSetting(DISALLOWED_CONTAINERS_KEY, JSON.stringify(filtered), userId);
    return res.json({ success: true, containers: filtered });
  } catch (error) {
    logger.error("Error setting disallowed containers:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to set disallowed containers",
    });
  }
}

module.exports = {
  getColorSchemeHandler,
  setColorSchemeHandler,
  getRefreshingTogglesEnabledHandler,
  setRefreshingTogglesEnabledHandler,
  getDisallowedContainersHandler,
  setDisallowedContainersHandler,
};
