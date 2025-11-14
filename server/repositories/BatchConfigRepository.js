/**
 * Batch Config Repository
 * Handles batch configuration database operations
 */

const BaseRepository = require('./BaseRepository');

class BatchConfigRepository extends BaseRepository {
  /**
   * Get batch configuration for a specific job type
   * @param {string} jobType - Job type
   * @returns {Promise<Object>} - Batch configuration
   */
  async findByJobType(jobType) {
    const config = await this.findOne(
      'SELECT enabled, interval_minutes, updated_at FROM batch_config WHERE job_type = ?',
      [jobType]
    );

    if (config) {
      return {
        enabled: config.enabled === 1,
        intervalMinutes: config.interval_minutes,
        updatedAt: config.updated_at,
      };
    }

    // Return default if not found
    return {
      enabled: false,
      intervalMinutes: 60,
      updatedAt: null,
    };
  }

  /**
   * Get all batch configurations
   * @returns {Promise<Object>} - Object with job types as keys
   */
  async findAll() {
    // Use BaseRepository's findAll method with SQL query
    const configs = await super.findAll(
      'SELECT job_type, enabled, interval_minutes, updated_at FROM batch_config',
      []
    );

    const result = {};
    configs.forEach(row => {
      result[row.job_type] = {
        enabled: row.enabled === 1,
        intervalMinutes: row.interval_minutes,
        updatedAt: row.updated_at,
      };
    });

    // Ensure both job types exist
    if (!result['docker-hub-pull']) {
      result['docker-hub-pull'] = { enabled: false, intervalMinutes: 60, updatedAt: null };
    }
    if (!result['tracked-apps-check']) {
      result['tracked-apps-check'] = { enabled: false, intervalMinutes: 60, updatedAt: null };
    }

    return result;
  }

  /**
   * Update batch configuration
   * @param {string} jobType - Job type
   * @param {boolean} enabled - Whether enabled
   * @param {number} intervalMinutes - Interval in minutes
   * @returns {Promise<void>}
   */
  async update(jobType, enabled, intervalMinutes) {
    // Validate interval
    if (intervalMinutes < 1) {
      throw new Error('Interval must be at least 1 minute');
    }
    if (intervalMinutes > 1440) {
      throw new Error('Interval cannot exceed 1440 minutes (24 hours)');
    }

    await this.execute(
      `INSERT OR REPLACE INTO batch_config (job_type, enabled, interval_minutes, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [jobType, enabled ? 1 : 0, intervalMinutes]
    );
  }
}

module.exports = BatchConfigRepository;

