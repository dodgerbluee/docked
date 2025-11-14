/**
 * Discord Controller
 * Handles Discord notification configuration endpoints
 * Uses: Repositories, ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const { sendSuccess, sendCreated, sendNoContent } = require('../utils/responseHelper');
const { NotFoundError, ValidationError, ConflictError } = require('../domain/errors');
const logger = require('../utils/logger');

// Resolve dependencies from container
const discordWebhookRepository = container.resolve('discordWebhookRepository');
const discordService = container.resolve('discordService');

/**
 * Get all Discord webhooks
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDiscordWebhooks(req, res, next) {
  try {
    const webhooks = await discordWebhookRepository.findAll(true); // sanitize URLs
    sendSuccess(res, { webhooks });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single Discord webhook by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDiscordWebhook(req, res, next) {
  try {
    const { id } = req.params;
    const webhook = await discordWebhookRepository.findById(parseInt(id));
    
    if (!webhook) {
      throw new NotFoundError('Discord webhook');
    }

    // Don't expose full webhook URL for security
    const safeWebhook = {
      id: webhook.id,
      webhookUrl: webhook.webhook_url ? '***configured***' : null,
      serverName: webhook.server_name || null,
      channelName: webhook.channel_name || null,
      avatarUrl: webhook.avatar_url || null,
      guildId: webhook.guild_id || null,
      channelId: webhook.channel_id || null,
      enabled: webhook.enabled === 1,
      createdAt: webhook.created_at,
      updatedAt: webhook.updated_at,
      hasWebhook: !!webhook.webhook_url,
    };
    
    sendSuccess(res, { webhook: safeWebhook });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new Discord webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createDiscordWebhookEndpoint(req, res, next) {
  try {
    let { webhookUrl, serverName, channelName, enabled } = req.body;

    // Check webhook limit (max 3)
    const existingWebhooks = await discordWebhookRepository.findAll(false);
    if (existingWebhooks.length >= 3) {
      throw new ValidationError('Maximum of 3 webhooks allowed', 'webhooks');
    }

    // Validate webhook URL
    const discord = discordService;
    if (!webhookUrl || !discord.validateWebhookUrl(webhookUrl)) {
      throw new ValidationError(
        'Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}',
        'webhookUrl',
        webhookUrl
      );
    }

    // Try to fetch webhook info from Discord
    let avatarUrl = null;
    let guildId = null;
    let channelId = null;
    try {
      const webhookInfo = await discord.getWebhookInfo(webhookUrl);
      if (webhookInfo.success) {
        // Use webhook name as server name if not provided
        if (!serverName && webhookInfo.name) {
          serverName = webhookInfo.name;
        }
        
        // Store avatar URL if available
        if (webhookInfo.avatar_url) {
          avatarUrl = webhookInfo.avatar_url;
        }
        
        // Store guild and channel IDs
        if (webhookInfo.guild_id) {
          guildId = webhookInfo.guild_id;
        }
        if (webhookInfo.channel_id) {
          channelId = webhookInfo.channel_id;
        }
      }
    } catch (error) {
      // If fetching webhook info fails, continue anyway - it's optional
      logger.debug('Could not fetch webhook info:', error);
    }

    const id = await discordWebhookRepository.create({
      webhookUrl,
      serverName: serverName || null,
      channelName: channelName || null,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      avatarUrl,
      guildId,
      channelId,
    });

    sendCreated(res, {
      message: 'Discord webhook created successfully',
      id: id,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update a Discord webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateDiscordWebhookEndpoint(req, res, next) {
  try {
    const { id } = req.params;
    const { webhookUrl, serverName, channelName, enabled } = req.body;

    // Check if webhook exists
    const existing = await discordWebhookRepository.findById(parseInt(id));
    if (!existing) {
      throw new NotFoundError('Discord webhook');
    }

    // Build update data
    const updateData = {};
    
    // Handle webhook URL - if provided and not empty, validate and update; if empty, preserve existing
    if (webhookUrl !== undefined) {
      if (webhookUrl === null || webhookUrl === '') {
        // Empty string or null means preserve existing (don't update)
        // Don't add to updateData
      } else {
        // Validate webhook URL if provided
        const discord = discordService;
        if (!discord.validateWebhookUrl(webhookUrl)) {
          throw new ValidationError(
            'Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}',
            'webhookUrl',
            webhookUrl
          );
        }
        updateData.webhookUrl = webhookUrl;
        
        // Fetch webhook info to get avatar and IDs if URL is being updated
        try {
          const webhookInfo = await discord.getWebhookInfo(webhookUrl);
          if (webhookInfo.success) {
            if (webhookInfo.avatar_url) {
              updateData.avatarUrl = webhookInfo.avatar_url;
            }
            if (webhookInfo.guild_id) {
              updateData.guildId = webhookInfo.guild_id;
            }
            if (webhookInfo.channel_id) {
              updateData.channelId = webhookInfo.channel_id;
            }
          }
        } catch (error) {
          logger.debug('Could not fetch webhook info for update:', error);
        }
      }
    }
    if (serverName !== undefined) {
      updateData.serverName = serverName || null;
    }
    if (channelName !== undefined) {
      updateData.channelName = channelName || null;
    }
    if (enabled !== undefined) {
      updateData.enabled = Boolean(enabled);
    }

    // Map field names to database column names
    const dbUpdateData = {};
    if (updateData.webhookUrl !== undefined) dbUpdateData.webhook_url = updateData.webhookUrl;
    if (updateData.serverName !== undefined) dbUpdateData.server_name = updateData.serverName;
    if (updateData.channelName !== undefined) dbUpdateData.channel_name = updateData.channelName;
    if (updateData.avatarUrl !== undefined) dbUpdateData.avatar_url = updateData.avatarUrl;
    if (updateData.guildId !== undefined) dbUpdateData.guild_id = updateData.guildId;
    if (updateData.channelId !== undefined) dbUpdateData.channel_id = updateData.channelId;
    if (updateData.enabled !== undefined) dbUpdateData.enabled = updateData.enabled;

    await discordWebhookRepository.update(parseInt(id), dbUpdateData);

    sendSuccess(res, { message: 'Discord webhook updated successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a Discord webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteDiscordWebhookEndpoint(req, res, next) {
  try {
    const { id } = req.params;

    // Check if webhook exists
    const existing = await discordWebhookRepository.findById(parseInt(id));
    if (!existing) {
      throw new NotFoundError('Discord webhook');
    }

    await discordWebhookRepository.delete(parseInt(id));

    sendSuccess(res, { message: 'Discord webhook deleted successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Test Discord webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function testDiscordWebhook(req, res, next) {
  try {
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      throw new ValidationError('Webhook URL is required', 'webhookUrl');
    }

    const discord = discordService;
    if (!discord || !discord.validateWebhookUrl(webhookUrl)) {
      throw new ValidationError('Invalid webhook URL format', 'webhookUrl', webhookUrl);
    }

    const result = await discord.testWebhook(webhookUrl);

    if (result.success) {
      sendSuccess(res, { message: 'Webhook test successful! Check your Discord channel.' });
    } else {
      const { ExternalServiceError } = require('../domain/errors');
      throw new ExternalServiceError('Discord', result.error || 'Webhook test failed', 400);
    }
  } catch (error) {
    logger.error('Error testing Discord webhook:', error);
    next(error);
  }
}

/**
 * Test Discord webhook by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function testDiscordWebhookById(req, res, next) {
  try {
    const { id } = req.params;

    // Get webhook from database
    const webhook = await discordWebhookRepository.findById(parseInt(id));
    
    if (!webhook || !webhook.webhook_url) {
      throw new NotFoundError('Discord webhook or webhook URL not configured');
    }

    const discord = discordService;
    if (!discord) {
      throw new ExternalServiceError('Discord', 'Discord service not available');
    }
    const result = await discord.testWebhook(webhook.webhook_url);

    if (result.success) {
      sendSuccess(res, { message: 'Webhook test successful! Check your Discord channel.' });
    } else {
      const { ExternalServiceError } = require('../domain/errors');
      throw new ExternalServiceError('Discord', result.error || 'Webhook test failed', 400);
    }
  } catch (error) {
    logger.error('Error testing Discord webhook by ID:', error);
    next(error);
  }
}

/**
 * Get webhook information from Discord
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getWebhookInfo(req, res, next) {
  try {
    const { webhookUrl } = req.query;

    if (!webhookUrl) {
      throw new ValidationError('Webhook URL is required', 'webhookUrl');
    }

    const discord = discordService;
    if (!discord) {
      throw new ExternalServiceError('Discord', 'Discord service not available');
    }
    const info = await discord.getWebhookInfo(webhookUrl);

    if (info.success) {
      sendSuccess(res, {
        info: {
          name: info.name,
          channel_id: info.channel_id,
          guild_id: info.guild_id,
          avatar: info.avatar,
        },
        note: 'Discord API only provides webhook name and IDs. Server and channel names require a bot token.',
      });
    } else {
      const { ExternalServiceError } = require('../domain/errors');
      throw new ExternalServiceError('Discord', info.error || 'Failed to fetch webhook information', 400);
    }
  } catch (error) {
    logger.error('Error getting webhook info:', error);
    next(error);
  }
}

/**
 * Get Discord bot invite URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDiscordBotInvite(req, res, next) {
  try {
    // For webhooks, we don't need a bot invite - webhooks work without a bot
    // But we can provide instructions
    sendSuccess(res, {
      message: 'Discord webhooks do not require a bot invite. Simply create a webhook in your Discord channel settings.',
      instructions: [
        '1. Open your Discord server',
        '2. Go to Server Settings > Integrations > Webhooks',
        '3. Click "New Webhook"',
        '4. Configure the webhook (name, channel, etc.)',
        '5. Copy the webhook URL',
        '6. Paste it in the Discord settings below',
      ],
    });
  } catch (error) {
    logger.error('Error getting Discord bot invite:', error);
    next(error);
  }
}

module.exports = {
  getDiscordWebhooks,
  getDiscordWebhook,
  createDiscordWebhook: createDiscordWebhookEndpoint,
  updateDiscordWebhook: updateDiscordWebhookEndpoint,
  deleteDiscordWebhook: deleteDiscordWebhookEndpoint,
  testDiscordWebhook,
  testDiscordWebhookById,
  getWebhookInfo,
  getDiscordBotInvite,
};

