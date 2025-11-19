/**
 * Tracked Apps Check Job Handler
 * Handles batch jobs for checking tracked app updates
 */

const JobHandler = require("../JobHandler");
const trackedImageService = require("../../trackedImageService");
const { getAllTrackedImages, getAllUsers } = require("../../../db/database");

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

      // Get tracked images for this specific user
      const images = await getAllTrackedImages(userId);
      logger.debug(`Found ${images.length} tracked images for user ${userId}`);

      if (images.length === 0) {
        logger.info("No tracked images found for user", { userId });
        return result;
      }

      // Check for updates (checkAllTrackedImages will use each image's user_id for Docker Hub credentials)
      const results = await trackedImageService.checkAllTrackedImages(images);

      // Extract metrics
      result.itemsChecked = images.length;
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
