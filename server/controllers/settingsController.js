/**
 * Settings Controller
 * Handles HTTP requests for application settings
 */

const { getSetting, setSetting } = require('../db/database');
const logger = require('../utils/logger');

const COLOR_SCHEME_KEY = 'color_scheme';
const DEFAULT_COLOR_SCHEME = 'system';

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
    logger.error('Error getting color scheme:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get color scheme',
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

    if (!colorScheme || !['system', 'light', 'dark'].includes(colorScheme)) {
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
    logger.error('Error setting color scheme:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set color scheme',
    });
  }
}

module.exports = {
  getColorSchemeHandler,
  setColorSchemeHandler,
};

