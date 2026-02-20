/**
 * Intent Evaluator (Orchestrator)
 *
 * Periodically checks all enabled intents and triggers execution when due.
 *
 * Two trigger paths:
 * 1. **Scheduled intents** — Evaluated on a polling interval. Uses `isIntentDue()`
 *    to determine if the cron window has passed since last evaluation.
 * 2. **Immediate intents** — Triggered after a batch scan completes and finds
 *    container updates. Called directly by BatchManager post-scan hook.
 *
 * This module is a singleton — require() always returns the same instance.
 */

const logger = require("../../utils/logger");
const { getAllUsers, getEnabledIntents } = require("../../db/index");
const { isIntentDue } = require("./scheduleEvaluator");
const { executeIntent } = require("./intentExecutor");

class IntentEvaluator {
  constructor() {
    this.checkInterval = null;
    this.checkIntervalMs = 60 * 1000; // Check every 60 seconds
    this.isRunning = false;
    this.evaluationInProgress = new Set(); // Track in-flight evaluations by intent ID
  }

  /**
   * Start the periodic evaluation loop for scheduled intents.
   */
  start() {
    if (this.checkInterval) {
      logger.warn("Intent evaluator already running");
      return;
    }

    logger.info("Starting intent evaluator", {
      intervalMs: this.checkIntervalMs,
    });

    this.isRunning = true;

    // Run initial check after a short delay (let the system settle on startup)
    setTimeout(() => {
      this.evaluateScheduledIntents().catch(err => {
        logger.error("Error in initial intent evaluation:", { error: err.message });
      });
    }, 10 * 1000); // 10 second startup delay

    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.evaluateScheduledIntents().catch(err => {
        logger.error("Error in scheduled intent evaluation:", { error: err.message });
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop the periodic evaluation loop.
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info("Intent evaluator stopped");
  }

  /**
   * Evaluate all scheduled intents for all users.
   * Called on the polling interval.
   */
  async evaluateScheduledIntents() {
    try {
      const users = await getAllUsers();
      if (!users || users.length === 0) {
        return;
      }

      for (const user of users) {
        try {
          await this._evaluateUserScheduledIntents(user.id);
        } catch (err) {
          logger.error("Error evaluating scheduled intents for user:", {
            userId: user.id,
            error: err.message,
          });
        }
      }
    } catch (err) {
      logger.error("Error in evaluateScheduledIntents:", { error: err.message });
    }
  }

  /**
   * Evaluate scheduled intents for a single user.
   * @param {number} userId
   */
  async _evaluateUserScheduledIntents(userId) {
    const intents = await getEnabledIntents(userId);
    if (!intents || intents.length === 0) {
      return;
    }

    // Only process scheduled intents (immediate intents are triggered by scan hook)
    const scheduledIntents = intents.filter(i => i.schedule_type === "scheduled");

    for (const intent of scheduledIntents) {
      try {
        // Skip if this intent is already being executed
        if (this.evaluationInProgress.has(intent.id)) {
          logger.debug("Skipping intent — execution already in progress", {
            intentId: intent.id,
            intentName: intent.name,
          });
          continue;
        }

        const { isDue, reason } = isIntentDue(intent);

        if (!isDue) {
          continue;
        }

        logger.info("Scheduled intent is due — triggering execution", {
          intentId: intent.id,
          intentName: intent.name,
          reason,
          userId,
        });

        this._executeIntentSafe(intent, userId, "scheduled_window");
      } catch (err) {
        logger.error("Error checking if intent is due:", {
          intentId: intent.id,
          error: err.message,
        });
      }
    }
  }

  /**
   * Evaluate immediate intents for a user after a scan detected updates.
   * Called by the BatchManager post-scan hook.
   *
   * @param {number} userId - User who owns the scan
   * @param {Object} scanResult - Result from the batch scan job
   * @param {number} scanResult.itemsUpdated - Number of containers with available updates
   */
  async evaluateImmediateIntents(userId, scanResult) {
    // Only trigger if the scan actually found updates
    if (!scanResult || !scanResult.itemsUpdated || scanResult.itemsUpdated <= 0) {
      return;
    }

    logger.info("Scan detected updates — evaluating immediate intents", {
      userId,
      updatesFound: scanResult.itemsUpdated,
    });

    try {
      const intents = await getEnabledIntents(userId);
      if (!intents || intents.length === 0) {
        return;
      }

      const immediateIntents = intents.filter(i => i.schedule_type === "immediate");

      if (immediateIntents.length === 0) {
        return;
      }

      logger.info(`Found ${immediateIntents.length} immediate intent(s) to evaluate`, { userId });

      for (const intent of immediateIntents) {
        // Skip if already executing
        if (this.evaluationInProgress.has(intent.id)) {
          logger.info("Skipping immediate intent — execution already in progress", {
            intentId: intent.id,
            intentName: intent.name,
          });
          continue;
        }

        this._executeIntentSafe(intent, userId, "scan_detected");
      }
    } catch (err) {
      logger.error("Error evaluating immediate intents:", {
        userId,
        error: err.message,
      });
    }
  }

  /**
   * Execute an intent in a fire-and-forget manner with error handling
   * and in-progress tracking.
   *
   * @param {Object} intent - Intent object
   * @param {number} userId - User ID
   * @param {string} triggerType - 'scheduled_window' | 'scan_detected'
   */
  _executeIntentSafe(intent, userId, triggerType) {
    this.evaluationInProgress.add(intent.id);

    executeIntent(intent, userId, { triggerType })
      .then(result => {
        logger.info("Intent execution completed via evaluator", {
          intentId: intent.id,
          intentName: intent.name,
          triggerType,
          status: result.status,
          matched: result.containersMatched,
          upgraded: result.containersUpgraded,
          failed: result.containersFailed,
          skipped: result.containersSkipped,
        });
      })
      .catch(err => {
        logger.error("Intent execution failed via evaluator:", {
          intentId: intent.id,
          intentName: intent.name,
          triggerType,
          error: err.message,
        });
      })
      .finally(() => {
        this.evaluationInProgress.delete(intent.id);
      });
  }

  /**
   * Get evaluator status.
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
      inProgressIntents: Array.from(this.evaluationInProgress),
    };
  }
}

// Singleton instance
const intentEvaluator = new IntentEvaluator();

module.exports = intentEvaluator;
