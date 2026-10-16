/**
 * Tracked App Controller
 * Handles tracked app-related HTTP requests
 */

const logger = require("../utils/logger");
const { getTrackedAppUpgradeHistory, getTrackedAppUpgradeHistoryStats } = require("../db");

/**
 * Get upgrade history for tracked apps
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getTrackedAppHistory(req, res) {
  try {
    const userId = req.user.id;
    const { limit, offset, appName, provider, status } = req.query;

    const options = {};
    if (limit) options.limit = parseInt(limit, 10);
    if (offset) options.offset = parseInt(offset, 10);
    if (appName) options.appName = appName;
    if (provider) options.provider = provider;
    if (status) options.status = status;

    const history = await getTrackedAppUpgradeHistory(userId, options);

    res.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error) {
    logger.error("Error fetching tracked app upgrade history:", { error, userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: "Failed to fetch tracked app upgrade history",
    });
  }
}

/**
 * Get tracked app upgrade history statistics
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getTrackedAppHistoryStats(req, res) {
  try {
    const userId = req.user.id;

    const stats = await getTrackedAppUpgradeHistoryStats(userId);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    logger.error("Error fetching tracked app upgrade history stats:", {
      error,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch tracked app upgrade history statistics",
    });
  }
}

module.exports = {
  getTrackedAppHistory,
  getTrackedAppHistoryStats,
};
