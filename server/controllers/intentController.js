/**
 * Intent Controller
 * Handles HTTP requests for intent CRUD operations
 */

const {
  createIntent,
  getIntentsByUser,
  getIntentById,
  updateIntent,
  deleteIntent,
  toggleIntent,
} = require("../db/index");
const {
  getIntentExecutions,
  getRecentIntentExecutions,
  getIntentExecutionById,
  getIntentExecutionContainers,
} = require("../db/index");
const logger = require("../utils/logger");
const { findMatchingContainers } = require("../services/intents/matchingEngine");
const { validateCron } = require("../services/intents/scheduleEvaluator");
const { dryRunIntent, executeIntent } = require("../services/intents/intentExecutor");

const VALID_SCHEDULE_TYPES = ["immediate", "scheduled"];
const MAX_QUERY_LIMIT = 200;

/**
 * List all intents for the authenticated user
 */
async function listIntents(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intents = await getIntentsByUser(userId);
    return res.json({ success: true, intents });
  } catch (error) {
    logger.error("Error listing intents:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to list intents",
    });
  }
}

/**
 * Get a single intent by ID
 */
async function getIntent(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    const intent = await getIntentById(intentId, userId);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    return res.json({ success: true, intent });
  } catch (error) {
    logger.error("Error getting intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get intent",
    });
  }
}

