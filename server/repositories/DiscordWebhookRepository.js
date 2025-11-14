/**
 * Discord Webhook Repository
 * Handles Discord webhook database operations
 */

const BaseRepository = require('./BaseRepository');

class DiscordWebhookRepository extends BaseRepository {
  /**
   * Find all Discord webhooks
   * @param {boolean} sanitize - Whether to sanitize URLs (default: true)
   * @returns {Promise<Array>} - Array of webhook objects
   */
  async findAll(sanitize = true) {
    const webhooks = await super.findAll(
      'SELECT id, webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks ORDER BY created_at ASC',
      []
    );

    if (sanitize) {
      return webhooks.map(row => ({
        id: row.id,
        webhookUrl: row.webhook_url ? '***configured***' : null,
        serverName: row.server_name || null,
        channelName: row.channel_name || null,
        avatarUrl: row.avatar_url || null,
        guildId: row.guild_id || null,
        channelId: row.channel_id || null,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        hasWebhook: !!row.webhook_url,
      }));
    }

    return webhooks;
  }

  /**
   * Find Discord webhook by ID
   * @param {number} id - Webhook ID
   * @returns {Promise<Object|null>} - Webhook object or null
   */
  async findById(id) {
    return await this.findOne(
      'SELECT id, webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, created_at, updated_at FROM discord_webhooks WHERE id = ?',
      [id]
    );
  }

  /**
   * Find all enabled webhooks (for sending notifications)
   * @returns {Promise<Array>} - Array of enabled webhook objects with full URLs
   */
  async findEnabled() {
    const webhooks = await super.findAll(
      'SELECT id, webhook_url, server_name, channel_name FROM discord_webhooks WHERE enabled = 1',
      []
    );
    
    // Return with full URLs (no sanitization)
    return webhooks.map(row => ({
      id: row.id,
      webhookUrl: row.webhook_url,
      serverName: row.server_name || null,
      channelName: row.channel_name || null,
    }));
  }

  /**
   * Create a new Discord webhook
   * @param {Object} data - Webhook data
   * @returns {Promise<number>} - Webhook ID
   */
  async create(data) {
    const { webhookUrl, serverName, channelName, enabled = true, avatarUrl, guildId, channelId } = data;
    const result = await this.execute(
      'INSERT INTO discord_webhooks (webhook_url, server_name, channel_name, avatar_url, guild_id, channel_id, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [webhookUrl, serverName, channelName, avatarUrl, guildId, channelId, enabled ? 1 : 0]
    );
    return result.lastID;
  }

  /**
   * Update a Discord webhook
   * @param {number} id - Webhook ID
   * @param {Object} data - Update data
   * @returns {Promise<void>}
   */
  async update(id, data) {
    const fields = [];
    const values = [];

    const allowedFields = ['webhook_url', 'server_name', 'channel_name', 'avatar_url', 'guild_id', 'channel_id', 'enabled'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'enabled') {
          fields.push(`${field} = ?`);
          values.push(data[field] ? 1 : 0);
        } else {
          fields.push(`${field} = ?`);
          values.push(data[field]);
        }
      }
    }

    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE discord_webhooks SET ${fields.join(', ')} WHERE id = ?`;
    await this.execute(sql, values);
  }

  /**
   * Delete a Discord webhook
   * @param {number} id - Webhook ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.execute('DELETE FROM discord_webhooks WHERE id = ?', [id]);
  }
}

module.exports = DiscordWebhookRepository;

