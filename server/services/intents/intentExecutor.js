/**
 * Intent Executor
 *
 * Performs the actual container upgrades for an intent.
 * Uses stack-aware concurrency: containers in the same stack are upgraded
 * sequentially, while different stacks are upgraded in parallel.
 * This matches the behavior of manual multi-container upgrades in the UI.
 * Records execution and per-container results to the database.
 *
 * Flow:
 * 1. Match containers using the matching engine
 * 2. Create an execution record (intent_executions)
 * 3. Group containers by stack, upgrade sequentially within each stack, parallel across stacks
 * 4. Record per-container results (intent_execution_containers)
 * 5. Update execution with final totals
 */

const logger = require("../../utils/logger");
const { findMatchingContainers } = require("./matchingEngine");
const { upgradeSingleContainer } = require("../containerUpgradeService");
const upgradeLockManager = require("./upgradeLockManager");
const {
  createIntentExecution,
  updateIntentExecution,
  addIntentExecutionContainer,
} = require("../../db/index");
const { updateIntent } = require("../../db/index");
const { sendIntentExecutionNotification } = require("../discordService");

/**
 * Execute an intent: match containers and upgrade them.
 *
 * @param {Object} intent - Intent object (parsed from DB, camelCase fields)
 * @param {number} userId - User ID
 * @param {Object} [options] - Options
 * @param {string} [options.triggerType='manual'] - 'manual' | 'scan_detected' | 'scheduled_window'
 * @param {Date} [options.triggerTime] - The cron trigger time (for scheduled intents).
 *   Used to set last_evaluated_at so the same cron point never fires twice.
 * @param {boolean} [options.dryRun] - Override intent's dryRun setting (true = no upgrades)
 * @returns {Promise<Object>} - Execution summary
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Intent execution requires comprehensive orchestration
async function executeIntent(intent, userId, options = {}) {
  const triggerType = options.triggerType || "manual";
  const triggerTime = options.triggerTime || null;
  const isDryRun = options.dryRun !== undefined ? options.dryRun : intent.dry_run;
  const executionStartTime = Date.now();

  let executionId = null;

  try {
    // Step 1: Match containers
    const matchedContainers = await findMatchingContainers(intent, userId);

    // Step 2: Create execution record
    executionId = await createIntentExecution({
      intentId: intent.id,
      userId,
      triggerType,
      status: "running",
    });

    if (matchedContainers.length === 0) {
      // No containers matched — complete immediately
      const durationMs = Date.now() - executionStartTime;
      await updateIntentExecution(executionId, {
        status: "completed",
        containersMatched: 0,
        containersUpgraded: 0,
        containersFailed: 0,
        containersSkipped: 0,
        durationMs,
      });

      await updateLastEvaluated(intent.id, userId, executionId, triggerTime);

      return {
        executionId,
        status: "completed",
        containersMatched: 0,
        containersUpgraded: 0,
        containersFailed: 0,
        containersSkipped: 0,
        durationMs,
        containers: [],
      };
    }

    // Step 3: Dry run — record matches but don't upgrade
    if (isDryRun) {
      const containerResults = [];

      for (const container of matchedContainers) {
        const recordId = await addIntentExecutionContainer({
          executionId,
          containerId: container.containerId,
          containerName: container.containerName,
          imageName: container.imageName,
          portainerInstanceId: container.portainerInstanceId,
          status: "dry_run",
          oldImage: container.imageName,
        });
        containerResults.push({
          id: recordId,
          containerId: container.containerId,
          containerName: container.containerName,
          imageName: container.imageName,
          status: "dry_run",
        });
      }

      const durationMs = Date.now() - executionStartTime;
      await updateIntentExecution(executionId, {
        status: "completed",
        containersMatched: matchedContainers.length,
        containersUpgraded: 0,
        containersFailed: 0,
        containersSkipped: matchedContainers.length,
        durationMs,
      });

      await updateLastEvaluated(intent.id, userId, executionId, triggerTime);

      return {
        executionId,
        status: "completed",
        containersMatched: matchedContainers.length,
        containersUpgraded: 0,
        containersFailed: 0,
        containersSkipped: matchedContainers.length,
        durationMs,
        containers: containerResults,
      };
    }

    // Step 4: Execute upgrades with stack-aware concurrency
    // Containers in the same stack are upgraded sequentially;
    // different stacks are upgraded in parallel.
    const containerResults = [];
    let upgraded = 0;
    let failed = 0;
    let skipped = 0;

    // Group containers by stack (standalone containers each get their own group)
    const byStack = new Map();
    let standaloneIndex = 0;
    for (const container of matchedContainers) {
      const stack = container.stackName || `__standalone_${standaloneIndex++}`;
      if (!byStack.has(stack)) byStack.set(stack, []);
      byStack.get(stack).push(container);
    }

    logger.info("Intent executor: grouped containers by stack", {
      intentId: intent.id,
      totalContainers: matchedContainers.length,
      stackGroups: byStack.size,
      stacks: Array.from(byStack.entries()).map(([k, v]) => `${k}(${v.length})`),
    });

    // Process each stack group: sequential within stack, parallel across stacks
    const stackPromises = Array.from(byStack.values()).map(async stackContainers => {
      const stackResults = [];
      for (const container of stackContainers) {
        const result = await upgradeContainer(container, userId, executionId, intent.id);
        stackResults.push(result);
      }
      return stackResults;
    });

    const allStackResults = await Promise.all(stackPromises);

    for (const stackResults of allStackResults) {
      for (const result of stackResults) {
        containerResults.push(result);
        if (result.status === "upgraded") {
          upgraded++;
        } else if (result.status === "skipped") {
          skipped++;
        } else {
          failed++;
        }
      }
    }

    // Step 5: Update execution with final totals
    const durationMs = Date.now() - executionStartTime;
    const finalStatus = failed === 0 ? "completed" : upgraded === 0 ? "failed" : "partial";

    await updateIntentExecution(executionId, {
      status: finalStatus,
      containersMatched: matchedContainers.length,
      containersUpgraded: upgraded,
      containersFailed: failed,
      containersSkipped: skipped,
      durationMs,
    });

    await updateLastEvaluated(intent.id, userId, executionId, triggerTime);

    logger.info("Intent execution complete", {
      intentId: intent.id,
      intentName: intent.name,
      executionId,
      status: finalStatus,
      matched: matchedContainers.length,
      upgraded,
      failed,
      skipped,
      durationMs,
    });

    // Send Discord notification for intent execution (only for actual executions, not dry runs)
    if (!isDryRun) {
      try {
        await sendIntentExecutionNotification({
          intentName: intent.name,
          status: finalStatus,
          containersMatched: matchedContainers.length,
          containersUpgraded: upgraded,
          containersFailed: failed,
          containersSkipped: skipped,
          durationMs,
          triggerType,
          userId,
          containerResults,
        });
      } catch (error) {
        logger.error("Failed to send Discord notification for intent execution:", error);
      }
    }

    return {
      executionId,
      status: finalStatus,
      containersMatched: matchedContainers.length,
      containersUpgraded: upgraded,
      containersFailed: failed,
      containersSkipped: skipped,
      durationMs,
      containers: containerResults,
    };
  } catch (error) {
    // If we created an execution record, mark it as failed
    const durationMs = Date.now() - executionStartTime;
    if (executionId) {
      try {
        await updateIntentExecution(executionId, {
          status: "failed",
          errorMessage: error.message,
          durationMs,
        });
      } catch (updateErr) {
        logger.error("Failed to update execution on error:", {
          executionId,
          error: updateErr.message,
        });
      }
    }

    logger.error("Intent execution failed:", {
      intentId: intent.id,
      error: error.message,
      executionId,
    });

    throw error;
  }
}

/**
 * Upgrade a single container and record the result.
 * Acquires an upgrade lock before proceeding; skips the container if already locked.
 *
 * @param {Object} container - Container object (enriched with portainerUrl)
 * @param {number} userId - User ID
 * @param {number} executionId - Execution ID for recording
 * @param {number} intentId - Intent ID (for lock owner identification)
 * @returns {Promise<Object>} - Per-container result
 */
