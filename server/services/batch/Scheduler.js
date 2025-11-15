/**
 * Batch Job Scheduler
 * Manages scheduling and execution of batch jobs with cron-like intervals,
 * retries, error handling, and concurrent execution support
 */

const { getBatchConfig, getLatestBatchRunByJobType } = require("../../db/database");
const BatchLogger = require("./Logger");
const { setLogLevel: setBatchLogLevel } = require("./Logger");

class Scheduler {
  constructor(batchManager) {
    this.batchManager = batchManager;
    this.checkInterval = null;
    this.checkIntervalMs = 30 * 1000; // Check every 30 seconds
    this.jobTimers = new Map(); // Map of jobType -> NodeJS.Timeout
    this.lastRunTimes = new Map(); // Map of jobType -> timestamp
    this.isInitialized = false;
    this.logger = new BatchLogger("scheduler");
  }

  /**
   * Initialize scheduler by loading last run times from database
   */
  async initialize() {
    this.logger.debug("initialize() called");

    if (this.isInitialized) {
      this.logger.debug("Already initialized, skipping");
      return;
    }

    this.logger.info("Initializing scheduler");

    // Load last run times for all registered job types
    const jobTypes = this.batchManager.getRegisteredJobTypes();
    this.logger.debug(`Registered job types: ${jobTypes.join(", ")}`);

    for (const jobType of jobTypes) {
      this.logger.debug(`Loading last run time for ${jobType}...`);
      try {
        const lastRun = await getLatestBatchRunByJobType(jobType);
        this.logger.debug(`Last run query result for ${jobType}:`, {
          found: !!lastRun,
        });

        if (lastRun && lastRun.completed_at && lastRun.status === "completed") {
          const completedAt = this.parseTimestamp(lastRun.completed_at);
          this.logger.debug(`Parsed completed_at for ${jobType}:`, {
            parsed: completedAt ? completedAt.toISOString() : "failed to parse",
          });

          if (completedAt && !isNaN(completedAt.getTime())) {
            const timestamp = completedAt.getTime();
            this.lastRunTimes.set(jobType, timestamp);
            this.logger.info(`✅ Loaded last run time for ${jobType}`, {
              completedAtRaw: lastRun.completed_at,
              completedAtParsed: completedAt.toISOString(),
              timestamp: timestamp,
              timestampDate: new Date(timestamp).toISOString(),
            });
          } else {
            this.logger.warn(`⚠️ Failed to parse last run time for ${jobType}`, {
              completedAt: lastRun.completed_at,
            });
          }
        } else {
          this.logger.info(`ℹ️ No completed runs found for ${jobType} - will run on first check`);
        }
      } catch (err) {
        this.logger.warn(`Failed to load last run time for ${jobType}`, {
          error: err.message,
        });
      }
    }

    this.isInitialized = true;
    this.logger.info("Scheduler initialized", {
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
      const isoStr = timestampStr.replace(" ", "T") + "Z";
      return new Date(isoStr);
    }

    return new Date(timestampStr);
  }

  /**
   * Start the scheduler
   */
  async start() {
    this.logger.debug("start() method called");

    if (this.checkInterval) {
      this.logger.warn("Scheduler already running");
      return;
    }

    this.logger.info("🚀 Starting scheduler...");

    try {
      await this.initialize();
      this.logger.debug("Initialization complete");
    } catch (err) {
      this.logger.error("ERROR during initialization", {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }

    this.logger.debug(
      `Setting up interval check every ${this.checkIntervalMs}ms (${this.checkIntervalMs / 1000}s)`
    );

    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.logger.debug(`Interval callback triggered at ${new Date().toISOString()}`);
      this.checkAndScheduleJobs().catch((err) => {
        this.logger.error("Error in scheduler check", {
          error: err.message,
          stack: err.stack,
        });
      });
    }, this.checkIntervalMs);

    this.logger.debug(`Interval set. checkInterval ID: ${this.checkInterval}`);

    // Run initial check
    this.logger.info("Running initial check...");
    try {
      await this.checkAndScheduleJobs();
      this.logger.debug("Initial check complete");
    } catch (err) {
      this.logger.error("ERROR during initial check", {
        error: err.message,
        stack: err.stack,
      });
    }

    this.logger.info("✅ Scheduler started successfully", {
      checkIntervalMs: this.checkIntervalMs,
      checkIntervalSeconds: this.checkIntervalMs / 1000,
      nextCheckIn: `${this.checkIntervalMs / 1000} seconds`,
    });
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
  async checkAndScheduleJobs() {
    try {
      const timestamp = new Date().toISOString();
      this.logger.debug(`\n========== BATCH SCHEDULER CHECK [${timestamp}] ==========`);

      const allConfigs = await getBatchConfig();
      if (!allConfigs) {
        this.logger.warn("No batch configs found");
        return;
      }

      const now = Date.now();
      const jobTypes = this.batchManager.getRegisteredJobTypes();

      this.logger.debug(`Checking ${jobTypes.length} job type(s): ${jobTypes.join(", ")}`, {
        currentTime: new Date(now).toISOString(),
        currentTimeMs: now,
      });

      for (const jobType of jobTypes) {
        const config = allConfigs[jobType] || {
          enabled: false,
          intervalMinutes: 60,
        };

        this.logger.debug(`Checking job: ${jobType}`, {
          configExists: !!allConfigs[jobType],
          enabled: config.enabled,
          intervalMinutes: config.intervalMinutes,
        });

        if (!config.enabled || config.intervalMinutes < 1) {
          this.logger.debug(`${jobType}: Skipped - disabled or invalid interval`);
          // Job is disabled or invalid interval - clear any existing timer
          if (this.jobTimers.has(jobType)) {
            clearTimeout(this.jobTimers.get(jobType));
            this.jobTimers.delete(jobType);
          }
          continue;
        }

        // Check if job is already running (prevent duplicate runs)
        const isRunning =
          this.batchManager.runningJobs && this.batchManager.runningJobs.get(jobType);
        if (isRunning) {
          this.logger.debug(`${jobType}: Skipped - already running`);
          continue;
        }

        // Check if job is due to run
        const lastRunTime = this.lastRunTimes.get(jobType) || 0;
        const intervalMs = config.intervalMinutes * 60 * 1000;
        const timeSinceLastRun = now - lastRunTime;
        const minutesSinceLastRun = timeSinceLastRun / 1000 / 60;

        // The comparison
        const condition1 = timeSinceLastRun >= intervalMs;
        const condition2 = lastRunTime === 0;
        const shouldRun = condition1 || condition2;

        this.logger.debug(`${jobType}: Scheduling check`, {
          lastRunTime: lastRunTime === 0 ? "NEVER" : new Date(lastRunTime).toISOString(),
          lastRunTimeMs: lastRunTime,
          currentTime: new Date(now).toISOString(),
          currentTimeMs: now,
          timeSinceLastRunMs: timeSinceLastRun,
          timeSinceLastRunMinutes: Math.round(minutesSinceLastRun * 100) / 100,
          requiredIntervalMs: intervalMs,
          requiredIntervalMinutes: config.intervalMinutes,
          condition1: `${timeSinceLastRun} >= ${intervalMs} = ${condition1}`,
          condition2: `${lastRunTime} === 0 = ${condition2}`,
          shouldRun: shouldRun,
        });

        if (shouldRun) {
          // Job is due - run it (don't await, let it run in background)
          this.logger.info(`⏰ Job ${jobType} is due to run - triggering execution`, {
            timeSinceLastRun: Math.round((timeSinceLastRun / 1000 / 60) * 10) / 10 + " minutes",
            intervalMinutes: config.intervalMinutes,
            lastRunTime: lastRunTime === 0 ? "never" : new Date(lastRunTime).toISOString(),
            now: new Date(now).toISOString(),
          });

          this.runJob(jobType)
            .then(() => {
              this.logger.info(`✅ Job ${jobType} completed successfully`);
            })
            .catch((err) => {
              this.logger.error(`❌ Error running job ${jobType}`, {
                error: err.message,
                stack: err.stack,
              });
            });
        } else {
          const minutesUntilNext =
            Math.round(((intervalMs - timeSinceLastRun) / 1000 / 60) * 10) / 10;
          this.logger.debug(`${jobType}: Not due yet - ${minutesUntilNext} minutes until next run`);
        }
      }

      this.logger.debug(`========== END BATCH SCHEDULER CHECK ==========\n`);
    } catch (err) {
      this.logger.error("Error checking batch configs", {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  /**
   * Run a specific job
   */
  async runJob(jobType) {
    const now = Date.now();
    const lastRunTime = this.lastRunTimes.get(jobType) || 0;

    // Don't update last run time here - let BatchManager.updateLastRunTime() do it after successful completion
    // This prevents the scheduler from thinking the job already ran if it fails or takes a long time

    this.logger.info(`Executing job: ${jobType}`, {
      lastRunTime: lastRunTime === 0 ? "never" : new Date(lastRunTime).toISOString(),
    });

    try {
      await this.batchManager.executeJob(jobType);
      // BatchManager.executeJob() will call updateLastRunTime() on successful completion
      // So we don't need to update it here
    } catch (err) {
      // On error, reset last run time to allow retry after 1 minute
      const config = await getBatchConfig();
      const jobConfig = config?.[jobType] || { intervalMinutes: 60 };
      const intervalMs = jobConfig.intervalMinutes * 60 * 1000;
      this.lastRunTimes.set(jobType, now - intervalMs + 60000);
      this.logger.warn(`Job ${jobType} failed, will retry in 1 minute`, {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Update last run time for a job (called after successful completion)
   */
  updateLastRunTime(jobType, timestamp) {
    this.lastRunTimes.set(jobType, timestamp);
    this.logger.info(`Updated last run time for ${jobType}`, {
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
