/**
 * Auto-Update Batch Handler
 *
 * Implements the batch job for automatic container upgrades based on intents.
 *
 * Flow:
 * 1. Fetch all enabled AutoUpdateIntents for all users
 * 2. For each user: fetch containers, run matching, check for updates
 * 3. For matched containers with updates: call upgradeSingleContainer()
 * 4. Record results to batch_runs table
 * 5. Send Discord notifications if enabled
 *
 * Key design:
 * - Reuses existing upgrade logic (upgradeSingleContainer)
 * - Upgrades happen sequentially within an intent (safe default)
 * - Notifications are opt-in per intent
 * - All results recorded for audit trail
 */

const JobHandler = require("../JobHandler");
const { listIntents } = require("../../../db/autoUpdateIntents");
const { getDatabase } = require("../../../db/connection");
const { getPortainerContainersWithUpdates, getAllPortainerInstances } = require("../../../db/index");
const containerUpgradeService = require("../../containerUpgradeService");
const intentMatchingService = require("../../intentMatchingService");
const portainerService = require("../../portainerService");

class AutoUpdateHandler extends JobHandler {
  getJobType() {
    return "auto-update";
  }

  getDisplayName() {
    return "Auto-Update Containers";
  }

  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60, // Default: check every hour
    };
  }

  /**
   * Execute auto-updates for a specific intent
   *
   * Finds containers matched by this intent, checks for updates,
   * and upgrades those with available updates.
   *
   * @param {Object} params - Execution parameters
   * @param {Object} params.intent - AutoUpdateIntent to execute
   * @param {Array} params.containers - All containers available
   * @param {Array} params.portainerInstances - All Portainer instances (for auth)
   * @param {number} params.userId - User ID (for auth and logging)
   * @param {Object} params.logger - Logger instance for batch job
   * @returns {Promise<Object>} - { success, upgradedCount, failedCount, results }
   */
  // eslint-disable-next-line max-lines-per-function -- Complex upgrade orchestration logic
  async executeIntent(params) {
    const { intent, containers, portainerInstances, userId, logger } = params;

    const results = {
      intentId: intent.id,
      intentDescription: intent.description || "Unnamed intent",
      upgradedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      upgrades: [],
    };

    try {
      // Find containers matched by this intent
      const matchedContainers = containers.filter((container) =>
        intentMatchingService.matchesIntent(intent, container)
      );

      if (matchedContainers.length === 0) {
        logger?.debug(`[Intent ${intent.id}] No containers matched`, {
          description: intent.description,
        });
        return results; // No containers to upgrade
      }

      logger?.info(`[Intent ${intent.id}] Found ${matchedContainers.length} matched containers`, {
        description: intent.description,
        containerNames: matchedContainers.map((c) => c.containerName || c.container_name),
      });

      // Process each matched container sequentially (safe default)
      for (const container of matchedContainers) {
        // Support both camelCase and snake_case field names
        const containerName = container.containerName || container.container_name;
        const containerId = container.containerId || container.container_id;
        const imageRepo = container.imageRepo || container.image_repo;
        const imageName = container.imageName || container.image_name;
        const endpointId = container.endpointId || container.endpoint_id;
        const portainerInstanceId = container.portainerInstanceId || container.portainer_instance_id;
        const hasUpdate = container.hasUpdate || container.has_update;

        try {
          // Check if container has an update available
          if (!hasUpdate) {
            logger?.debug(
              `[Intent ${intent.id}] Container ${containerName} has no update`,
              { imageRepo }
            );
            results.skippedCount++;
            continue; // Skip containers without updates
          }

          logger?.info(`[Intent ${intent.id}] Upgrading ${containerName}...`, {
            currentImage: imageName,
            imageRepo,
          });

          // Find Portainer instance for this container
          const instance = portainerInstances.find(
            (inst) => inst.id === portainerInstanceId
          );
          if (!instance) {
            throw new Error(
              `Portainer instance not found for container ${containerName}`
            );
          }

          // Authenticate with Portainer instance
          await portainerService.authenticatePortainer({
            portainerUrl: instance.url,
            username: instance.username,
            password: instance.password,
            apiKey: instance.api_key,
            authType: instance.auth_type || "apikey",
          });

          // Execute the upgrade using existing service
          const upgradeResult = await containerUpgradeService.upgradeSingleContainer(
            instance.url,
            endpointId,
            containerId,
            imageName,
            userId
          );

          results.upgradedCount++;
          results.upgrades.push({
            containerId,
            containerName,
            success: true,
            newImage: upgradeResult.newImage,
            newDigest: upgradeResult.newDigest,
          });

          logger?.info(`[Intent ${intent.id}] ✓ Upgraded ${containerName}`, {
            newImage: upgradeResult.newImage,
          });
        } catch (err) {
          results.failedCount++;
          results.upgrades.push({
            containerId,
            containerName,
            success: false,
            error: err.message,
          });

          logger?.error(
            `[Intent ${intent.id}] ✗ Failed to upgrade ${containerName}: ${err.message}`
          );
        }
      }

      return results;
    } catch (err) {
      logger?.error(`[Intent ${intent.id}] Fatal error processing intent: ${err.message}`);
      results.error = err.message;
      return results;
    }
  }

  /**
   * Main batch handler for auto-updates
   *
   * This is the entry point called by the batch scheduler.
   *
   * @param {Object} context - Handler context
   * @param {Object} context.logger - Batch logger
   * @param {number} context.userId - User ID (optional, processes all users if not provided)
   * @returns {Promise<Object>} - { itemsChecked, itemsUpdated, logs, error }
   */
  // eslint-disable-next-line max-lines-per-function -- Complex batch orchestration logic
  async execute(context) {
    const { logger, userId: specificUserId } = context;

    logger?.info("Starting auto-update batch job...");

    const result = {
      itemsChecked: 0,
      itemsUpdated: 0,
      logs: [],
      error: null,
      containersUpgraded: 0,
      containersFailed: 0,
      intentResults: [],
    };

    try {
      let usersToProcess = [];

      if (specificUserId) {
        // Process only the specific user
        usersToProcess = [specificUserId];
      } else {
        // Get all users with enabled intents
        const db = getDatabase();
        usersToProcess = await new Promise((resolve, reject) => {
          db.all(
            `SELECT DISTINCT user_id FROM auto_update_intents WHERE enabled = 1`,
            [],
            (err, rows) => {
              if (err) return reject(err);
              resolve((rows || []).map((row) => row.user_id));
            }
          );
        });
      }

      logger?.info(`Found ${usersToProcess.length} users with enabled auto-update intents`);
      result.logs.push(`Processing ${usersToProcess.length} users with enabled intents`);

      // Process each user's auto-update intents
      for (const userId of usersToProcess) {
        try {
          logger?.info(`Processing auto-updates for user ${userId}...`);

          // Fetch all enabled intents for this user
          const intents = await listIntents(userId, { enabledOnly: true });

          if (intents.length === 0) {
            logger?.debug(`User ${userId} has no enabled intents`);
            continue;
          }

          logger?.info(`User ${userId} has ${intents.length} enabled intents`);
          result.itemsChecked += intents.length;

          // Fetch all containers for this user
          const containers = await getPortainerContainersWithUpdates(userId);

          if (!containers || containers.length === 0) {
            logger?.warn(`User ${userId} has no containers - skipping`);
            result.logs.push(`User ${userId}: no containers found`);
            continue;
          }

          logger?.info(`User ${userId} has ${containers.length} containers`);

          // Fetch Portainer instances for auth
          const portainerInstances = await getAllPortainerInstances(userId);

          if (portainerInstances.length === 0) {
            logger?.warn(`User ${userId} has no Portainer instances - skipping`);
            result.logs.push(`User ${userId}: no Portainer instances configured`);
            continue;
          }

          // Execute each intent
          for (const intent of intents) {
            const intentResult = await this.executeIntent({
              intent,
              containers,
              portainerInstances,
              userId,
              logger,
            });

            result.intentResults.push(intentResult);
            result.containersUpgraded += intentResult.upgradedCount;
            result.containersFailed += intentResult.failedCount;

            if (intentResult.upgradedCount > 0) {
              result.logs.push(
                `Intent "${intentResult.intentDescription}": upgraded ${intentResult.upgradedCount} containers`
              );
            }
          }
        } catch (userErr) {
          logger?.error(`Error processing auto-updates for user ${userId}: ${userErr.message}`);
          result.logs.push(`User ${userId}: error - ${userErr.message}`);
        }
      }

      result.itemsUpdated = result.containersUpgraded;

      if (result.containersUpgraded > 0 || result.containersFailed > 0) {
        const message = `Auto-update complete: upgraded ${result.containersUpgraded}, failed ${result.containersFailed}`;
        logger?.info(message);
        result.logs.push(message);
      } else {
        const message = "Auto-update complete: no containers needed updates";
        logger?.info(message);
        result.logs.push(message);
      }

      return result;
    } catch (err) {
      logger?.error(`Auto-update batch job failed: ${err.message}`);
      result.error = err;
      result.logs.push(`Fatal error: ${err.message}`);
      return result;
    }
  }
}

module.exports = AutoUpdateHandler;
