/**
 * Batch Repository
 * Handles all batch job-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const batchDb = require("../db/batch");

class BatchRepository extends BaseRepository {
  /**
   * Get batch configuration for a specific job type or all job types
   * @param {number} userId - User ID
   * @param {string} [jobType] - Optional job type. If null, returns all configs.
   * @returns {Promise<Object|null>} - Batch configuration(s) or null
   */
  getConfig(userId, jobType = null) {
    return batchDb.getBatchConfig(userId, jobType);
  }

  /**
   * Update batch configuration for a specific job type
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @param {boolean} enabled - Whether batch processing is enabled
   * @param {number} intervalMinutes - Interval in minutes between batch runs
   * @returns {Promise<void>}
   */
  updateConfig(userId, jobType, enabled, intervalMinutes) {
    return batchDb.updateBatchConfig(userId, jobType, enabled, intervalMinutes);
  }

  /**
   * Check and acquire batch job lock
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @returns {Promise<boolean>} - True if lock was acquired, false if already locked
   */
  checkAndAcquireLock(userId, jobType) {
    return batchDb.checkAndAcquireBatchJobLock(userId, jobType);
  }

  /**
   * Cleanup stale batch jobs
   * @returns {Promise<number>} - Number of jobs cleaned up
   */
  cleanupStale() {
    return batchDb.cleanupStaleBatchJobs();
  }

  /**
   * Create a new batch run
   * @param {number} userId - User ID
   * @param {string} [status="running"] - Run status
   * @param {string} [jobType="docker-hub-pull"] - Job type
   * @param {boolean} [isManual=false] - Whether this is a manual run
   * @returns {Promise<number>} - ID of created batch run
   */
  createRun(userId, status = "running", jobType = "docker-hub-pull", isManual = false) {
    return batchDb.createBatchRun(userId, status, jobType, isManual);
  }

  /**
   * Update batch run
   * @param {number} runId - Batch run ID
   * @param {number} userId - User ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  updateRun(runId, userId, updateData) {
    return batchDb.updateBatchRun(runId, userId, updateData);
  }

  /**
   * Find batch run by ID
   * @param {number} runId - Batch run ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Batch run or null
   */
  findRunById(runId, userId) {
    return batchDb.getBatchRunById(runId, userId);
  }

  /**
   * Find recent batch runs for a user
   * @param {number} userId - User ID
   * @param {number} [limit=50] - Maximum number of runs to return
   * @returns {Promise<Array>} - Array of batch runs
   */
  findRecentRuns(userId, limit = 50) {
    return batchDb.getRecentBatchRuns(userId, limit);
  }

  /**
   * Find latest batch run for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  findLatestRun(userId) {
    return batchDb.getLatestBatchRun(userId);
  }

  /**
   * Find latest batch run by job type for a user
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  findLatestRunByJobType(userId, jobType) {
    return batchDb.getLatestBatchRunByJobType(userId, jobType);
  }

  /**
   * Find latest batch runs by job type for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - Map of jobType -> latest batch run
   */
  findLatestRunsByJobType(userId) {
    return batchDb.getLatestBatchRunsByJobType(userId);
  }
}

module.exports = BatchRepository;
