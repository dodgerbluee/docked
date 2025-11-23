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
  async getConfig(userId, jobType = null) {
    return await batchDb.getBatchConfig(userId, jobType);
  }

  /**
   * Update batch configuration for a specific job type
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @param {boolean} enabled - Whether batch processing is enabled
   * @param {number} intervalMinutes - Interval in minutes between batch runs
   * @returns {Promise<void>}
   */
  async updateConfig(userId, jobType, enabled, intervalMinutes) {
    return await batchDb.updateBatchConfig(userId, jobType, enabled, intervalMinutes);
  }

  /**
   * Check and acquire batch job lock
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @returns {Promise<boolean>} - True if lock was acquired, false if already locked
   */
  async checkAndAcquireLock(userId, jobType) {
    return await batchDb.checkAndAcquireBatchJobLock(userId, jobType);
  }

  /**
   * Cleanup stale batch jobs
   * @returns {Promise<number>} - Number of jobs cleaned up
   */
  async cleanupStale() {
    return await batchDb.cleanupStaleBatchJobs();
  }

  /**
   * Create a new batch run
   * @param {number} userId - User ID
   * @param {string} [status="running"] - Run status
   * @param {string} [jobType="docker-hub-pull"] - Job type
   * @param {boolean} [isManual=false] - Whether this is a manual run
   * @returns {Promise<number>} - ID of created batch run
   */
  async createRun(userId, status = "running", jobType = "docker-hub-pull", isManual = false) {
    return await batchDb.createBatchRun(userId, status, jobType, isManual);
  }

  /**
   * Update batch run
   * @param {number} runId - Batch run ID
   * @param {number} userId - User ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  async updateRun(runId, userId, updateData) {
    return await batchDb.updateBatchRun(runId, userId, updateData);
  }

  /**
   * Find batch run by ID
   * @param {number} runId - Batch run ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Batch run or null
   */
  async findRunById(runId, userId) {
    return await batchDb.getBatchRunById(runId, userId);
  }

  /**
   * Find recent batch runs for a user
   * @param {number} userId - User ID
   * @param {number} [limit=50] - Maximum number of runs to return
   * @returns {Promise<Array>} - Array of batch runs
   */
  async findRecentRuns(userId, limit = 50) {
    return await batchDb.getRecentBatchRuns(userId, limit);
  }

  /**
   * Find latest batch run for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  async findLatestRun(userId) {
    return await batchDb.getLatestBatchRun(userId);
  }

  /**
   * Find latest batch run by job type for a user
   * @param {number} userId - User ID
   * @param {string} jobType - Job type
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  async findLatestRunByJobType(userId, jobType) {
    return await batchDb.getLatestBatchRunByJobType(userId, jobType);
  }

  /**
   * Find latest batch runs by job type for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - Map of jobType -> latest batch run
   */
  async findLatestRunsByJobType(userId) {
    return await batchDb.getLatestBatchRunsByJobType(userId);
  }
}

module.exports = BatchRepository;

