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
const DISABLE_PORTAINER_PAGE_KEY = "disable_portainer_page";
const DEFAULT_DISABLE_PORTAINER_PAGE = false;
const DISABLE_TRACKED_APPS_PAGE_KEY = "disable_tracked_apps_page";
const DEFAULT_DISABLE_TRACKED_APPS_PAGE = false;

/**
 * Get color scheme preference
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getColorSchemeHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const colorScheme = await getSetting(COLOR_SCHEME_KEY, userId);
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

/**
 * Get disable portainer page setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDisablePortainerPageHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const value = await getSetting(DISABLE_PORTAINER_PAGE_KEY, userId);
    // Convert string to boolean, default to false if not set
    const disabled =
      value === null || value === undefined
        ? DEFAULT_DISABLE_PORTAINER_PAGE
        : value === "true" || value === true;
    res.json({
      success: true,
      disabled,
    });
  } catch (error) {
    logger.error("Error getting disable portainer page setting:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get disable portainer page setting",
    });
  }
}

/**
 * Set disable portainer page setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function setDisablePortainerPageHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { disabled } = req.body;

    if (typeof disabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "disabled must be a boolean value",
      });
    }

    await setSetting(DISABLE_PORTAINER_PAGE_KEY, disabled.toString(), userId);

    res.json({
      success: true,
      disabled,
      message: `Portainer page ${disabled ? "disabled" : "enabled"}`,
    });
  } catch (error) {
    logger.error("Error setting disable portainer page setting:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to set disable portainer page setting",
    });
  }
}

/**
 * Get disable tracked apps page setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDisableTrackedAppsPageHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const value = await getSetting(DISABLE_TRACKED_APPS_PAGE_KEY, userId);
    // Convert string to boolean, default to false if not set
    const disabled =
      value === null || value === undefined
        ? DEFAULT_DISABLE_TRACKED_APPS_PAGE
        : value === "true" || value === true;
    res.json({
      success: true,
      disabled,
    });
  } catch (error) {
    logger.error("Error getting disable tracked apps page setting:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get disable tracked apps page setting",
    });
  }
}

/**
 * Set disable tracked apps page setting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function setDisableTrackedAppsPageHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { disabled } = req.body;

    if (typeof disabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "disabled must be a boolean value",
      });
    }

    await setSetting(DISABLE_TRACKED_APPS_PAGE_KEY, disabled.toString(), userId);

    res.json({
      success: true,
      disabled,
      message: `Tracked Apps page ${disabled ? "disabled" : "enabled"}`,
    });
  } catch (error) {
    logger.error("Error setting disable tracked apps page setting:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to set disable tracked apps page setting",
    });
  }
}

module.exports = {
  getColorSchemeHandler,
  setColorSchemeHandler,
  getRefreshingTogglesEnabledHandler,
  setRefreshingTogglesEnabledHandler,
  getDisablePortainerPageHandler,
  setDisablePortainerPageHandler,
  getDisableTrackedAppsPageHandler,
  setDisableTrackedAppsPageHandler,
};
