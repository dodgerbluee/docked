/**
 * Batch Run Repository
 * Handles all batch run database operations
 */

const BaseRepository = require('./BaseRepository');

class BatchRunRepository extends BaseRepository {
  /**
   * Create a new batch run
   * @param {Object} data - Batch run data
   * @returns {Promise<number>} - Batch run ID
   */
  async create(data) {
    const { status = 'running', jobType = 'docker-hub-pull', isManual = false } = data;
    const result = await this.execute(
      'INSERT INTO batch_runs (status, job_type, is_manual, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [status, jobType, isManual ? 1 : 0]
    );
    return result.lastID;
  }

  /**
   * Update batch run
   * @param {number} id - Batch run ID
   * @param {Object} data - Update data
   * @returns {Promise<void>}
   */
  async update(id, data) {
    const {
      status,
      containersChecked = 0,
      containersUpdated = 0,
      errorMessage = null,
      logs = null
    } = data;

    // Calculate duration
    const run = await this.findOne('SELECT started_at FROM batch_runs WHERE id = ?', [id]);
    if (!run) {
      throw new Error('Batch run not found');
    }

    const startedAt = new Date(run.started_at);
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await this.execute(
      `UPDATE batch_runs 
       SET status = ?, completed_at = CURRENT_TIMESTAMP, duration_ms = ?, 
           containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?
       WHERE id = ?`,
      [status, durationMs, containersChecked, containersUpdated, errorMessage, logs, id]
    );
  }

  /**
   * Find batch run by ID
   * @param {number} id - Batch run ID
   * @returns {Promise<Object|null>} - Batch run or null
   */
  async findById(id) {
    return await this.findOne('SELECT * FROM batch_runs WHERE id = ?', [id]);
  }

  /**
   * Find recent batch runs
   * @param {number} limit - Maximum number of runs (default: 50)
   * @returns {Promise<Array>} - Array of batch runs
   */
  async findRecent(limit = 50) {
    return await super.findAll(
      'SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT ?',
      [limit]
    );
  }

  /**
   * Find latest batch run
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  async findLatest() {
    return await this.findOne(
      'SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 1'
    );
  }

  /**
   * Find latest batch run by job type
   * @param {string} jobType - Job type
   * @returns {Promise<Object|null>} - Latest batch run or null
   */
  async findLatestByJobType(jobType) {
    return await this.findOne(
      'SELECT * FROM batch_runs WHERE job_type = ? ORDER BY started_at DESC LIMIT 1',
      [jobType]
    );
  }
}

module.exports = BatchRunRepository;

