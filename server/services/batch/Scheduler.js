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
    this.checkIntervalMs = 30 * 1000; // Check every 30 seconds
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
    this.logger.debug("initialize() called");

    if (this.isInitialized) {
      this.logger.debug("Already initialized, skipping");
      return;
    }

    this.logger.info("Initializing scheduler");

    // Get all users and load last run times for each user
    const users = await getAllUsers();
    const jobTypes = this.batchManager.getRegisteredJobTypes();
    this.logger.debug(`Registered job types: ${jobTypes.join(", ")}, Users: ${users.length}`);

    for (const user of users) {
      for (const jobType of jobTypes) {
        const key = `${user.id}:${jobType}`;
        this.logger.debug(`Loading last run time for user ${user.id}, job ${jobType}...`);
        try {
          const lastRun = await getLatestBatchRunByJobType(user.id, jobType);
          this.logger.debug(`Last run query result for user ${user.id}, job ${jobType}:`, {
            found: Boolean(lastRun),
          });

          if (lastRun && lastRun.completed_at && lastRun.status === "completed") {
            const completedAt = this.parseTimestamp(lastRun.completed_at);
            this.logger.debug(`Parsed completed_at for user ${user.id}, job ${jobType}:`, {
              parsed: completedAt ? completedAt.toISOString() : "failed to parse",
            });

            const isValidTimestamp = completedAt && !isNaN(completedAt.getTime());
            if (isValidTimestamp) {
              const timestamp = completedAt.getTime();
              this.lastRunTimes.set(key, timestamp);
              this.logger.info(`✅ Loaded last run time for user ${user.id}, job ${jobType}`, {
                completedAtRaw: lastRun.completed_at,
                completedAtParsed: completedAt.toISOString(),
                timestamp,
                timestampDate: new Date(timestamp).toISOString(),
              });
            } else {
              this.logger.warn(
                `⚠️ Failed to parse last run time for user ${user.id}, job ${jobType}`,
                {
                  completedAt: lastRun.completed_at,
                },
              );
            }
          } else {
            this.logger.info(
              `ℹ️ No completed runs found for user ${user.id}, job ${jobType} - will run on first check`,
            );
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
      `Setting up interval check every ${this.checkIntervalMs}ms (${this.checkIntervalMs / 1000}s)`,
    );

    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.logger.debug(`Interval callback triggered at ${new Date().toISOString()}`);
      this.checkAndScheduleJobs().catch(err => {
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
  // eslint-disable-next-line max-lines-per-function, complexity -- Job scheduling requires comprehensive logic
  async checkAndScheduleJobs() {
    try {
      const timestamp = new Date().toISOString();
      this.logger.debug(`\n========== BATCH SCHEDULER CHECK [${timestamp}] ==========`);

      // Get all users
      const users = await getAllUsers();
      if (!users || users.length === 0) {
        this.logger.warn("No users found");
        return;
      }

      const now = Date.now();
      const jobTypes = this.batchManager.getRegisteredJobTypes();

      this.logger.debug(
        `Checking ${jobTypes.length} job type(s) for ${users.length} user(s): ${jobTypes.join(", ")}`,
        {
          currentTime: new Date(now).toISOString(),
          currentTimeMs: now,
        },
      );

      // Check each user's batch configs
      for (const user of users) {
        const userConfigs = await getBatchConfig(user.id);
        if (!userConfigs) {
          this.logger.debug(`No batch configs found for user ${user.id}`);
          continue;
        }

        for (const jobType of jobTypes) {
          const config = userConfigs[jobType] || {
            enabled: false,
            intervalMinutes: 60,
          };

          const key = `${user.id}:${jobType}`;

          this.logger.debug(`Checking user ${user.id}, job: ${jobType}`, {
            configExists: Boolean(userConfigs[jobType]),
            enabled: config.enabled,
            intervalMinutes: config.intervalMinutes,
          });

          if (!config.enabled || config.intervalMinutes < 1) {
            this.logger.debug(
              `User ${user.id}, ${jobType}: Skipped - disabled or invalid interval`,
            );
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
            this.logger.debug(`User ${user.id}, ${jobType}: Skipped - already running`);
            continue;
          }

          // Check if job is due to run
          const lastRunTime = this.lastRunTimes.get(key) || 0;
          const intervalMs = config.intervalMinutes * 60 * 1000;
          const timeSinceLastRun = now - lastRunTime;
          const minutesSinceLastRun = timeSinceLastRun / 1000 / 60;

          // The comparison
          const condition1 = timeSinceLastRun >= intervalMs;
          const condition2 = lastRunTime === 0;
          const shouldRun = condition1 || condition2;

          this.logger.debug(`User ${user.id}, ${jobType}: Scheduling check`, {
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
            shouldRun,
          });

          if (shouldRun) {
            // Job is due - run it (don't await, let it run in background)
            this.logger.info(
              `⏰ User ${user.id}, Job ${jobType} is due to run - triggering execution`,
              {
                timeSinceLastRun: `${Math.round((timeSinceLastRun / 1000 / 60) * 10) / 10} minutes`,
                intervalMinutes: config.intervalMinutes,
                lastRunTime: lastRunTime === 0 ? "never" : new Date(lastRunTime).toISOString(),
                now: new Date(now).toISOString(),
              },
            );

            this.runJob(user.id, jobType)
              .then(() => {
                this.logger.info(`✅ User ${user.id}, Job ${jobType} completed successfully`);
              })
              .catch(err => {
                this.logger.error(`❌ Error running user ${user.id}, job ${jobType}`, {
                  error: err.message,
                  stack: err.stack,
                });
              });
          } else {
            const minutesUntilNext =
              Math.round(((intervalMs - timeSinceLastRun) / 1000 / 60) * 10) / 10;
            this.logger.debug(
              `User ${user.id}, ${jobType}: Not due yet - ${minutesUntilNext} minutes until next run`,
            );
          }
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
        ]),
      ),
    };
  }
}

module.exports = Scheduler;
