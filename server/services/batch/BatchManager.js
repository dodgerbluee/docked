/**
 * Batch Manager
 * Central manager for all batch jobs
 * Handles job registration, execution, and coordination
 */

const { createBatchRun, updateBatchRun } = require("../../db/database");
const BatchLogger = require("./Logger");
const Scheduler = require("./Scheduler");
const logger = require("../../utils/logger");

class BatchManager {
  constructor() {
    this.handlers = new Map(); // Map of jobType -> JobHandler instance
    this.runningJobs = new Map(); // Map of jobType -> boolean (to prevent concurrent runs)
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
   * @param {string} jobType - Job type identifier
   * @returns {Promise<Object>} - Execution result
   */
  async executeJob(jobType, isManual = false) {
    const handler = this.getHandler(jobType);
    if (!handler) {
      throw new Error(`No handler registered for job type: ${jobType}`);
    }

    // Prevent concurrent runs of the same job type
    if (this.runningJobs.get(jobType)) {
      throw new Error(`Job ${jobType} is already running`);
    }

    const logger = new BatchLogger(jobType);
    let runId = null;

    try {
      this.runningJobs.set(jobType, true);

      // Create batch run record
      logger.info("Creating batch run record");
      runId = await createBatchRun("running", jobType, isManual);
      logger.info("Batch run record created", { runId });

      // Execute the job
      logger.info("Starting job execution");
      const result = await handler.execute({ logger });

      // Update batch run as completed
      logger.info("Job execution completed successfully", {
        itemsChecked: result.itemsChecked,
        itemsUpdated: result.itemsUpdated,
      });

      await updateBatchRun(
        runId,
        "completed",
        result.itemsChecked || 0,
        result.itemsUpdated || 0,
        null,
        logger.getFormattedLogs()
      );

      // Update scheduler's last run time
      this.scheduler.updateLastRunTime(jobType, Date.now());

      logger.info("Batch run marked as completed", { runId });

      return {
        runId,
        success: true,
        itemsChecked: result.itemsChecked || 0,
        itemsUpdated: result.itemsUpdated || 0,
        logs: logger.getLogs(),
      };
    } catch (err) {
      const errorMessage = err.message || `Failed to execute job: ${jobType}`;

      logger.error("Job execution failed", {
        error: errorMessage,
        stack: err.stack,
      });

      // Update batch run as failed
      if (runId) {
        try {
          await updateBatchRun(runId, "failed", 0, 0, errorMessage, logger.getFormattedLogs());
          logger.info("Batch run marked as failed", { runId });
        } catch (updateErr) {
          logger.error("Failed to update batch run status", {
            error: updateErr.message,
          });
        }
      }

      throw err;
    } finally {
      this.runningJobs.set(jobType, false);
      logger.info("Job execution finished");
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
      await this.scheduler.start();
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
