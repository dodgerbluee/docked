/**
 * Intent Executions Database Module
 *
 * Handles all intent execution-related database operations including:
 * - Creating and updating execution records
 * - Recording per-container execution details
 * - Querying execution history
 */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");

/**
 * Create a new intent execution record
 * @param {Object} executionData - Execution data
 * @param {number} executionData.intentId - Intent ID
 * @param {number} executionData.userId - User ID
 * @param {string} executionData.triggerType - 'scan_detected' | 'manual' | 'scheduled_window'
 * @param {string} [executionData.status] - Initial status (default 'pending')
 * @returns {Promise<number>} - ID of the created execution
 */
function createIntentExecution(executionData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const { intentId, userId, triggerType, status = "pending" } = executionData;

      if (!intentId || !userId || !triggerType) {
        reject(new Error("intentId, userId, and triggerType are required"));
        return;
      }

      queueDatabaseOperation(() => {
        db.run(
          `INSERT INTO intent_executions (intent_id, user_id, status, trigger_type)
           VALUES (?, ?, ?, ?)`,
          [intentId, userId, status, triggerType],
          function (err) {
            if (err) {
              logger.error("Error creating intent execution:", { error: err, executionData });
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update an intent execution with completion information
 * @param {number} executionId - Execution ID
 * @param {Object} updates - Update fields
 * @param {string} [updates.status] - Final status
 * @param {number} [updates.containersMatched] - Containers matched
 * @param {number} [updates.containersUpgraded] - Containers upgraded
 * @param {number} [updates.containersFailed] - Containers failed
 * @param {number} [updates.containersSkipped] - Containers skipped
 * @param {string} [updates.errorMessage] - Error message
 * @param {number} [updates.durationMs] - Duration in ms
 * @returns {Promise<void>}
 */
function updateIntentExecution(executionId, updates) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const {
        status,
        containersMatched,
        containersUpgraded,
        containersFailed,
        containersSkipped,
        errorMessage,
        durationMs,
      } = updates;

      const hasErrorMessage = "errorMessage" in updates;

      queueDatabaseOperation(() => {
        db.run(
          `UPDATE intent_executions SET
            status = COALESCE(?, status),
            containers_matched = COALESCE(?, containers_matched),
            containers_upgraded = COALESCE(?, containers_upgraded),
            containers_failed = COALESCE(?, containers_failed),
            containers_skipped = COALESCE(?, containers_skipped),
            error_message = CASE WHEN ? THEN ? ELSE error_message END,
            duration_ms = COALESCE(?, duration_ms),
            completed_at = CASE WHEN ? IN ('completed', 'failed', 'partial') THEN CURRENT_TIMESTAMP ELSE completed_at END
           WHERE id = ?`,
          [
            status || null,
            containersMatched ?? null,
            containersUpgraded ?? null,
            containersFailed ?? null,
            containersSkipped ?? null,
            hasErrorMessage ? 1 : 0,
            hasErrorMessage ? errorMessage || null : null,
            durationMs ?? null,
            status || "",
            executionId,
          ],
          (err) => {
            if (err) {
              logger.error("Error updating intent execution:", {
                error: err,
                executionId,
                updates,
              });
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get an execution by ID
 * @param {number} executionId - Execution ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Execution or null
 */
function getIntentExecutionById(executionId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.get(
          `SELECT ie.*, i.name as intent_name
           FROM intent_executions ie
           JOIN intents i ON ie.intent_id = i.id
           WHERE ie.id = ? AND ie.user_id = ?`,
          [executionId, userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching intent execution:", {
                error: err,
                executionId,
                userId,
              });
              reject(err);
            } else {
              resolve(row || null);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get executions for a specific intent
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @param {number} [limit=50] - Maximum number of records
 * @returns {Promise<Array>} - Array of executions
 */
function getIntentExecutions(intentId, userId, limit = 50) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.all(
          `SELECT ie.*, i.name as intent_name
           FROM intent_executions ie
           JOIN intents i ON ie.intent_id = i.id
           WHERE ie.intent_id = ? AND ie.user_id = ?
           ORDER BY ie.started_at DESC
           LIMIT ?`,
          [intentId, userId, limit],
          (err, rows) => {
            if (err) {
              logger.error("Error fetching intent executions:", {
                error: err,
                intentId,
                userId,
              });
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get recent executions across all intents for a user
 * @param {number} userId - User ID
 * @param {number} [limit=20] - Maximum number of records
 * @returns {Promise<Array>} - Array of executions
 */
function getRecentIntentExecutions(userId, limit = 20) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.all(
          `SELECT ie.*, i.name as intent_name
           FROM intent_executions ie
           JOIN intents i ON ie.intent_id = i.id
           WHERE ie.user_id = ?
           ORDER BY ie.started_at DESC
           LIMIT ?`,
          [userId, limit],
          (err, rows) => {
            if (err) {
              logger.error("Error fetching recent intent executions:", {
                error: err,
                userId,
              });
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Add a per-container detail record to an execution
 * @param {Object} containerData - Container execution data
 * @param {number} containerData.executionId - Execution ID
 * @param {string} containerData.containerId - Container ID
 * @param {string} containerData.containerName - Container name
 * @param {string} containerData.imageName - Image name
 * @param {number} [containerData.portainerInstanceId] - Portainer instance ID
 * @param {string} containerData.status - 'upgraded' | 'failed' | 'skipped' | 'dry_run'
 * @param {string} [containerData.oldImage] - Old image
 * @param {string} [containerData.newImage] - New image
 * @param {string} [containerData.oldDigest] - Old digest
 * @param {string} [containerData.newDigest] - New digest
 * @param {string} [containerData.errorMessage] - Error message
 * @param {number} [containerData.durationMs] - Duration in ms
 * @returns {Promise<number>} - ID of the created record
 */
function addIntentExecutionContainer(containerData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const {
        executionId,
        containerId,
        containerName,
        imageName,
        portainerInstanceId = null,
        status,
        oldImage = null,
        newImage = null,
        oldDigest = null,
        newDigest = null,
        errorMessage = null,
        durationMs = null,
      } = containerData;

      if (!executionId || !containerId || !containerName || !imageName || !status) {
        reject(
          new Error("executionId, containerId, containerName, imageName, and status are required")
        );
        return;
      }

      queueDatabaseOperation(() => {
        db.run(
          `INSERT INTO intent_execution_containers (
            execution_id, container_id, container_name, image_name,
            portainer_instance_id, status, old_image, new_image,
            old_digest, new_digest, error_message, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            executionId,
            containerId,
            containerName,
            imageName,
            portainerInstanceId,
            status,
            oldImage,
            newImage,
            oldDigest,
            newDigest,
            errorMessage,
            durationMs,
          ],
          function (err) {
            if (err) {
              logger.error("Error adding intent execution container:", {
                error: err,
                containerData,
              });
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get per-container details for an execution
 * @param {number} executionId - Execution ID
 * @param {number} userId - User ID (for defense-in-depth scoping)
 * @returns {Promise<Array>} - Array of container execution details
 */
function getIntentExecutionContainers(executionId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.all(
          `SELECT iec.*
           FROM intent_execution_containers iec
           JOIN intent_executions ie ON iec.execution_id = ie.id
           WHERE iec.execution_id = ? AND ie.user_id = ?
           ORDER BY iec.created_at ASC`,
          [executionId, userId],
          (err, rows) => {
            if (err) {
              logger.error("Error fetching intent execution containers:", {
                error: err,
                executionId,
              });
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clean up stale running intent executions on startup
 * @returns {Promise<number>} - Number of stale executions cleaned up
 */
function cleanupStaleIntentExecutions() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          `UPDATE intent_executions
           SET status = 'failed',
               completed_at = CURRENT_TIMESTAMP,
               error_message = 'Execution was interrupted (server restart detected)'
           WHERE status IN ('pending', 'running') AND completed_at IS NULL`,
          function (err) {
            if (err) {
              logger.error("Error cleaning up stale intent executions:", { error: err });
              reject(err);
            } else {
              if (this.changes > 0) {
                logger.info(`Cleaned up ${this.changes} stale intent execution(s) on startup`);
              }
              resolve(this.changes);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  createIntentExecution,
  updateIntentExecution,
  getIntentExecutionById,
  getIntentExecutions,
  getRecentIntentExecutions,
  addIntentExecutionContainer,
  getIntentExecutionContainers,
  cleanupStaleIntentExecutions,
};
