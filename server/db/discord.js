/**
 * Discord Database Module
 *
 * Handles all Discord webhook-related database operations including:
 * - Discord webhook CRUD operations
 * - Notification deduplication tracking
 */

const { getDatabase } = require("./connection");

/**
 * Get all Discord webhooks for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of webhook objects
 */
function getAllDiscordWebhooks(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      // Check if user_id column exists
      db.get(
        "SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'",
        [],
        (colErr, colRow) => {
          if (colErr) {
            reject(colErr);
            return;
          }
          const hasUserId = !!colRow;
          const query =
            hasUserId && userId
              ? "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE user_id = ? ORDER BY created_at DESC"
              : "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks ORDER BY created_at DESC";
          const params = hasUserId && userId ? [userId] : [];

          db.all(query, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          });
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get a Discord webhook by ID
 * @param {number} id - Webhook ID
 * @returns {Promise<Object|null>} - Webhook object or null
 */
function getDiscordWebhookById(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE id = ?",
        [id],
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
 * Create a new Discord webhook
 * @param {number} userId - User ID
 * @param {string} webhookUrl - Webhook URL
 * @param {string} serverName - Server name (optional)
 * @param {string} channelName - Channel name (optional)
 * @param {boolean} enabled - Whether webhook is enabled
 * @param {string} name - Webhook name (optional)
 * @param {string} avatarUrl - Avatar URL (optional)
 * @param {string} guildId - Guild ID (optional)
 * @param {string} channelId - Channel ID (optional)
 * @returns {Promise<number>} - ID of created webhook
 */
function createDiscordWebhook(
  userId,
  webhookUrl,
  serverName = null,
  channelName = null,
  enabled = true,
  name = null,
  avatarUrl = null,
  guildId = null,
  channelId = null
) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      // Check if user_id column exists
      db.get(
        "SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'",
        [],
        (colErr, colRow) => {
          if (colErr) {
            reject(colErr);
            return;
          }
          const hasUserId = !!colRow;
          const insertQuery =
            hasUserId && userId
              ? "INSERT INTO discord_webhooks (user_id, webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
              : "INSERT INTO discord_webhooks (webhook_url, server_name, channel_name, name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)";
          const insertParams =
            hasUserId && userId
              ? [
                  userId,
                  webhookUrl,
                  serverName,
                  channelName,
                  name,
                  avatarUrl,
                  guildId,
                  channelId,
                  enabled ? 1 : 0,
                ]
              : [
                  webhookUrl,
                  serverName,
                  channelName,
                  name,
                  avatarUrl,
                  guildId,
                  channelId,
                  enabled ? 1 : 0,
                ];

          db.run(insertQuery, insertParams, function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.lastID);
            }
          });
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update a Discord webhook
 * @param {number} id - Webhook ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
function updateDiscordWebhook(id, updateData) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.webhookUrl !== undefined) {
        fields.push("webhook_url = ?");
        values.push(updateData.webhookUrl);
      }
      if (updateData.serverName !== undefined) {
        fields.push("server_name = ?");
        values.push(updateData.serverName);
      }
      if (updateData.channelName !== undefined) {
        fields.push("channel_name = ?");
        values.push(updateData.channelName);
      }
      if (updateData.name !== undefined) {
        fields.push("name = ?");
        values.push(updateData.name);
      }
      if (updateData.avatarUrl !== undefined) {
        fields.push("avatar_url = ?");
        values.push(updateData.avatarUrl);
      }
      if (updateData.guildId !== undefined) {
        fields.push("guild_id = ?");
        values.push(updateData.guildId);
      }
      if (updateData.channelId !== undefined) {
        fields.push("channel_id = ?");
        values.push(updateData.channelId);
      }
      if (updateData.enabled !== undefined) {
        fields.push("enabled = ?");
        values.push(updateData.enabled ? 1 : 0);
      }

      if (fields.length === 0) {
        resolve();
        return;
      }

      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);

      const sql = `UPDATE discord_webhooks SET ${fields.join(", ")} WHERE id = ?`;

      db.run(sql, values, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete a Discord webhook
 * @param {number} id - Webhook ID
 * @returns {Promise<void>}
 */
function deleteDiscordWebhook(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run("DELETE FROM discord_webhooks WHERE id = ?", [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all enabled Discord webhooks for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Array of enabled webhook objects with full URLs
 */
function getEnabledDiscordWebhooks(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      // Check if user_id column exists, if not, query without it
      db.get(
        "SELECT name FROM pragma_table_info('discord_webhooks') WHERE name = 'user_id'",
        [],
        (colErr, colRow) => {
          if (colErr) {
            reject(colErr);
            return;
          }
          const hasUserId = !!colRow;
          const query =
            hasUserId && userId
              ? "SELECT id, webhook_url, server_name, channel_name, name FROM discord_webhooks WHERE enabled = 1 AND user_id = ?"
              : "SELECT id, webhook_url, server_name, channel_name, name FROM discord_webhooks WHERE enabled = 1";
          const params = hasUserId && userId ? [userId] : [];

          db.all(query, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          });
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Check if a Discord notification has already been sent for a given deduplication key
 * @param {number} userId - User ID
 * @param {string} deduplicationKey - Deduplication key (e.g., "userId:imageName:sha256digest")
 * @returns {Promise<boolean>} - True if notification was already sent
 */
function hasDiscordNotificationBeenSent(userId, deduplicationKey) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT id FROM discord_notifications_sent WHERE user_id = ? AND deduplication_key = ?",
        [userId, deduplicationKey],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!row);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Record that a Discord notification has been sent
 * @param {number} userId - User ID
 * @param {string} deduplicationKey - Deduplication key (e.g., "userId:imageName:sha256digest")
 * @param {string} notificationType - Type of notification (e.g., "tracked-app", "portainer-container")
 * @returns {Promise<void>}
 */
function recordDiscordNotificationSent(userId, deduplicationKey, notificationType) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      // Use INSERT OR IGNORE to handle race conditions gracefully
      db.run(
        "INSERT OR IGNORE INTO discord_notifications_sent (user_id, deduplication_key, notification_type) VALUES (?, ?, ?)",
        [userId, deduplicationKey, notificationType],
        (err) => {
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

module.exports = {
  getAllDiscordWebhooks,
  getDiscordWebhookById,
  createDiscordWebhook,
  updateDiscordWebhook,
  deleteDiscordWebhook,
  getEnabledDiscordWebhooks,
  hasDiscordNotificationBeenSent,
  recordDiscordNotificationSent,
};
