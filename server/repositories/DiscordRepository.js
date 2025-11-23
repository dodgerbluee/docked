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
  async findByUser(userId) {
    return await discordDb.getAllDiscordWebhooks(userId);
  }

  /**
   * Find Discord webhook by ID
   * @param {number} id - Webhook ID
   * @returns {Promise<Object|null>} - Webhook object or null
   */
  async findById(id) {
    return await discordDb.getDiscordWebhookById(id);
  }

  /**
   * Find enabled Discord webhooks for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of enabled webhook objects
   */
  async findEnabledByUser(userId) {
    return await discordDb.getEnabledDiscordWebhooks(userId);
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
  async create(userId, webhookData) {
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

    return await discordDb.createDiscordWebhook(
      userId,
      webhookUrl,
      serverName,
      channelName,
      enabled,
      name,
      avatarUrl,
      guildId,
      channelId
    );
  }

  /**
   * Update Discord webhook
   * @param {number} id - Webhook ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  async update(id, updateData) {
    return await discordDb.updateDiscordWebhook(id, updateData);
  }

  /**
   * Delete Discord webhook
   * @param {number} id - Webhook ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    return await discordDb.deleteDiscordWebhook(id);
  }

  /**
   * Check if a Discord notification has been sent (deduplication)
   * @param {number} userId - User ID
   * @param {string} deduplicationKey - Deduplication key
   * @returns {Promise<boolean>} - True if notification was already sent
   */
  async hasNotificationBeenSent(userId, deduplicationKey) {
    return await discordDb.hasDiscordNotificationBeenSent(userId, deduplicationKey);
  }

  /**
   * Record that a Discord notification was sent
   * @param {number} userId - User ID
   * @param {string} deduplicationKey - Deduplication key
   * @param {string} notificationType - Notification type (e.g., "tracked-app")
   * @returns {Promise<void>}
   */
  async recordNotificationSent(userId, deduplicationKey, notificationType) {
    return await discordDb.recordDiscordNotificationSent(userId, deduplicationKey, notificationType);
  }
}

module.exports = DiscordRepository;