/**
 * Create a new intent
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Intent creation requires comprehensive validation
async function createIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const {
      name,
      description,
      enabled,
      matchContainers,
      matchImages,
      matchInstances,
      matchStacks,
      matchRegistries,
      excludeContainers,
      excludeImages,
      excludeStacks,
      excludeRegistries,
      scheduleType,
      scheduleCron,
      dryRun,
    } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: "name is required" });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ success: false, error: "name must be 100 characters or less" });
    }

    // Validate schedule type
    if (scheduleType && !VALID_SCHEDULE_TYPES.includes(scheduleType)) {
      return res.status(400).json({
        success: false,
        error: `scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(", ")}`,
      });
    }

    if (scheduleType === "scheduled" && !scheduleCron) {
      return res.status(400).json({
        success: false,
        error: "scheduleCron is required when scheduleType is 'scheduled'",
      });
    }

    // Validate cron expression syntax if provided
    if (scheduleCron) {
      const cronValidation = validateCron(scheduleCron);
      if (!cronValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid cron expression: ${cronValidation.error}`,
        });
      }
    }

    // Validate arrays if provided
    const arrayFields = {
      matchContainers,
      matchImages,
      matchInstances,
      matchStacks,
      matchRegistries,
      excludeContainers,
      excludeImages,
      excludeStacks,
      excludeRegistries,
    };
    for (const [fieldName, value] of Object.entries(arrayFields)) {
      if (value !== undefined && value !== null && !Array.isArray(value)) {
        return res.status(400).json({ success: false, error: `${fieldName} must be an array` });
      }
    }

    // Validate at least one match criterion
    const hasMatchCriteria =
      (matchContainers && matchContainers.length > 0) ||
      (matchImages && matchImages.length > 0) ||
      (matchInstances && matchInstances.length > 0) ||
      (matchStacks && matchStacks.length > 0) ||
      (matchRegistries && matchRegistries.length > 0);

    if (!hasMatchCriteria) {
      return res.status(400).json({
        success: false,
        error: "At least one match criterion is required",
      });
    }

    // Validate numeric fields

    const intentId = await createIntent({
      userId,
      name: name.trim(),
      description: description?.trim() || null,
      enabled: enabled !== false,
      matchContainers: matchContainers || null,
      matchImages: matchImages || null,
      matchInstances: matchInstances || null,
      matchStacks: matchStacks || null,
      matchRegistries: matchRegistries || null,
      excludeContainers: excludeContainers || null,
      excludeImages: excludeImages || null,
      excludeStacks: excludeStacks || null,
      excludeRegistries: excludeRegistries || null,
      scheduleType: scheduleType || "immediate",
      scheduleCron: scheduleCron || null,
      maxConcurrent: 1,
      dryRun: dryRun !== undefined ? dryRun : true,
      sequentialDelaySec: 0,
    });

    // For scheduled intents, set last_evaluated_at to creation time so the
    // evaluator waits for the first cron point after creation rather than
    // treating a missing timestamp as "immediately due".
    if (scheduleType === "scheduled") {
      await updateIntent(intentId, userId, {
        lastEvaluatedAt: new Date().toISOString(),
      });
    }

    const intent = await getIntentById(intentId, userId);

    return res.status(201).json({ success: true, intent });
  } catch (error) {
    logger.error("Error creating intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to create intent",
    });
  }
}

/**
 * Update an existing intent
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Intent update requires comprehensive validation
async function updateIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    // Check intent exists
    const existing = await getIntentById(intentId, userId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    const updates = {};
    const {
      name,
      description,
      enabled,
      matchContainers,
      matchImages,
      matchInstances,
      matchStacks,
      matchRegistries,
      excludeContainers,
      excludeImages,
      excludeStacks,
      excludeRegistries,
      scheduleType,
      scheduleCron,
      dryRun,
    } = req.body;

    // Validate and collect updates
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: "name cannot be empty" });
      }
      if (name.trim().length > 100) {
        return res
          .status(400)
          .json({ success: false, error: "name must be 100 characters or less" });
      }
      updates.name = name.trim();
    }

    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }

    if (enabled !== undefined) {
      updates.enabled = Boolean(enabled);
    }

    // Array fields
    const arrayFields = {
      matchContainers,
      matchImages,
      matchInstances,
      matchStacks,
      matchRegistries,
      excludeContainers,
      excludeImages,
      excludeStacks,
      excludeRegistries,
    };
    for (const [fieldName, value] of Object.entries(arrayFields)) {
      if (value !== undefined) {
        if (value !== null && !Array.isArray(value)) {
          return res
            .status(400)
            .json({ success: false, error: `${fieldName} must be an array or null` });
        }
        updates[fieldName] = value;
      }
    }

    if (scheduleType !== undefined) {
      if (!VALID_SCHEDULE_TYPES.includes(scheduleType)) {
        return res.status(400).json({
          success: false,
          error: `scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(", ")}`,
        });
      }
      updates.scheduleType = scheduleType;
    }

    if (scheduleCron !== undefined) {
      // Validate cron expression syntax if provided
      if (scheduleCron) {
        const cronValidation = validateCron(scheduleCron);
        if (!cronValidation.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid cron expression: ${cronValidation.error}`,
          });
        }
      }
      updates.scheduleCron = scheduleCron;
    }

    // Validate that scheduled type has a cron expression
    const finalScheduleType = updates.scheduleType || existing.schedule_type;
    const finalScheduleCron =
      "scheduleCron" in updates ? updates.scheduleCron : existing.schedule_cron;
    if (finalScheduleType === "scheduled" && !finalScheduleCron) {
      return res.status(400).json({
        success: false,
        error: "scheduleCron is required when scheduleType is 'scheduled'",
      });
    }

    // Reset lastEvaluatedAt when the schedule changes so the evaluator waits
    // for the first cron point after the change instead of potentially firing
    // immediately based on stale timestamps.
    const scheduleTypeChanging =
      "scheduleType" in updates && updates.scheduleType !== existing.schedule_type;
    const cronChanging =
      "scheduleCron" in updates && updates.scheduleCron !== existing.schedule_cron;

    if (finalScheduleType === "scheduled" && (scheduleTypeChanging || cronChanging)) {
      updates.lastEvaluatedAt = new Date().toISOString();
      logger.info("Resetting lastEvaluatedAt due to schedule change", {
        intentId,
        scheduleTypeChanging,
        cronChanging,
        newLastEvaluatedAt: updates.lastEvaluatedAt,
      });
    }

    if (dryRun !== undefined) {
      updates.dryRun = Boolean(dryRun);
    }

    const updated = await updateIntent(intentId, userId, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    const intent = await getIntentById(intentId, userId);
    return res.json({ success: true, intent });
  } catch (error) {
    logger.error("Error updating intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update intent",
    });
  }
}

/**
 * Delete an intent
 */
async function deleteIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    const deleted = await deleteIntent(intentId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    return res.json({ success: true, message: "Intent deleted successfully" });
  } catch (error) {
    logger.error("Error deleting intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to delete intent",
    });
  }
}

/**
 * Toggle an intent's enabled status
 */
