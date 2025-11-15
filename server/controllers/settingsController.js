/**
 * Settings Controller
 * Handles HTTP requests for application settings
 * Uses: ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const { sendSuccess } = require('../utils/responseHelper');
const { ValidationError } = require('../domain/errors');

// Resolve dependencies from container
const settingsRepository = container.resolve('settingsRepository');

const COLOR_SCHEME_KEY = "color_scheme";
const DEFAULT_COLOR_SCHEME = "system";

/**
 * Get color scheme preference
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getColorSchemeHandler(req, res, next) {
  try {
    const colorScheme = await settingsRepository.get(COLOR_SCHEME_KEY);
    sendSuccess(res, {
      colorScheme: colorScheme || DEFAULT_COLOR_SCHEME,
    });
  } catch (error) {
    next(error);
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

    // Validation is handled by middleware, but double-check
    if (!colorScheme || !['system', 'light', 'dark', 'auto'].includes(colorScheme)) {
      throw new ValidationError(
        'colorScheme must be "system", "light", "dark", or "auto"',
        'colorScheme',
        colorScheme
      );
    }

    await settingsRepository.set(COLOR_SCHEME_KEY, colorScheme);
    
    sendSuccess(res, {
      colorScheme,
      message: `Color scheme set to ${colorScheme}`,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getColorSchemeHandler,
  setColorSchemeHandler,
};
