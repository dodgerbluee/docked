/**
 * Batch Manager
 * Central manager for all batch jobs
 * Handles job registration, execution, and coordination
 */

const {
  createBatchRun,
  updateBatchRun,
  checkAndAcquireBatchJobLock,
  cleanupStaleBatchJobs,
  cleanupStaleIntentExecutions,
} = require("../../db/index");
const BatchLogger = require("./Logger");
const Scheduler = require("./Scheduler");
const intentEvaluator = require("../intents/intentEvaluator");
const logger = require("../../utils/logger");

class BatchManager {
  constructor() {
    this.handlers = new Map(); // Map of jobType -> JobHandler instance
    this.runningJobs = new Map(); // Map of `${userId}:${jobType}` -> boolean (to prevent concurrent runs)
    this.scheduler = new Scheduler(this);
  }

  /**
   * Register a job handler
   * @param {JobHandler} handler - Job handler instance
   */
  registerHandler(handler) {
    const jobType = handler.getJobType();

    if (this.handlers.has(jobType)) {
      throw new Error(`Job handler for type '${jobType}' is already registered`);
    }

    this.handlers.set(jobType, handler);
    logger.info(`✅ Registered batch job handler: ${jobType} (${handler.getDisplayName()})`);
  }

  /**
   * Get registered job types
   * @returns {Array<string>} - Array of job type identifiers
   */
  getRegisteredJobTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler for a job type
   * @param {string} jobType - Job type identifier
   * @returns {JobHandler|null} - Handler instance or null if not found
   */
  getHandler(jobType) {
    return this.handlers.get(jobType) || null;
  }

  /**
   * Execute a batch job
   * @param {number} userId - User ID
   * @param {string} jobType - Job type identifier
   * @param {boolean} isManual - Whether this is a manual run
   * @returns {Promise<Object>} - Execution result
   */
  // eslint-disable-next-line max-lines-per-function, complexity -- Job execution requires comprehensive orchestration
  async executeJob(userId, jobType, isManual = false) {
    const handler = this.getHandler(jobType);
    if (!handler) {
      throw new Error(`No handler registered for job type: ${jobType}`);
    }

    const key = `${userId}:${jobType}`;

    // Atomically check and acquire lock using database transaction
    // This prevents race conditions where two requests could both pass the check
    const lockCheck = await checkAndAcquireBatchJobLock(userId, jobType);
    if (lockCheck.isRunning) {
      throw new Error(
        `Job ${jobType} is already running for user ${userId} (run ID: ${lockCheck.runId})`
      );
    }

    // Also check in-memory map as a fast-path check (but database is source of truth)
    if (this.runningJobs.get(key)) {
      throw new Error(`Job ${jobType} is already running for user ${userId}`);
    }

    const batchLogger = new BatchLogger(jobType);
    let runId = null;

    try {
      // Set in-memory flag after database lock is acquired
      this.runningJobs.set(key, true);

      // Create batch run record
      logger.info("Creating batch run record", { userId });
      runId = await createBatchRun(userId, "running", jobType, isManual);
      logger.info("Batch run record created", { runId, userId });

      // Execute the job
      logger.info("Starting job execution", { userId });
      const result = await handler.execute({ logger: batchLogger, userId });

      // Update batch run as completed
      logger.info("Job execution completed successfully", {
        itemsChecked: result.itemsChecked,
        itemsUpdated: result.itemsUpdated,
        userId,
      });

      await updateBatchRun(runId, userId, {
        status: "completed",
        containersChecked: result.itemsChecked || 0,
        containersUpdated: result.itemsUpdated || 0,
        errorMessage: null,
        logs: batchLogger.getFormattedLogs(),
      });

      // Update scheduler's last run time
      this.scheduler.updateLastRunTime(userId, jobType, Date.now());

      logger.info("Batch run marked as completed", { runId, userId });

      // Post-scan hook: evaluate immediate intents if updates were found
      // Fire-and-forget — don't block the batch job response
      try {
        intentEvaluator.evaluateImmediateIntents(userId, {
          itemsUpdated: result.itemsUpdated || 0,
        });
      } catch (hookErr) {
        logger.error("Error triggering immediate intent evaluation (non-fatal):", {
          userId,
          error: hookErr.message,
        });
      }

      return {
        runId,
        success: true,
        itemsChecked: result.itemsChecked || 0,
        itemsUpdated: result.itemsUpdated || 0,
        logs: batchLogger.getLogs(),
      };
    } catch (err) {
      const errorMessage = err.message || `Failed to execute job: ${jobType}`;

      logger.error("Job execution failed", {
        error: errorMessage,
        stack: err.stack,
        userId,
      });

      // Update batch run as failed
      if (runId) {
        try {
          await updateBatchRun(runId, userId, {
            status: "failed",
            containersChecked: 0,
            containersUpdated: 0,
            errorMessage,
            logs: batchLogger.getFormattedLogs(),
          });
          logger.info("Batch run marked as failed", { runId, userId });
        } catch (updateErr) {
          logger.error("Failed to update batch run status", {
            error: updateErr.message,
            userId,
          });
        }
      }

      throw err;
    } finally {
      this.runningJobs.set(key, false);
      logger.info("Job execution finished", { userId });
    }
  }

  /**
   * Start the batch manager and scheduler
   */
  async start() {
    if (this.handlers.size === 0) {
      logger.warn("⚠️  No job handlers registered. Batch manager will not start.");
      return;
    }

    logger.info(`🚀 Starting batch manager with ${this.handlers.size} registered job handler(s)`);

    try {
      // Clean up any stale running jobs from previous server instance
      try {
        const cleanedCount = await cleanupStaleBatchJobs();
        if (cleanedCount > 0) {
          logger.info(`Cleaned up ${cleanedCount} stale batch job(s) on startup`);
        }
      } catch (cleanupErr) {
        logger.warn("Failed to cleanup stale batch jobs on startup (non-fatal):", {
          error: cleanupErr.message,
        });
        // Don't fail startup if cleanup fails
      }

      // Clean up any stale intent executions from previous server instance
      try {
        const cleanedIntents = await cleanupStaleIntentExecutions();
        if (cleanedIntents > 0) {
          logger.info(`Cleaned up ${cleanedIntents} stale intent execution(s) on startup`);
        }
      } catch (cleanupErr) {
        logger.warn("Failed to cleanup stale intent executions on startup (non-fatal):", {
          error: cleanupErr.message,
        });
      }

      await this.scheduler.start();

      // Start the intent evaluator for scheduled intent polling
      try {
        intentEvaluator.start();
        logger.info("Intent evaluator started alongside batch scheduler");
      } catch (evalErr) {
        logger.warn("Failed to start intent evaluator (non-fatal):", {
          error: evalErr.message,
        });
      }
    } catch (err) {
      logger.error("❌ Failed to start batch system:", err);
      throw err;
    }
  }

  /**
   * Stop the batch manager and scheduler
   */
  stop() {
    this.scheduler.stop();
    intentEvaluator.stop();
    logger.info("⏹️  Batch manager stopped");
  }

  /**
   * Get manager status
   */
  getStatus() {
    return {
      registeredJobs: this.getRegisteredJobTypes(),
      runningJobs: Array.from(this.runningJobs.entries())
        .filter(([, running]) => running)
        .map(([jobType]) => jobType),
      scheduler: this.scheduler.getStatus(),
    };
  }
}

module.exports = BatchManager;
