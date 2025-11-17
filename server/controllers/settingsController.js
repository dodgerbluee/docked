/**
 * Settings Controller
 * Handles HTTP requests for application settings
 */

const { getSetting, setSetting } = require("../db/database");
const logger = require("../utils/logger");

const COLOR_SCHEME_KEY = "color_scheme";
const DEFAULT_COLOR_SCHEME = "system";
const REFRESHING_TOGGLES_ENABLED_KEY = "refreshing_toggles_enabled";
const DEFAULT_REFRESHING_TOGGLES_ENABLED = false;

/**
 * Get color scheme preference
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getColorSchemeHandler(req, res, next) {
  try {
    const colorScheme = await getSetting(COLOR_SCHEME_KEY);
    res.json({
      success: true,
      colorScheme: colorScheme || DEFAULT_COLOR_SCHEME,
    });
  } catch (error) {
    logger.error("Error getting color scheme:", error);
    res.status(500).json({
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
async function setColorSchemeHandler(req, res, next) {
  try {
    const { colorScheme } = req.body;

    if (!colorScheme || !["system", "light", "dark"].includes(colorScheme)) {
      return res.status(400).json({
        success: false,
        error: 'colorScheme must be "system", "light", or "dark"',
      });
    }

    await setSetting(COLOR_SCHEME_KEY, colorScheme);

    res.json({
      success: true,
      colorScheme,
      message: `Color scheme set to ${colorScheme}`,
    });
  } catch (error) {
    logger.error("Error setting color scheme:", error);
    res.status(500).json({
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
async function getRefreshingTogglesEnabledHandler(req, res, next) {
  try {
    const value = await getSetting(REFRESHING_TOGGLES_ENABLED_KEY);
    // Convert string to boolean, default to false if not set
    const enabled =
      value === null || value === undefined
        ? DEFAULT_REFRESHING_TOGGLES_ENABLED
        : value === "true" || value === true;
    res.json({
      success: true,
      enabled,
    });
  } catch (error) {
    logger.error("Error getting refreshing toggles enabled:", error);
    res.status(500).json({
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
async function setRefreshingTogglesEnabledHandler(req, res, next) {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean value",
      });
    }

    await setSetting(REFRESHING_TOGGLES_ENABLED_KEY, enabled.toString());

    res.json({
      success: true,
      enabled,
      message: `Refreshing toggles ${enabled ? "enabled" : "disabled"}`,
    });
  } catch (error) {
    logger.error("Error setting refreshing toggles enabled:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to set refreshing toggles enabled",
    });
  }
}

module.exports = {
  getColorSchemeHandler,
  setColorSchemeHandler,
  getRefreshingTogglesEnabledHandler,
  setRefreshingTogglesEnabledHandler,
};
