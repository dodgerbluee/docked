/**
 * Intents Database Module
 *
 * Handles all intent-related database operations including:
 * - CRUD for intent policy definitions
 * - Enabling/disabling intents
 * - Querying intents by user
 */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");

const MAX_INTENTS_PER_USER = 50;

/**
 * Create a new intent
 * @param {Object} intentData - Intent data
 * @param {number} intentData.userId - User ID
 * @param {string} intentData.name - Intent name
 * @param {string} [intentData.description] - Description
 * @param {boolean} [intentData.enabled] - Whether enabled (default true)
 * @param {Array} [intentData.matchContainers] - Container name filters
 * @param {Array} [intentData.matchImages] - Image glob patterns
 * @param {Array} [intentData.matchInstances] - Portainer instance IDs
 * @param {Array} [intentData.matchStacks] - Stack name glob patterns
 * @param {Array} [intentData.matchRegistries] - Registry filters
 * @param {Array} [intentData.excludeContainers] - Container name exclusion filters
 * @param {Array} [intentData.excludeImages] - Image exclusion glob patterns
 * @param {Array} [intentData.excludeStacks] - Stack name exclusion glob patterns
 * @param {Array} [intentData.excludeRegistries] - Registry exclusion filters
 * @param {string} [intentData.scheduleType] - 'immediate' or 'scheduled'
 * @param {string} [intentData.scheduleCron] - Cron expression
 * @param {number} [intentData.maxConcurrent] - Max concurrent upgrades
 * @param {boolean} [intentData.dryRun] - Dry run mode
 * @param {number} [intentData.sequentialDelaySec] - Delay between sequential upgrades
 * @returns {Promise<number>} - ID of the created intent
 */
