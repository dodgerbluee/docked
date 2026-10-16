/**
 * Batch Controller
 * Handles HTTP requests for manually triggering batch jobs.
 * (Batch config, runs, and log-level traffic now flows through the GraphQL backend.)
 */

const batchSystem = require("../services/batch");
const logger = require("../utils/logger");

/**
 * Trigger a batch job manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function triggerBatchJobHandler(req, res, _next) {
  try {
    const { jobType } = req.body;

    if (!jobType || typeof jobType !== "string") {
      return res.status(400).json({
        success: false,
        error: "jobType is required and must be a string",
      });
    }

    // Validate job type is registered
    const registeredJobTypes = batchSystem.getRegisteredJobTypes();
    if (!registeredJobTypes.includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type: ${jobType}. Valid types: ${registeredJobTypes.join(", ")}`,
      });
    }

    // Get userId from request (should be set by auth middleware)
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    // Execute the job (don't await - let it run in background)
    // Pass isManual=true to mark this as a manually triggered run
    batchSystem
      .executeJob(userId, jobType, true)
      .then((result) => {
        logger.info(`✅ Manually triggered job ${jobType} completed for user ${userId}:`, result);
      })
      .catch((err) => {
        logger.error(`❌ Manually triggered job ${jobType} failed for user ${userId}:`, err);
      });

    return res.json({
      success: true,
      message: `Job ${jobType} triggered successfully. Check batch logs for execution details.`,
    });
  } catch (error) {
    logger.error("Error triggering batch job:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to trigger batch job",
    });
  }
}

module.exports = {
  triggerBatchJobHandler,
};
