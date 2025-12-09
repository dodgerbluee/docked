/**
 * Tracked Apps Check Job Handler
 * Handles batch jobs for checking tracked app updates
 */

const JobHandler = require("../JobHandler");
const trackedAppService = require("../../trackedAppService");
const { getAllTrackedApps } = require("../../../db/index");

class TrackedAppsCheckHandler extends JobHandler {
  getJobType() {
    return "tracked-apps-check";
  }

  getDisplayName() {
    return "Tracked Apps Scan";
  }

  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }

  async execute(context) {
    const { logger, userId } = context;
    const result = {
      itemsChecked: 0,
      itemsUpdated: 0,
      logs: [],
      error: null,
    };

    if (!userId) {
      const error = new Error("userId is required for tracked apps check batch job");
      logger.error("Tracked apps check failed", { error: error.message });
      throw error;
    }

    try {
      logger.info("Starting tracked apps check batch job", { userId });

      // Get tracked apps for this specific user
      const apps = await getAllTrackedApps(userId);
      logger.debug(`Found ${apps.length} tracked apps for user ${userId}`);

      if (apps.length === 0) {
        logger.info("No tracked apps found for user", { userId });
        return result;
      }

      // Check for updates (checkAllTrackedApps will use each app's user_id for Docker Hub credentials)
      // Pass batch logger to capture upgrade logs
      const results = await trackedAppService.checkAllTrackedApps(apps, logger);

      // Extract metrics
      result.itemsChecked = apps.length;
      result.itemsUpdated = results.filter((r) => r.hasUpdate).length;

      logger.info("Tracked apps check completed successfully", {
        appsChecked: result.itemsChecked,
        appsWithUpdates: result.itemsUpdated,
        userId,
      });

      return result;
    } catch (err) {
      const errorMessage = err.message || "Failed to check tracked apps";

      logger.error("Tracked apps check failed", {
        error: errorMessage,
        stack: err.stack,
        userId,
      });

      result.error = new Error(errorMessage);

      throw result.error;
    }
  }
}

module.exports = TrackedAppsCheckHandler;
