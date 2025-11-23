/**
 * Batch Database Module
 *
 * Handles all batch job-related database operations including:
 * - Batch configuration
 * - Batch run tracking
 * - Job locking and cleanup
 */

const logger = require("../utils/logger");
const { getDatabase } = require("./connection");

/**
 * Get batch configuration for a specific job type or all job types for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Optional job type. If null, returns all configs.
 * @returns {Promise<Object|null>} - Batch configuration(s) or null
 */
function getBatchConfig(userId, jobType = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (jobType) {
        db.get(
          "SELECT enabled, interval_minutes, updated_at FROM batch_config WHERE user_id = ? AND job_type = ?",
          [userId, jobType],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              if (row) {
                resolve({
                  enabled: row.enabled === 1,
                  intervalMinutes: row.interval_minutes,
                  updatedAt: row.updated_at,
                });
              } else {
                resolve({
                  enabled: false,
                  intervalMinutes: 60,
                  updatedAt: null,
                });
              }
            }
          }
        );
      } else {
        db.all(
          "SELECT job_type, enabled, interval_minutes, updated_at FROM batch_config WHERE user_id = ?",
          [userId],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              const configs = {};
              rows.forEach((row) => {
                configs[row.job_type] = {
                  enabled: row.enabled === 1,
                  intervalMinutes: row.interval_minutes,
                  updatedAt: row.updated_at,
                };
              });
              // Default values if not configured
              if (!configs["docker-hub-pull"]) {
                configs["docker-hub-pull"] = {
                  enabled: false,
                  intervalMinutes: 60,
                  updatedAt: null,
                };
              }
              if (!configs["tracked-apps-check"]) {
                configs["tracked-apps-check"] = {
                  enabled: false,
                  intervalMinutes: 60,
                  updatedAt: null,
                };
              }
              resolve(configs);
            }
          }
        );
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update batch configuration for a specific job type for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Job type
 * @param {boolean} enabled - Whether batch processing is enabled
 * @param {number} intervalMinutes - Interval in minutes between batch runs
 * @returns {Promise<void>}
 */