// eslint-disable-next-line max-lines-per-function -- Container upgrade with locking and error recording requires comprehensive logic
async function upgradeContainer(container, userId, executionId, intentId) {
  const startTime = Date.now();
  const lockOpts = { portainerInstanceId: container.portainerInstanceId };
  const lockOwner = `intent:${intentId}`;

  // Attempt to acquire upgrade lock
  const acquired = upgradeLockManager.acquire(container.containerId, {
    ...lockOpts,
    owner: lockOwner,
  });

  if (!acquired) {
    const lockInfo = upgradeLockManager.isLocked(container.containerId, lockOpts);
    logger.info("Container upgrade skipped — already locked", {
      containerId: container.containerId,
      containerName: container.containerName,
      lockedBy: lockInfo.owner,
      intentId,
    });

    // Record as skipped
    try {
      await addIntentExecutionContainer({
        executionId,
        containerId: container.containerId,
        containerName: container.containerName,
        imageName: container.imageName,
        portainerInstanceId: container.portainerInstanceId,
        status: "skipped",
        oldImage: container.imageName,
        errorMessage: `Upgrade already in progress (locked by ${lockInfo.owner || "unknown"})`,
      });
    } catch (recordErr) {
      logger.error("Failed to record skipped container:", {
        executionId,
        containerId: container.containerId,
        error: recordErr.message,
      });
    }

    return {
      containerId: container.containerId,
      containerName: container.containerName,
      status: "skipped",
      reason: `locked by ${lockInfo.owner || "unknown"}`,
    };
  }

  try {
    const result = await upgradeSingleContainer(
      container.portainerUrl,
      container.endpointId,
      container.containerId,
      container.imageName,
      userId,
    );

    const durationMs = Date.now() - startTime;

    // Record success
    await addIntentExecutionContainer({
      executionId,
      containerId: container.containerId,
      containerName: container.containerName,
      imageName: container.imageName,
      portainerInstanceId: container.portainerInstanceId,
      status: "upgraded",
      oldImage: result.oldImage,
      newImage: result.newImage,
      oldDigest: container.currentDigest || null,
      newDigest: null, // Not available from upgradeSingleContainer response
      durationMs,
    });

    return {
      containerId: container.containerId,
      containerName: container.containerName,
      status: "upgraded",
      oldImage: result.oldImage,
      newImage: result.newImage,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error("Container upgrade failed during intent execution:", {
      containerId: container.containerId,
      containerName: container.containerName,
      error: error.message,
    });

    // Record failure
    try {
      await addIntentExecutionContainer({
        executionId,
        containerId: container.containerId,
        containerName: container.containerName,
        imageName: container.imageName,
        portainerInstanceId: container.portainerInstanceId,
        status: "failed",
        oldImage: container.imageName,
        errorMessage: error.message,
        durationMs,
      });
    } catch (recordErr) {
      logger.error("Failed to record container execution failure:", {
        executionId,
        containerId: container.containerId,
        error: recordErr.message,
      });
    }

    return {
      containerId: container.containerId,
      containerName: container.containerName,
      status: "failed",
      errorMessage: error.message,
      durationMs,
    };
  } finally {
    upgradeLockManager.release(container.containerId, lockOpts);
  }
}

/**
 * Update the intent's last_evaluated_at and last_execution_id.
 *
 * IMPORTANT: `lastEvaluatedAt` is set to the cron trigger time, NOT
 * the current wall-clock time. This ensures that once a cron point is
 * processed, `nextRun(lastEvaluatedAt)` advances to the *next* cron
 * point, preventing the same trigger from firing twice.
 *
 * For manual or scan-triggered executions (no triggerTime), we fall
 * back to the current time since there's no cron point to anchor to.
 *
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @param {number} executionId - Most recent execution ID
 * @param {Date|null} triggerTime - The cron trigger time, or null for non-scheduled runs
 */
async function updateLastEvaluated(intentId, userId, executionId, triggerTime) {
  try {
    const evaluatedAt = triggerTime ? triggerTime.toISOString() : new Date().toISOString();

    await updateIntent(intentId, userId, {
      lastEvaluatedAt: evaluatedAt,
      lastExecutionId: executionId,
    });
  } catch (error) {
    logger.error("Failed to update intent lastEvaluatedAt:", {
      intentId,
      error: error.message,
    });
  }
}

/**
 * Perform a dry-run for an intent: match containers without executing upgrades.
 * This is a convenience wrapper around executeIntent with dryRun forced to true.
 *
 * @param {Object} intent - Intent object
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Execution summary with matched containers
 */
async function dryRunIntent(intent, userId) {
  return executeIntent(intent, userId, {
    triggerType: "manual",
    dryRun: true,
  });
}

module.exports = {
  executeIntent,
  dryRunIntent,
};
