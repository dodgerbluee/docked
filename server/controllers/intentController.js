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
const { dryRunIntent } = require("../services/intents/intentExecutor");

const VALID_SCHEDULE_TYPES = ["immediate", "scheduled"];
const MAX_QUERY_LIMIT = 200;

/**
 * Normalize an array field: return null if the array is empty or falsy.
 * Prevents empty arrays [] (which are truthy in JS) from being stored as "[]"
 * in the database, which would silently disable match/exclude filters.
 * @param {Array|null|undefined} arr
 * @returns {Array|null}
 */
function normalizeArrayField(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr : null;
}

/**
 * Create a new intent
 */

/**
 * Update an existing intent
 */

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
    // Track excluded containers so the UI can show what's excluded and why
    const { matched: allMatchingContainers, excluded: excludedContainers } =
      await findMatchingContainers(intent, userId, false, { trackExcluded: true });

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
        sourceInstanceId: c.sourceInstanceId,
        hasUpdate: c.hasUpdate || false,
      })),
      excludedContainers: excludedContainers.map((c) => ({
        containerId: c.containerId,
        containerName: c.containerName,
        imageName: c.imageName,
        stackName: c.stackName || null,
        sourceInstanceId: c.sourceInstanceId,
        hasUpdate: c.hasUpdate || false,
        exclusionReason: c.exclusionReason,
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
  dryRunIntentHandler,
  getRecentExecutionsHandler,
  getExecutionDetailHandler,
  getIntentPreviewHandler,
};
