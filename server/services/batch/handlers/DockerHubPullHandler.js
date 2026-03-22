/**
 * Docker Hub Pull Job Handler
 * Handles batch jobs for pulling container update information from Docker Hub
 */

const JobHandler = require("../JobHandler");
const containerService = require("../../containerService");
const runnerDockerService = require("../../runnerDockerService");
const imageUpdateService = require("../../imageUpdateService");
const imageRepoParser = require("../../utils/imageRepoParser");
const { upsertContainerWithVersion } = require("../../../db/containers");
const { getEnabledRunnersWithKeysByUser } = require("../../../db/runners");
const containerNotificationService = require("../../containerNotificationService");
const { getContainersWithUpdates } = require("../../../db/index");

/**
 * Scan all containers on a single runner for image updates.
 * Mirrors the Portainer scan but routes through runnerDockerService.
 */
async function scanRunnerContainers(runner, userId, batchLogger) {
  let checked = 0;
  let updated = 0;

  let containers;
  try {
    containers = await runnerDockerService.getContainers(runner.url, null, runner.api_key);
  } catch (err) {
    batchLogger.warn("Runner unreachable during image scan, skipping", {
      runnerId: runner.id,
      runnerName: runner.name,
      error: err.message,
    });
    return { checked: 0, updated: 0 };
  }

  for (const container of containers) {
    try {
      const details = await runnerDockerService.getContainerDetails(
        runner.url,
        null,
        container.Id,
        runner.api_key
      );
      const imageName = details.Config?.Image || container.Image;
      if (!imageName) continue;

      const updateInfo = await imageUpdateService.checkImageUpdates(
        imageName,
        details,
        null,
        null,
        userId
      );

      const parsed = imageRepoParser.parseImageName(imageName);
      const imageTag = imageName.includes(":") ? imageName.split(":").pop() : "latest";
      const containerName =
        (container.Names?.[0] || "").replace(/^\//, "") || container.Id.substring(0, 12);
      const stackName = details.Config?.Labels?.["com.docker.compose.project"] || null;

      await upsertContainerWithVersion(
        userId,
        null,
        {
          containerId: container.Id,
          containerName,
          endpointId: null,
          imageName,
          imageRepo: parsed.imageRepo,
          imageTag,
          status: container.Status || null,
          state: container.State || null,
          stackName,
          currentDigest: updateInfo.currentDigest || null,
          registry: parsed.registry,
          namespace: parsed.namespace,
          repository: parsed.repository,
        },
        updateInfo.hasUpdate
          ? {
              currentTag: updateInfo.currentTag || imageTag,
              latestTag: updateInfo.latestTag || imageTag,
              latestVersion: updateInfo.latestVersion || null,
              latestDigest: updateInfo.latestDigest || null,
              hasUpdate: true,
            }
          : null,
        runner.id
      );

      checked++;
      if (updateInfo.hasUpdate) updated++;
    } catch (err) {
      batchLogger.debug("Failed to scan runner container", {
        runnerId: runner.id,
        containerId: container.Id,
        error: err.message,
      });
    }
  }

  batchLogger.info("Runner image scan complete", {
    runnerId: runner.id,
    runnerName: runner.name,
    checked,
    updated,
  });

  return { checked, updated };
}

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

  // eslint-disable-next-line max-lines-per-function, complexity -- DockerHub pull execution requires comprehensive processing
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

      // Snapshot previous DB state for notification comparison (runners + portainer)
      const previousContainers = await getContainersWithUpdates(userId);

      // --- Portainer containers ---
      const serviceResult = await containerService.getAllContainersWithUpdates(
        true,
        null,
        userId,
        logger
      );

      // --- Runner containers ---
      const runners = await getEnabledRunnersWithKeysByUser(userId);
      const dockerRunners = runners.filter((r) => r.docker_enabled);
      let runnerChecked = 0;
      let runnerUpdated = 0;
      for (const runner of dockerRunners) {
        const counts = await scanRunnerContainers(runner, userId, logger);
        runnerChecked += counts.checked;
        runnerUpdated += counts.updated;
      }

      // Send Discord notifications for newly-detected updates across all backends
      const allCurrentContainers = await getContainersWithUpdates(userId);
      await containerNotificationService.sendContainerUpdateNotifications(
        allCurrentContainers,
        previousContainers,
        userId,
        logger
      );

      // Extract metrics
      result.itemsChecked = (serviceResult.containers?.length || 0) + runnerChecked;
      result.itemsUpdated =
        (serviceResult.containers?.filter((c) => c.hasUpdate).length || 0) + runnerUpdated;

      logger.info("Docker Hub pull completed successfully", {
        containersChecked: result.itemsChecked,
        containersUpdated: result.itemsUpdated,
        portainerContainers: serviceResult.containers?.length || 0,
        runnerContainers: runnerChecked,
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

        // Registry rate limit message
        const defaultMessage = `Registry rate limit exceeded. Processed ${result.itemsChecked} of ${err.totalCount || "unknown"} containers. Please wait ${err.retryAfter || "a few"} seconds before trying again. Tip: Run 'docker login' on your server for higher rate limits.`;

        result.error = new Error(defaultMessage);
        result.error.isRateLimitExceeded = true;
        result.error.retryAfter = err.retryAfter;

        // Return partial results instead of throwing
        return result;
      }

      // Check if credentials exist to customize message
      const defaultMessage =
        "Registry rate limit exceeded. Please wait a few minutes before trying again. Tip: Run 'docker login' on your server for higher rate limits.";

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
