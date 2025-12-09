/**
 * Discord Repository
 * Handles all Discord webhook-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const discordDb = require("../db/discord");

class DiscordRepository extends BaseRepository {
  /**
   * Find all Discord webhooks for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of webhook objects
   */
  findByUser(userId) {
    return discordDb.getAllDiscordWebhooks(userId);
  }

  /**
   * Find Discord webhook by ID
   * @param {number} id - Webhook ID
   * @returns {Promise<Object|null>} - Webhook object or null
   */
  findById(id) {
    return discordDb.getDiscordWebhookById(id);
  }

  /**
   * Find enabled Discord webhooks for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of enabled webhook objects
   */
  findEnabledByUser(userId) {
    return discordDb.getEnabledDiscordWebhooks(userId);
  }

  /**
   * Create a new Discord webhook
   * @param {number} userId - User ID
   * @param {Object} webhookData - Webhook data
   * @param {string} webhookData.webhookUrl - Webhook URL
   * @param {string} [webhookData.serverName] - Server name
   * @param {string} [webhookData.channelName] - Channel name
   * @param {boolean} [webhookData.enabled=true] - Whether webhook is enabled
   * @param {string} [webhookData.name] - Webhook name
   * @param {string} [webhookData.avatarUrl] - Avatar URL
   * @param {string} [webhookData.guildId] - Guild ID
   * @param {string} [webhookData.channelId] - Channel ID
   * @returns {Promise<number>} - ID of created webhook
   */
  create(userId, webhookData) {
    const {
      webhookUrl,
      serverName = null,
      channelName = null,
      enabled = true,
      name = null,
      avatarUrl = null,
      guildId = null,
      channelId = null,
    } = webhookData;

    return discordDb.createDiscordWebhook(
      userId,
      webhookUrl,
      serverName,
      channelName,
      enabled,
      name,
      avatarUrl,
      guildId,
      channelId,
    );
  }

  /**
   * Update Discord webhook
   * @param {number} id - Webhook ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  update(id, updateData) {
    return discordDb.updateDiscordWebhook(id, updateData);
  }

  /**
   * Delete Discord webhook
   * @param {number} id - Webhook ID
   * @returns {Promise<void>}
   */
  delete(id) {
    return discordDb.deleteDiscordWebhook(id);
  }

  /**
   * Check if a Discord notification has been sent (deduplication)
   * @param {number} userId - User ID
   * @param {string} deduplicationKey - Deduplication key
   * @returns {Promise<boolean>} - True if notification was already sent
   */
  hasNotificationBeenSent(userId, deduplicationKey) {
    return discordDb.hasDiscordNotificationBeenSent(userId, deduplicationKey);
  }

  /**
   * Record that a Discord notification was sent
   * @param {number} userId - User ID
   * @param {string} deduplicationKey - Deduplication key
   * @param {string} notificationType - Notification type (e.g., "tracked-app")
   * @returns {Promise<void>}
   */
  recordNotificationSent(userId, deduplicationKey, notificationType) {
    return discordDb.recordDiscordNotificationSent(
      userId,
      deduplicationKey,
      notificationType,
    );
  }
}

module.exports = DiscordRepository;
