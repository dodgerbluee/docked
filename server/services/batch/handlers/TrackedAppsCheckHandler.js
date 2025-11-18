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
    const { logger } = context;
    const result = {
      itemsChecked: 0,
      itemsUpdated: 0,
      logs: [],
      error: null,
    };

    try {
      logger.info("Starting tracked apps check batch job");

      // Get all users and check tracked images for each user
      const users = await getAllUsers();
      logger.debug(`Found ${users.length} users to check tracked apps for`);

      let allImages = [];
      for (const user of users) {
        const images = await getAllTrackedImages(user.id);
        logger.debug(`Found ${images.length} tracked images for user ${user.username}`);
        allImages = allImages.concat(images);
      }

      logger.debug(`Total tracked images to check: ${allImages.length}`);

      // Check for updates
      const results = await trackedImageService.checkAllTrackedImages(allImages);

      // Extract metrics
      result.itemsChecked = allImages.length;
      result.itemsUpdated = results.filter((r) => r.hasUpdate).length;

      logger.info("Tracked apps check completed successfully", {
        appsChecked: result.itemsChecked,
        appsWithUpdates: result.itemsUpdated,
      });

      return result;
    } catch (err) {
      const errorMessage = err.message || "Failed to check tracked apps";

      logger.error("Tracked apps check failed", {
        error: errorMessage,
        stack: err.stack,
      });

      result.error = new Error(errorMessage);

      throw result.error;
    }
  }
}

module.exports = TrackedAppsCheckHandler;