function createIntent(intentData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const {
        userId,
        name,
        description = null,
        enabled = true,
        matchContainers = null,
        matchImages = null,
        matchInstances = null,
        matchStacks = null,
        matchRegistries = null,
        excludeContainers = null,
        excludeImages = null,
        excludeStacks = null,
        excludeRegistries = null,
        scheduleType = "immediate",
        scheduleCron = null,
        maxConcurrent = 1,
        dryRun = false,
        sequentialDelaySec = 30,
      } = intentData;

      if (!userId || !name) {
        reject(new Error("userId and name are required"));
        return;
      }

      if (scheduleType === "scheduled" && !scheduleCron) {
        reject(new Error("scheduleCron is required when scheduleType is 'scheduled'"));
        return;
      }

      // Check intent count limit and insert atomically within a transaction
      queueDatabaseOperation(() => {
        db.run("BEGIN IMMEDIATE", (beginErr) => {
          if (beginErr) {
            logger.error("Error starting transaction:", { error: beginErr });
            reject(beginErr);
            return;
          }

          db.get(
            "SELECT COUNT(*) as count FROM intents WHERE user_id = ?",
            [userId],
            (err, row) => {
              if (err) {
                logger.error("Error checking intent count:", { error: err, userId });
                db.run("ROLLBACK", () => reject(err));
                return;
              }

              if (row.count >= MAX_INTENTS_PER_USER) {
                db.run("ROLLBACK", () =>
                  reject(new Error(`Maximum of ${MAX_INTENTS_PER_USER} intents per user reached`))
                );
                return;
              }

              db.run(
                `INSERT INTO intents (
                  user_id, name, description, enabled,
                  match_containers, match_images, match_instances, match_stacks, match_registries,
                  exclude_containers, exclude_images, exclude_stacks, exclude_registries,
                  schedule_type, schedule_cron, max_concurrent, dry_run, sequential_delay_sec
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  userId,
                  name,
                  description,
                  enabled ? 1 : 0,
                  matchContainers ? JSON.stringify(matchContainers) : null,
                  matchImages ? JSON.stringify(matchImages) : null,
                  matchInstances ? JSON.stringify(matchInstances) : null,
                  matchStacks ? JSON.stringify(matchStacks) : null,
                  matchRegistries ? JSON.stringify(matchRegistries) : null,
                  excludeContainers ? JSON.stringify(excludeContainers) : null,
                  excludeImages ? JSON.stringify(excludeImages) : null,
                  excludeStacks ? JSON.stringify(excludeStacks) : null,
                  excludeRegistries ? JSON.stringify(excludeRegistries) : null,
                  scheduleType,
                  scheduleCron,
                  maxConcurrent,
                  dryRun ? 1 : 0,
                  sequentialDelaySec,
                ],
                function (insertErr) {
                  if (insertErr) {
                    logger.error("Error creating intent:", { error: insertErr, intentData });
                    db.run("ROLLBACK", () => reject(insertErr));
                  } else {
                    const lastID = this.lastID;
                    db.run("COMMIT", (commitErr) => {
                      if (commitErr) {
                        logger.error("Error committing transaction:", { error: commitErr });
                        db.run("ROLLBACK", () => reject(commitErr));
                      } else {
                        resolve(lastID);
                      }
                    });
                  }
                }
              );
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
 * Get all intents for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of intents
 */
function getIntentsByUser(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.all(
          `SELECT i.*, ie.status as last_execution_status
           FROM intents i
           LEFT JOIN intent_executions ie ON i.last_execution_id = ie.id
           WHERE i.user_id = ?
           ORDER BY i.created_at DESC`,
          [userId],
          (err, rows) => {
            if (err) {
              logger.error("Error fetching intents:", { error: err, userId });
              reject(err);
            } else {
              resolve((rows || []).map(parseIntentRow));
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
 * Get a single intent by ID
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} - Intent or null
 */
function getIntentById(intentId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.get(
          `SELECT i.*, ie.status as last_execution_status
           FROM intents i
           LEFT JOIN intent_executions ie ON i.last_execution_id = ie.id
           WHERE i.id = ? AND i.user_id = ?`,
          [intentId, userId],
          (err, row) => {
            if (err) {
              logger.error("Error fetching intent:", { error: err, intentId, userId });
              reject(err);
            } else {
              resolve(row ? parseIntentRow(row) : null);
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
 * Update an intent
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>} - Whether the intent was found and updated
 */
function updateIntent(intentId, userId, updates) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      // Build dynamic SET clause from allowed fields
      const allowedFields = {
        name: (v) => v,
        description: (v) => v,
        enabled: (v) => (v ? 1 : 0),
        matchContainers: (v) => (v ? JSON.stringify(v) : null),
        matchImages: (v) => (v ? JSON.stringify(v) : null),
        matchInstances: (v) => (v ? JSON.stringify(v) : null),
        matchStacks: (v) => (v ? JSON.stringify(v) : null),
        matchRegistries: (v) => (v ? JSON.stringify(v) : null),
        excludeContainers: (v) => (v ? JSON.stringify(v) : null),
        excludeImages: (v) => (v ? JSON.stringify(v) : null),
        excludeStacks: (v) => (v ? JSON.stringify(v) : null),
        excludeRegistries: (v) => (v ? JSON.stringify(v) : null),
        scheduleType: (v) => v,
        scheduleCron: (v) => v,
        maxConcurrent: (v) => v,
        dryRun: (v) => (v ? 1 : 0),
        sequentialDelaySec: (v) => v,
        lastEvaluatedAt: (v) => v,
        lastExecutionId: (v) => v,
      };

      // Map camelCase keys to snake_case column names
      const fieldToColumn = {
        name: "name",
        description: "description",
        enabled: "enabled",
        matchContainers: "match_containers",
        matchImages: "match_images",
        matchInstances: "match_instances",
        matchStacks: "match_stacks",
        matchRegistries: "match_registries",
        excludeContainers: "exclude_containers",
        excludeImages: "exclude_images",
        excludeStacks: "exclude_stacks",
        excludeRegistries: "exclude_registries",
        scheduleType: "schedule_type",
        scheduleCron: "schedule_cron",
        maxConcurrent: "max_concurrent",
        dryRun: "dry_run",
        sequentialDelaySec: "sequential_delay_sec",
        lastEvaluatedAt: "last_evaluated_at",
        lastExecutionId: "last_execution_id",
      };

      const setClauses = [];
      const params = [];

      for (const [key, transform] of Object.entries(allowedFields)) {
        if (key in updates) {
          setClauses.push(`${fieldToColumn[key]} = ?`);
          params.push(transform(updates[key]));
        }
      }

      if (setClauses.length === 0) {
        resolve(false);
        return;
      }

      // Always update updated_at
      setClauses.push("updated_at = CURRENT_TIMESTAMP");
      params.push(intentId, userId);

      queueDatabaseOperation(() => {
        db.run(
          `UPDATE intents SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`,
          params,
          function (err) {
            if (err) {
              logger.error("Error updating intent:", { error: err, intentId, userId });
              reject(err);
            } else {
              resolve(this.changes > 0);
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
 * Delete an intent
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} - Whether the intent was found and deleted
 */
function deleteIntent(intentId, userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          "DELETE FROM intents WHERE id = ? AND user_id = ?",
          [intentId, userId],
          function (err) {
            if (err) {
              logger.error("Error deleting intent:", { error: err, intentId, userId });
              reject(err);
            } else {
              resolve(this.changes > 0);
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
 * Toggle an intent's enabled status
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID
 * @param {boolean} enabled - New enabled state
 * @returns {Promise<boolean>} - Whether the intent was found and toggled
 */
function toggleIntent(intentId, userId, enabled) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          "UPDATE intents SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
          [enabled ? 1 : 0, intentId, userId],
          function (err) {
            if (err) {
              logger.error("Error toggling intent:", { error: err, intentId, userId });
              reject(err);
            } else {
              resolve(this.changes > 0);
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
 * Get all enabled intents for a user (used by evaluator in future phases)
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of enabled intents
 */
function getEnabledIntents(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.all(
          "SELECT * FROM intents WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC",
          [userId],
          (err, rows) => {
            if (err) {
              logger.error("Error fetching enabled intents:", { error: err, userId });
              reject(err);
            } else {
              resolve((rows || []).map(parseIntentRow));
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
 * Update last_evaluated_at and last_execution_id for an intent
 * @param {number} intentId - Intent ID
 * @param {number} userId - User ID (for ownership scoping)
 * @param {number} executionId - Execution ID
 * @returns {Promise<void>}
 */
function updateIntentLastExecution(intentId, userId, executionId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      queueDatabaseOperation(() => {
        db.run(
          "UPDATE intents SET last_evaluated_at = CURRENT_TIMESTAMP, last_execution_id = ? WHERE id = ? AND user_id = ?",
          [executionId, intentId, userId],
          (err) => {
            if (err) {
              logger.error("Error updating intent last execution:", {
                error: err,
                intentId,
                userId,
                executionId,
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
 * Parse a raw intent row from the database, deserializing JSON fields
 * @param {Object} row - Raw database row
 * @returns {Object} - Parsed intent
 */
function parseIntentRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: row.enabled === 1,
    dry_run: row.dry_run === 1,
    match_containers: safeParseJson(row.match_containers),
    match_images: safeParseJson(row.match_images),
    match_instances: safeParseJson(row.match_instances),
    match_stacks: safeParseJson(row.match_stacks),
    match_registries: safeParseJson(row.match_registries),
    exclude_containers: safeParseJson(row.exclude_containers),
    exclude_images: safeParseJson(row.exclude_images),
    exclude_stacks: safeParseJson(row.exclude_stacks),
    exclude_registries: safeParseJson(row.exclude_registries),
  };
}

/**
 * Safely parse a JSON string, returning null on failure
 * @param {string|null} str - JSON string
 * @returns {*} - Parsed value or null
 */
function safeParseJson(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

module.exports = {
  createIntent,
  getIntentsByUser,
  getIntentById,
  updateIntent,
  deleteIntent,
  toggleIntent,
  getEnabledIntents,
  updateIntentLastExecution,
};
