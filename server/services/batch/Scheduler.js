/**
 * Batch Job Scheduler
 * Manages scheduling and execution of batch jobs with cron-like intervals,
 * retries, error handling, and concurrent execution support
 */

const { getBatchConfig, getLatestBatchRunByJobType, getAllUsers } = require("../../db/index");
const BatchLogger = require("./Logger");

class Scheduler {
  constructor(batchManager) {
    this.batchManager = batchManager;
    this.checkInterval = null;
    this.checkIntervalMs = 5 * 60 * 1000; // Check every 5 minutes
    this.jobTimers = new Map(); // Map of `${userId}:${jobType}` -> NodeJS.Timeout
    this.lastRunTimes = new Map(); // Map of `${userId}:${jobType}` -> timestamp
    this.isInitialized = false;
    this.logger = new BatchLogger("scheduler");
  }

  /**
   * Initialize scheduler by loading last run times from database
   */
  // eslint-disable-next-line max-lines-per-function, complexity -- Scheduler initialization requires comprehensive setup
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    // Get all users and load last run times for each user
    const users = await getAllUsers();
    const jobTypes = this.batchManager.getRegisteredJobTypes();

    for (const user of users) {
      for (const jobType of jobTypes) {
        const key = `${user.id}:${jobType}`;
        try {
          const lastRun = await getLatestBatchRunByJobType(user.id, jobType);

          if (lastRun && lastRun.completed_at && lastRun.status === "completed") {
            const completedAt = this.parseTimestamp(lastRun.completed_at);
            if (completedAt && !isNaN(completedAt.getTime())) {
              this.lastRunTimes.set(key, completedAt.getTime());
            }
          }
        } catch (err) {
          this.logger.warn(`Failed to load last run time for user ${user.id}, job ${jobType}`, {
            error: err.message,
          });
        }
      }
    }

