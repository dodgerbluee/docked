/**
 * Intent Controller
 * Remaining REST surface: intent preview (matches + exclusions + upgrade simulation).
 * Intent CRUD, execution, dry-run, and execution detail are served by the GraphQL backend.
 */

const { getIntentById } = require("../db/index");
const logger = require("../utils/logger");
const { findMatchingContainers } = require("../services/intents/matchingEngine");

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

module.exports = {
  getIntentPreviewHandler,
};
