/**
 * Auto-Update Intents Database Module
 *
 * Handles all database operations for auto-update intents.
 * Auto-update intents persist user decisions to automatically upgrade
 * containers matching certain criteria (stack+service, image repo, container name).
 *
 * Intents survive Portainer database wipes and re-attach after re-ingestion.
 */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");

/**
 * Create a new auto-update intent
 * @param {number} userId - User ID
 * @param {Object} intentData - Intent configuration
 * @returns {Promise<number>} - ID of created intent
 */
function createIntent(userId, intentData) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          const {
            stackName = null,
            serviceName = null,
            imageRepo = null,
            containerName = null,
            enabled = 0,
            notifyDiscord = 0,
            notifyOnUpdateDetected = 0,
            notifyOnBatchStart = 0,
            notifyOnSuccess = 0,
            notifyOnFailure = 0,
            description = null,
          } = intentData;

          // Validate that at least one matching criterion is set
          if (!stackName && !imageRepo && !containerName) {
            return reject(
              new Error(
                "At least one matching criterion (stackName, imageRepo, or containerName) must be provided"
              )
            );
          }

          db.run(
            `INSERT INTO auto_update_intents (
              user_id, stack_name, service_name, image_repo, container_name,
              enabled, notify_discord, notify_on_update_detected, notify_on_batch_start,
              notify_on_success, notify_on_failure, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              stackName,
              serviceName,
              imageRepo,
              containerName,
              enabled ? 1 : 0,
              notifyDiscord ? 1 : 0,
              notifyOnUpdateDetected ? 1 : 0,
              notifyOnBatchStart ? 1 : 0,
              notifyOnSuccess ? 1 : 0,
              notifyOnFailure ? 1 : 0,
              description,
            ],
            function (err) {
              if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                  return reject(
                    new Error(
                      "An intent with these matching criteria already exists for this user"
                    )
                  );
                }
                return reject(err);
              }
              resolve(this.lastID);
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Get a specific intent by ID
 * @param {number} userId - User ID
 * @param {number} intentId - Intent ID
 * @returns {Promise<Object>} - Intent object or null if not found
 */
function getIntent(userId, intentId) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.get(
            `SELECT * FROM auto_update_intents WHERE id = ? AND user_id = ?`,
            [intentId, userId],
            (err, row) => {
              if (err) return reject(err);
              resolve(row || null);
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * List all intents for a user
 * @param {number} userId - User ID
 * @param {Object} filters - Optional filters
 * @param {boolean} filters.enabledOnly - If true, return only enabled intents
 * @returns {Promise<Array>} - Array of intent objects
 */
function listIntents(userId, filters = {}) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          let query = `SELECT * FROM auto_update_intents WHERE user_id = ?`;
          const params = [userId];

          if (filters.enabledOnly) {
            query += ` AND enabled = 1`;
          }

          query += ` ORDER BY created_at DESC`;

          db.all(query, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
          });
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Update an intent
 * @param {number} userId - User ID
 * @param {number} intentId - Intent ID
 * @param {Object} updateData - Fields to update
 * @returns {Promise<void>}
 */
function updateIntent(userId, intentId, updateData) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();

          // Build update query dynamically based on provided fields
          const allowedFields = [
            "stackName",
            "serviceName",
            "imageRepo",
            "containerName",
            "enabled",
            "notifyDiscord",
            "notifyOnUpdateDetected",
            "notifyOnBatchStart",
            "notifyOnSuccess",
            "notifyOnFailure",
            "description",
          ];

          const fieldMap = {
            stackName: "stack_name",
            serviceName: "service_name",
            imageRepo: "image_repo",
            containerName: "container_name",
            notifyDiscord: "notify_discord",
            notifyOnUpdateDetected: "notify_on_update_detected",
            notifyOnBatchStart: "notify_on_batch_start",
            notifyOnSuccess: "notify_on_success",
            notifyOnFailure: "notify_on_failure",
          };

          const updates = [];
          const values = [];

          for (const [key, value] of Object.entries(updateData)) {
            if (allowedFields.includes(key)) {
              const dbField = fieldMap[key] || key;
              updates.push(`${dbField} = ?`);
              // Convert boolean to integer for database
              values.push(
                typeof value === "boolean" ? (value ? 1 : 0) : value
              );
            }
          }

          if (updates.length === 0) {
            return resolve(); // No updates to make
          }

          // Always update the updated_at timestamp
          updates.push("updated_at = CURRENT_TIMESTAMP");

          const query =
            `UPDATE auto_update_intents SET ${updates.join(", ")} ` +
            `WHERE id = ? AND user_id = ?`;
          values.push(intentId, userId);

          db.run(query, values, function (err) {
            if (err) {
              if (err.message.includes("UNIQUE constraint failed")) {
                return reject(
                  new Error(
                    "An intent with these matching criteria already exists for this user"
                  )
                );
              }
              return reject(err);
            }
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Delete an intent
 * @param {number} userId - User ID
 * @param {number} intentId - Intent ID
 * @returns {Promise<void>}
 */
function deleteIntent(userId, intentId) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            `DELETE FROM auto_update_intents WHERE id = ? AND user_id = ?`,
            [intentId, userId],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Enable an intent
 * @param {number} userId - User ID
 * @param {number} intentId - Intent ID
 * @returns {Promise<void>}
 */
function enableIntent(userId, intentId) {
  return updateIntent(userId, intentId, { enabled: true });
}

/**
 * Disable an intent
 * @param {number} userId - User ID
 * @param {number} intentId - Intent ID
 * @returns {Promise<void>}
 */
function disableIntent(userId, intentId) {
  return updateIntent(userId, intentId, { enabled: false });
}

module.exports = {
  createIntent,
  getIntent,
  listIntents,
  updateIntent,
  deleteIntent,
  enableIntent,
  disableIntent,
};