    this.isInitialized = true;
    this.logger.info("Scheduler initialized", {
      users: users.length,
      jobTypes: jobTypes.length,
      lastRunTimes: this.lastRunTimes.size,
    });
  }

  /**
   * Parse timestamp from database (handles SQLite datetime format)
   */
  parseTimestamp(timestampStr) {
    if (!timestampStr) {
      return null;
    }

    // Handle SQLite datetime format (YYYY-MM-DD HH:MM:SS)
    if (
      typeof timestampStr === "string" &&
      /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/.test(timestampStr)
    ) {
      // SQLite stores datetimes in UTC, so add 'Z' to indicate UTC
      const isoStr = `${timestampStr.replace(" ", "T")}Z`;
      return new Date(isoStr);
    }

    return new Date(timestampStr);
  }

  /**
   * Start the scheduler
   */
  async start() {
    if (this.checkInterval) {
      this.logger.warn("Scheduler already running");
      return;
    }

    try {
      await this.initialize();
    } catch (err) {
      this.logger.error("Scheduler initialization failed", {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }

    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.checkAndScheduleJobs().catch((err) => {
        this.logger.error("Error in scheduler check", {
          error: err.message,
        });
      });
    }, this.checkIntervalMs);

    // Run initial check
    try {
      await this.checkAndScheduleJobs();
    } catch (err) {
      this.logger.error("Error during initial scheduler check", {
        error: err.message,
      });
    }

    this.logger.info(`Scheduler started (check interval: ${this.checkIntervalMs / 1000 / 60}m)`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all job timers
    for (const timer of this.jobTimers.values()) {
      clearTimeout(timer);
    }
    this.jobTimers.clear();

    this.logger.info("Scheduler stopped");
  }

  /**
   * Check batch configs and schedule jobs that are due
   */
  // eslint-disable-next-line max-lines-per-function, complexity -- Job scheduling requires comprehensive logic
  async checkAndScheduleJobs() {
    try {
      // Get all users
      const users = await getAllUsers();
      if (!users || users.length === 0) {
        return;
      }

      const now = Date.now();
      const jobTypes = this.batchManager.getRegisteredJobTypes();
      let jobsTriggered = 0;

      // Check each user's batch configs
      for (const user of users) {
        const userConfigs = await getBatchConfig(user.id);
        if (!userConfigs) {
          continue;
        }

        for (const jobType of jobTypes) {
          const config = userConfigs[jobType] || {
            enabled: false,
            intervalMinutes: 60,
          };

          const key = `${user.id}:${jobType}`;

          if (!config.enabled || config.intervalMinutes < 1) {
            // Job is disabled or invalid interval - clear any existing timer
            if (this.jobTimers.has(key)) {
              clearTimeout(this.jobTimers.get(key));
              this.jobTimers.delete(key);
            }
            continue;
          }

          // Check if job is already running (prevent duplicate runs)
          const isRunning = this.batchManager.runningJobs && this.batchManager.runningJobs.get(key);
          if (isRunning) {
            continue;
          }

          // Check if job is due to run
          const lastRunTime = this.lastRunTimes.get(key) || 0;
          const intervalMs = config.intervalMinutes * 60 * 1000;
          const timeSinceLastRun = now - lastRunTime;
          const shouldRun = timeSinceLastRun >= intervalMs || lastRunTime === 0;

          if (shouldRun) {
            jobsTriggered++;
            this.logger.info(`Job ${jobType} due for user ${user.id} — triggering`, {
              timeSinceLastRun: `${Math.round((timeSinceLastRun / 1000 / 60) * 10) / 10}m`,
              interval: `${config.intervalMinutes}m`,
            });

            this.runJob(user.id, jobType)
              .then(() => {
                this.logger.info(`Job ${jobType} completed for user ${user.id}`);
              })
              .catch((err) => {
                this.logger.error(`Job ${jobType} failed for user ${user.id}`, {
                  error: err.message,
                });
              });
          }
        }
      }

      if (jobsTriggered > 0) {
        this.logger.info(`Scheduler check: triggered ${jobsTriggered} job(s)`);
      }
      // When no jobs triggered, stay completely silent
    } catch (err) {
      this.logger.error("Error checking batch configs", {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  /**
   * Run a specific job for a user
   */
  async runJob(userId, jobType) {
    const now = Date.now();
    const key = `${userId}:${jobType}`;
    const lastRunTime = this.lastRunTimes.get(key) || 0;

    // Don't update last run time here - let BatchManager.updateLastRunTime() do it after successful completion
    // This prevents the scheduler from thinking the job already ran if it fails or takes a long time

    this.logger.info(`Executing user ${userId}, job: ${jobType}`, {
      lastRunTime: lastRunTime === 0 ? "never" : new Date(lastRunTime).toISOString(),
    });

    try {
      await this.batchManager.executeJob(userId, jobType);
      // BatchManager.executeJob() will call updateLastRunTime() on successful completion
      // So we don't need to update it here
    } catch (err) {
      // On error, reset last run time to allow retry after 1 minute
      const userConfigs = await getBatchConfig(userId);
      const jobConfig = userConfigs?.[jobType] || { intervalMinutes: 60 };
      const intervalMs = jobConfig.intervalMinutes * 60 * 1000;
      this.lastRunTimes.set(key, now - intervalMs + 60000);
      this.logger.warn(`User ${userId}, Job ${jobType} failed, will retry in 1 minute`, {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Update last run time for a job (called after successful completion)
   */
  updateLastRunTime(userId, jobType, timestamp) {
    const key = `${userId}:${jobType}`;
    this.lastRunTimes.set(key, timestamp);
    this.logger.info(`Updated last run time for user ${userId}, job ${jobType}`, {
      timestamp: new Date(timestamp).toISOString(),
    });
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.checkInterval !== null,
      isInitialized: this.isInitialized,
      activeJobTimers: this.jobTimers.size,
      lastRunTimes: Object.fromEntries(
        Array.from(this.lastRunTimes.entries()).map(([type, time]) => [
          type,
          time === 0 ? null : new Date(time).toISOString(),
        ])
      ),
    };
  }
}

module.exports = Scheduler;
