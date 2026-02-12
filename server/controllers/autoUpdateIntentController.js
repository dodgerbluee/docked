/**
 * Auto-Update Intent Controller
 * Handles HTTP requests for auto-update intent management
 */

const {
  createIntent,
  getIntent,
  listIntents,
  updateIntent,
  deleteIntent,
  enableIntent,
  disableIntent,
} = require("../db/autoUpdateIntents");
const intentMatchingService = require("../services/intentMatchingService");
const { getPortainerContainersWithUpdates } = require("../db/index");
const logger = require("../utils/logger");

/**
 * Transform intent from database (snake_case) to API response (camelCase)
 */
function formatIntent(intent) {
  if (!intent) return null;
  return {
    id: intent.id,
    userId: intent.user_id,
    stackName: intent.stack_name,
    serviceName: intent.service_name,
    imageRepo: intent.image_repo,
    containerName: intent.container_name,
    enabled: Boolean(intent.enabled),
    notifyDiscord: Boolean(intent.notify_discord),
    notifyOnUpdateDetected: Boolean(intent.notify_on_update_detected),
    notifyOnBatchStart: Boolean(intent.notify_on_batch_start),
    notifyOnSuccess: Boolean(intent.notify_on_success),
    notifyOnFailure: Boolean(intent.notify_on_failure),
    description: intent.description,
    createdAt: intent.created_at,
    updatedAt: intent.updated_at,
  };
}

/**
 * Create a new auto-update intent
 * POST /api/auto-update/intents
 */
async function createAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const {
      stackName,
      serviceName,
      imageRepo,
      containerName,
      enabled,
      notifyDiscord,
      notifyOnUpdateDetected,
      notifyOnBatchStart,
      notifyOnSuccess,
      notifyOnFailure,
      description,
    } = req.body;

    // Validate at least one matching criterion
    if (!stackName && !imageRepo && !containerName) {
      return res.status(400).json({
        success: false,
        error:
          "At least one matching criterion (stackName, imageRepo, or containerName) is required",
      });
    }

    const intentId = await createIntent(userId, {
      stackName,
      serviceName,
      imageRepo,
      containerName,
      enabled: enabled || false,
      notifyDiscord: notifyDiscord || false,
      notifyOnUpdateDetected: notifyOnUpdateDetected || false,
      notifyOnBatchStart: notifyOnBatchStart || false,
      notifyOnSuccess: notifyOnSuccess || false,
      notifyOnFailure: notifyOnFailure || false,
      description,
    });

    logger.info("Auto-update intent created", {
      intentId,
      userId,
      criteria: { stackName, imageRepo, containerName },
    });

    const intent = await getIntent(userId, intentId);
    return res.status(201).json({
      success: true,
      message: "Auto-update intent created",
      intent: formatIntent(intent),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all auto-update intents for the user
 * GET /api/auto-update/intents
 */
async function listAutoUpdateIntents(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const intents = await listIntents(userId);
    return res.json({
      success: true,
      intents: intents.map(formatIntent),
      count: intents.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a specific auto-update intent
 * GET /api/auto-update/intents/:id
 */
async function getAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;
    const intent = await getIntent(userId, id);

    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    return res.json({
      success: true,
      intent: formatIntent(intent),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an auto-update intent
 * PATCH /api/auto-update/intents/:id
 */
async function updateAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;

    // Verify intent exists
    const intent = await getIntent(userId, id);
    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    // Update the intent
    await updateIntent(userId, id, req.body);

    // Return updated intent
    const updated = await getIntent(userId, id);
    logger.info("Auto-update intent updated", {
      intentId: id,
      userId,
      changes: Object.keys(req.body),
    });

    return res.json({
      success: true,
      message: "Auto-update intent updated",
      intent: formatIntent(updated),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an auto-update intent
 * DELETE /api/auto-update/intents/:id
 */
async function deleteAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;

    // Verify intent exists
    const intent = await getIntent(userId, id);
    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    await deleteIntent(userId, id);
    logger.info("Auto-update intent deleted", { intentId: id, userId });

    return res.json({
      success: true,
      message: "Auto-update intent deleted",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Test what containers match an intent
 * POST /api/auto-update/intents/:id/test-match
 *
 * Dry-run feature: shows which containers would be matched by this intent
 * without making any changes.
 */
async function testIntentMatch(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;

    // Get the intent
    const intent = await getIntent(userId, id);
    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    // Validate intent has required fields
    const validation = intentMatchingService.validateIntent(intent);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: "Intent configuration is invalid",
        errors: validation.errors,
      });
    }

    // Fetch all containers for user
    const containers = await getPortainerContainersWithUpdates(userId);
    if (!containers || containers.length === 0) {
      return res.json({
        success: true,
        message: "No containers found to match",
        matchedCount: 0,
        matchedContainers: [],
      });
    }

    // Find matching containers
    const matchedContainers = containers.filter((container) =>
      intentMatchingService.matchesIntent(intent, container)
    );

    const matchedWithUpdates = matchedContainers.filter((c) => c.has_update);

    return res.json({
      success: true,
      message: `Found ${matchedContainers.length} matching container(s)`,
      matchedCount: matchedContainers.length,
      matchedContainers: matchedContainers.map((c) => ({
        id: c.container_id,
        name: c.container_name,
        imageRepo: c.image_repo,
        imageName: c.image_name,
        stackName: c.stack_name,
        hasUpdate: c.has_update,
        updateAvailable: c.has_update ? c.latest_version || "latest" : null,
      })),
      withUpdatesCount: matchedWithUpdates.length,
      summary: {
        totalMatched: matchedContainers.length,
        withUpdates: matchedWithUpdates.length,
        upToDate: matchedContainers.length - matchedWithUpdates.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Enable an auto-update intent
 * POST /api/auto-update/intents/:id/enable
 */
async function enableAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;

    // Verify intent exists
    const intent = await getIntent(userId, id);
    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    await enableIntent(userId, id);
    const updated = await getIntent(userId, id);

    logger.info("Auto-update intent enabled", { intentId: id, userId });

    return res.json({
      success: true,
      message: "Auto-update intent enabled",
      intent: formatIntent(updated),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Disable an auto-update intent
 * POST /api/auto-update/intents/:id/disable
 */
async function disableAutoUpdateIntent(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const { id } = req.params;

    // Verify intent exists
    const intent = await getIntent(userId, id);
    if (!intent) {
      return res.status(404).json({
        success: false,
        error: "Intent not found",
      });
    }

    await disableIntent(userId, id);
    const updated = await getIntent(userId, id);

    logger.info("Auto-update intent disabled", { intentId: id, userId });

    return res.json({
      success: true,
      message: "Auto-update intent disabled",
      intent: formatIntent(updated),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createAutoUpdateIntent,
  listAutoUpdateIntents,
  getAutoUpdateIntent,
  updateAutoUpdateIntent,
  deleteAutoUpdateIntent,
  testIntentMatch,
  enableAutoUpdateIntent,
  disableAutoUpdateIntent,
};