async function toggleIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    let { enabled } = req.body || {};

    // Always fetch current state — we need it for toggle logic and schedule check
    const current = await getIntentById(intentId, userId);
    if (!current) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    if (typeof enabled !== "boolean") {
      enabled = !current.enabled;
    }

    const toggled = await toggleIntent(intentId, userId, enabled);
    if (!toggled) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    // When re-enabling a scheduled intent, reset lastEvaluatedAt to now
    // so the evaluator waits for the next cron point instead of firing
    // for all cron points missed while the intent was disabled.
    if (enabled && !current.enabled && current.schedule_type === "scheduled") {
      await updateIntent(intentId, userId, {
        lastEvaluatedAt: new Date().toISOString(),
      });
      logger.info("Reset lastEvaluatedAt on re-enable of scheduled intent", {
        intentId,
      });
    }

    const intent = await getIntentById(intentId, userId);
    return res.json({ success: true, intent });
  } catch (error) {
    logger.error("Error toggling intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to toggle intent",
    });
  }
}

/**
 * Manually trigger an intent execution
 */
async function executeIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    const intent = await getIntentById(intentId, userId);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    const result = await executeIntent(intent, userId, {
      triggerType: "manual",
    });

    return res.json({ success: true, execution: result });
  } catch (error) {
    logger.error("Error executing intent:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to execute intent",
    });
  }
}

/**
 * Dry-run / preview matching containers
 */
async function dryRunIntentHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    const intent = await getIntentById(intentId, userId);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    const result = await dryRunIntent(intent, userId);

    return res.json({ success: true, execution: result });
  } catch (error) {
    logger.error("Error in intent dry run:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to dry run intent",
    });
  }
}

/**
 * Get execution history for an intent
 */
async function getIntentExecutionsHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    // Verify intent belongs to user
    const intent = await getIntentById(intentId, userId);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_QUERY_LIMIT);
    const executions = await getIntentExecutions(intentId, userId, limit);

    return res.json({ success: true, executions });
  } catch (error) {
    logger.error("Error getting intent executions:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get intent executions",
    });
  }
}

/**
 * Get recent executions across all intents
 */
async function getRecentExecutionsHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_QUERY_LIMIT);
    const executions = await getRecentIntentExecutions(userId, limit);

    return res.json({ success: true, executions });
  } catch (error) {
    logger.error("Error getting recent executions:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get recent executions",
    });
  }
}

/**
 * Get intent preview: current matches and next execution simulation
 */
async function getIntentPreviewHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intentId = parseInt(req.params.id, 10);
    if (isNaN(intentId)) {
      return res.status(400).json({ success: false, error: "Invalid intent ID" });
    }

    const intent = await getIntentById(intentId, userId);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent not found" });
    }

    // Get current matches (all containers matching the intent, regardless of update status)
    const allMatchingContainers = await findMatchingContainers(intent, userId, false);

    // Get containers that would be upgraded (matches with updates available)
    // This is read-only — no execution records are created
    const upgradeableContainers = await findMatchingContainers(intent, userId, true);

    return res.json({
      success: true,
      currentMatches: allMatchingContainers.map((c) => ({
        containerId: c.containerId,
        containerName: c.containerName,
        imageName: c.imageName,
        stackName: c.stackName || null,
        portainerInstanceId: c.portainerInstanceId,
        hasUpdate: c.hasUpdate || false,
      })),
      nextExecutionPreview: {
        containers: upgradeableContainers.map((c) => ({
          containerId: c.containerId,
          containerName: c.containerName,
          imageName: c.imageName,
          stackName: c.stackName || null,
          status: "would_upgrade",
        })),
      },
    });
  } catch (error) {
    logger.error("Error getting intent preview:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get intent preview",
    });
  }
}
async function getExecutionDetailHandler(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const executionId = parseInt(req.params.executionId, 10);
    if (isNaN(executionId)) {
      return res.status(400).json({ success: false, error: "Invalid execution ID" });
    }

    const execution = await getIntentExecutionById(executionId, userId);
    if (!execution) {
      return res.status(404).json({ success: false, error: "Execution not found" });
    }

    const containers = await getIntentExecutionContainers(executionId, userId);

    return res.json({ success: true, execution, containers });
  } catch (error) {
    logger.error("Error getting execution detail:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get execution detail",
    });
  }
}

module.exports = {
  listIntents,
  getIntent,
  createIntentHandler,
  updateIntentHandler,
  deleteIntentHandler,
  toggleIntentHandler,
  executeIntentHandler,
  dryRunIntentHandler,
  getIntentExecutionsHandler,
  getRecentExecutionsHandler,
  getExecutionDetailHandler,
  getIntentPreviewHandler,
};
