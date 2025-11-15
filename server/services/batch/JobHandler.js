/**
 * Job Handler Interface
 * Base class for all batch job handlers
 *
 * This interface ensures all batch jobs follow the same contract,
 * making it easy to add new batch types without modifying core logic.
 */

class JobHandler {
  /**
   * Get the job type identifier
   * @returns {string} - Unique job type identifier (e.g., 'docker-hub-pull')
   */
  getJobType() {
    throw new Error("getJobType() must be implemented by subclass");
  }

  /**
   * Get the display name for this job type
   * @returns {string} - Human-readable job name (e.g., 'Docker Hub Scan')
   */
  getDisplayName() {
    throw new Error("getDisplayName() must be implemented by subclass");
  }

  /**
   * Execute the batch job
   * @param {Object} context - Execution context with logger, config, etc.
   * @returns {Promise<Object>} - Result object with metrics
   * @property {number} itemsChecked - Number of items processed
   * @property {number} itemsUpdated - Number of items with updates
   * @property {Array<string>} logs - Array of log messages
   * @property {Error|null} error - Error if job failed
   */
  async execute(context) {
    throw new Error("execute() must be implemented by subclass");
  }

  /**
   * Validate job configuration
   * @param {Object} config - Job configuration
   * @returns {Object} - Validation result { valid: boolean, error?: string }
   */
  validateConfig(config) {
    if (!config || typeof config !== "object") {
      return { valid: false, error: "Config must be an object" };
    }
    if (typeof config.enabled !== "boolean") {
      return { valid: false, error: "Config must have enabled boolean" };
    }
    if (typeof config.intervalMinutes !== "number" || config.intervalMinutes < 1) {
      return { valid: false, error: "Config must have intervalMinutes >= 1" };
    }
    return { valid: true };
  }

  /**
   * Get default configuration for this job type
   * @returns {Object} - Default config { enabled: boolean, intervalMinutes: number }
   */
  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }
}

module.exports = JobHandler;