function updateBatchConfig(userId, jobType, enabled, intervalMinutes) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (intervalMinutes < 1) {
        reject(new Error("Interval must be at least 1 minute"));
        return;
      }
      if (intervalMinutes > 1440) {
        reject(new Error("Interval cannot exceed 1440 minutes (24 hours)"));
        return;
      }

      db.run(
        `INSERT OR REPLACE INTO batch_config (user_id, job_type, enabled, interval_minutes, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, jobType, enabled ? 1 : 0, intervalMinutes],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Check if a batch job is currently running and acquire lock atomically
 * Uses database transaction to ensure atomicity
 * @param {number} userId - User ID
 * @param {string} jobType - Job type
 * @returns {Promise<{isRunning: boolean, runId: number|null}>} - Object with isRunning flag and runId if running
 */
function checkAndAcquireBatchJobLock(userId, jobType) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      // Use IMMEDIATE transaction to acquire write lock immediately
      // This ensures atomicity - only one process can check and set at a time
      db.serialize(() => {
        db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
          if (beginErr) {
            db.run("ROLLBACK");
            reject(beginErr);
            return;
          }

          // Check for running job (status = 'running' and no completed_at)
          // Also check if it's stale (running for more than 1 hour)
          db.get(
            `SELECT id, started_at FROM batch_runs 
             WHERE user_id = ? AND job_type = ? AND status = 'running' AND completed_at IS NULL 
             ORDER BY started_at DESC LIMIT 1`,
            [userId, jobType],
            (err, row) => {
              if (err) {
                db.run("ROLLBACK");
                reject(err);
                return;
              }

              if (row) {
                // Check if the job is stale (running for more than 5 minutes)
                const startedAtStr = row.started_at;
                let startedAt;
                if (
                  typeof startedAtStr === "string" &&
                  /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
                ) {
                  startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
                } else {
                  startedAt = new Date(startedAtStr);
                }

                const now = new Date();
                const runningDurationMs = now.getTime() - startedAt.getTime();
                const STALE_JOB_THRESHOLD = 60 * 5 * 1000; // 5 minutes

                if (runningDurationMs > STALE_JOB_THRESHOLD) {
                  // Job is stale - mark it as failed and allow new job to run
                  db.run(
                    `UPDATE batch_runs 
                     SET status = 'failed', completed_at = CURRENT_TIMESTAMP, 
                         error_message = ?, duration_ms = ?
                     WHERE id = ?`,
                    [
                      `Job was interrupted (server restart detected). Original start: ${startedAtStr}`,
                      runningDurationMs,
                      row.id,
                    ],
                    (updateErr) => {
                      if (updateErr) {
                        db.run("ROLLBACK");
                        reject(updateErr);
                        return;
                      }

                      // Stale job cleaned up - lock acquired
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) {
                          reject(commitErr);
                        } else {
                          resolve({ isRunning: false, runId: null });
                        }
                      });
                    }
                  );
                } else {
                  // Job is still running (not stale)
                  db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                      reject(commitErr);
                    } else {
                      resolve({ isRunning: true, runId: row.id });
                    }
                  });
                }
              } else {
                // No running job - lock acquired, commit will release it
                // The actual job record will be created by createBatchRun
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    reject(commitErr);
                  } else {
                    resolve({ isRunning: false, runId: null });
                  }
                });
              }
            }
          );
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clean up stale running batch jobs (jobs that have been running for more than 1 hour)
 * This is called on startup to handle cases where the server was restarted during a job
 * @returns {Promise<number>} - Number of stale jobs cleaned up
 */
function cleanupStaleBatchJobs() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      const STALE_JOB_THRESHOLD = 60 * 60 * 1000; // 1 hour
      const thresholdTime = new Date(Date.now() - STALE_JOB_THRESHOLD).toISOString();

      // First, get all stale jobs to calculate their durations
      db.all(
        `SELECT id, started_at FROM batch_runs 
         WHERE status = 'running' AND completed_at IS NULL AND started_at < ?`,
        [thresholdTime],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          if (!rows || rows.length === 0) {
            resolve(0);
            return;
          }

          // Update each stale job with calculated duration
          let completed = 0;
          let errors = 0;

          rows.forEach((row) => {
            const startedAtStr = row.started_at;
            let startedAt;
            if (
              typeof startedAtStr === "string" &&
              /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
            ) {
              startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
            } else {
              startedAt = new Date(startedAtStr);
            }

            const now = new Date();
            const durationMs = now.getTime() - startedAt.getTime();

            db.run(
              `UPDATE batch_runs 
               SET status = 'failed', completed_at = CURRENT_TIMESTAMP, 
                   error_message = ?, duration_ms = ?
               WHERE id = ?`,
              [
                `Job was interrupted (server restart detected). Original start: ${startedAtStr}`,
                durationMs,
                row.id,
              ],
              (updateErr) => {
                if (updateErr) {
                  errors++;
                  logger.error(`Failed to cleanup stale batch job ${row.id}:`, updateErr);
                } else {
                  completed++;
                }

                // Resolve when all updates are done
                if (completed + errors === rows.length) {
                  if (completed > 0) {
                    logger.info(`Cleaned up ${completed} stale batch job(s) on startup`);
                  }
                  resolve(completed);
                }
              }
            );
          });
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create a new batch run record for a user
 * @param {number} userId - User ID
 * @param {string} status - Run status
 * @param {string} jobType - Job type
 * @param {boolean} isManual - Whether this run was manually triggered
 * @returns {Promise<number>} - ID of created batch run
 */
function createBatchRun(userId, status = "running", jobType = "docker-hub-pull", isManual = false) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "INSERT INTO batch_runs (user_id, status, job_type, is_manual, started_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        [userId, status, jobType, isManual ? 1 : 0],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update batch run with completion information
 * @param {number} runId - Batch run ID
 * @param {number} userId - User ID
 * @param {string} status - Final status
 * @param {number} containersChecked - Number of containers checked
 * @param {number} containersUpdated - Number of containers with updates found
 * @param {string} errorMessage - Error message if failed
 * @param {string} logs - Log output from the run
 * @returns {Promise<void>}
 */
function updateBatchRun(
  runId,
  userId,
  status,
  containersChecked = 0,
  containersUpdated = 0,
  errorMessage = null,
  logs = null
) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT started_at FROM batch_runs WHERE id = ? AND user_id = ?",
        [runId, userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (!row) {
            reject(new Error("Batch run not found"));
            return;
          }

          const startedAtStr = row.started_at;
          let startedAt;
          if (
            typeof startedAtStr === "string" &&
            /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(startedAtStr)
          ) {
            startedAt = new Date(startedAtStr.replace(" ", "T") + "Z");
          } else {
            startedAt = new Date(startedAtStr);
          }

          const completedAt = new Date();
          const durationMs = completedAt.getTime() - startedAt.getTime();

          db.run(
            `UPDATE batch_runs 
             SET status = ?, completed_at = CURRENT_TIMESTAMP, duration_ms = ?, 
                 containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?
           WHERE id = ? AND user_id = ?`,
            [
              status,
              durationMs,
              containersChecked,
              containersUpdated,
              errorMessage,
              logs,
              runId,
              userId,
            ],
            function (updateErr) {
              if (updateErr) {
                reject(updateErr);
              } else {
                resolve();
              }
            }
          );
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get batch run by ID
 * @param {number} runId - Batch run ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Batch run or null
 */
function getBatchRunById(runId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT * FROM batch_runs WHERE id = ? AND user_id = ?",
        [runId, userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get recent batch runs for a user
 * @param {number} userId - User ID
 * @param {number} limit - Maximum number of runs to return (default: 50)
 * @returns {Promise<Array>} - Array of batch runs
 */
function getRecentBatchRuns(userId, limit = 50) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT * FROM batch_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
        [userId, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the most recent batch run for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Most recent batch run or null
 */
function getLatestBatchRun(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT * FROM batch_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the most recent batch run for a specific job type for a user
 * @param {number} userId - User ID
 * @param {string} jobType - Job type to filter by
 * @returns {Promise<Object|null>} - Most recent batch run for the job type or null
 */
function getLatestBatchRunByJobType(userId, jobType) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT * FROM batch_runs WHERE user_id = ? AND job_type = ? ORDER BY started_at DESC LIMIT 1",
        [userId, jobType],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the most recent batch run for each job type for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Object with job types as keys and latest runs as values
 */
function getLatestBatchRunsByJobType(userId) {
  return new Promise((resolve, reject) => {
    const jobTypes = ["docker-hub-pull", "tracked-apps-check"];
    const promises = jobTypes.map((jobType) =>
      getLatestBatchRunByJobType(userId, jobType).then((run) => ({ jobType, run }))
    );

    Promise.all(promises)
      .then((results) => {
        const latestRuns = {};
        results.forEach(({ jobType, run }) => {
          latestRuns[jobType] = run;
        });
        resolve(latestRuns);
      })
      .catch(reject);
  });
}

module.exports = {
  getBatchConfig,
  updateBatchConfig,
  checkAndAcquireBatchJobLock,
  cleanupStaleBatchJobs,
  createBatchRun,
  updateBatchRun,
  getBatchRunById,
  getRecentBatchRuns,
  getLatestBatchRun,
  getLatestBatchRunByJobType,
  getLatestBatchRunsByJobType,
};
