/**
 * Docker Hub Pull Job Handler
 * Handles batch jobs for pulling container update information from Docker Hub
 */

const JobHandler = require("../JobHandler");
const containerService = require("../../containerService");

class DockerHubPullHandler extends JobHandler {
  getJobType() {
    return "docker-hub-pull";
  }

  getDisplayName() {
    return "Docker Hub Scan";
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
      const error = new Error("userId is required for Docker Hub pull batch job");
      logger.error("Docker Hub pull failed", { error: error.message });
      throw error;
    }

    try {
      logger.info("Starting Docker Hub pull batch job", { userId });

      // Execute the container service pull - pass batch logger to capture upgrade logs
      const serviceResult = await containerService.getAllContainersWithUpdates(
        true,
        null,
        userId,
        logger
      );

      // Extract metrics
      result.itemsChecked = serviceResult.containers?.length || 0;
      result.itemsUpdated = serviceResult.containers?.filter((c) => c.hasUpdate).length || 0;

      logger.info("Docker Hub pull completed successfully", {
        containersChecked: result.itemsChecked,
        containersUpdated: result.itemsUpdated,
        userId,
      });

      return result;
    } catch (err) {
      // Handle rate limit errors with partial results gracefully
      if (err.isRateLimitExceeded && err.partialResults) {
        // Partial results available - return them instead of failing completely
        result.itemsChecked = err.processedCount || err.partialResults.length || 0;
        result.itemsUpdated = err.partialResults.filter((c) => c.hasUpdate).length || 0;
        result.partialSuccess = true;
        result.retryAfter = err.retryAfter;

        logger.warn("Docker Hub pull hit rate limit but processed partial results", {
          containersChecked: result.itemsChecked,
          containersUpdated: result.itemsUpdated,
          totalContainers: err.totalCount,
          retryAfter: err.retryAfter,
          userId,
        });

        // Check if credentials exist to customize message
        let defaultMessage = `Docker Hub rate limit exceeded. Processed ${result.itemsChecked} of ${err.totalCount || "unknown"} containers. Please wait ${err.retryAfter || "a few"} seconds before trying again.`;
        if (userId) {
          const { getDockerHubCreds } = require("../../../utils/dockerHubCreds");
          const creds = await getDockerHubCreds(userId);
          if (!creds.username || !creds.token) {
            defaultMessage +=
              " Or configure Docker Hub credentials in Settings for higher rate limits.";
          }
        } else {
          defaultMessage +=
            " Or configure Docker Hub credentials in Settings for higher rate limits.";
        }

        result.error = new Error(defaultMessage);
        result.error.isRateLimitExceeded = true;
        result.error.retryAfter = err.retryAfter;

        // Return partial results instead of throwing
        return result;
      }

      // Check if credentials exist to customize message
      let defaultMessage =
        "Docker Hub rate limit exceeded. Please wait a few minutes before trying again.";
      if (userId) {
        const { getDockerHubCreds } = require("../../../utils/dockerHubCreds");
        const creds = await getDockerHubCreds(userId);
        if (!creds.username || !creds.token) {
          defaultMessage +=
            " Or configure Docker Hub credentials in Settings for higher rate limits.";
        }
      } else {
        defaultMessage +=
          " Or configure Docker Hub credentials in Settings for higher rate limits.";
      }

      const errorMessage =
        err.isRateLimitExceeded || err.message?.includes("rate limit")
          ? err.message || defaultMessage
          : err.message || "Failed to pull container data";

      logger.error("Docker Hub pull failed", {
        error: errorMessage,
        stack: err.stack,
        userId,
      });

      result.error = new Error(errorMessage);
      result.error.isRateLimitExceeded = err.isRateLimitExceeded || false;

      throw result.error;
    }
  }
}

module.exports = DockerHubPullHandler;
