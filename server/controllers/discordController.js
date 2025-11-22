/**
 * Discord Controller
 * Handles Discord notification configuration endpoints
 */

// Lazy load to avoid initialization issues
let discordService = null;
function getDiscordService() {
  if (!discordService) {
    discordService = require("../services/discordService");
  }
  return discordService;
}

let database = null;
function getDatabase() {
  if (!database) {
    database = require("../db/database");
  }
  return database;
}

const logger = require("../utils/logger");

/**
 * Get all Discord webhooks
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDiscordWebhooks(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { getAllDiscordWebhooks, getDiscordWebhookById, updateDiscordWebhook } = getDatabase();
    const webhooks = await getAllDiscordWebhooks(userId);
    
    // Refresh avatar URLs for webhooks that don't have them
    // This ensures webhook avatars from Discord are always displayed correctly
    // This is important because webhooks should show their Discord avatar, not user avatars
    const discord = getDiscordService();
    const refreshPromises = webhooks.map(async (webhook) => {
      // If webhook has a URL but no avatar URL, try to fetch it from Discord
      if (webhook.hasWebhook && !webhook.avatarUrl) {
        try {
          // Get the full webhook from database to access webhook_url (not exposed in sanitized response)
          const fullWebhook = await getDiscordWebhookById(webhook.id);
          if (fullWebhook && fullWebhook.webhook_url) {
            const webhookInfo = await discord.getWebhookInfo(fullWebhook.webhook_url);
            if (webhookInfo.success && webhookInfo.avatar_url) {
              // Update the webhook with the avatar URL from Discord
              await updateDiscordWebhook(webhook.id, { avatarUrl: webhookInfo.avatar_url });
              // Update the webhook object in the response so it's immediately available
              webhook.avatarUrl = webhookInfo.avatar_url;
              logger.info(`Refreshed avatar URL for webhook ${webhook.id} from Discord`);
            }
          }
        } catch (error) {
          // Non-blocking: if we can't fetch avatar, continue with existing data
          // The frontend will show default avatar as fallback
          logger.debug(`Could not refresh avatar URL for webhook ${webhook.id}:`, error.message);
        }
      }
    });
    
    // Wait for all refresh attempts to complete (non-blocking)
    // This ensures webhooks get their Discord avatars even if they were created before avatar support
    await Promise.allSettled(refreshPromises);
    
    res.json({
      success: true,
      webhooks: webhooks,
    });
  } catch (error) {
    logger.error("Error getting Discord webhooks:", error);
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
    const { getDiscordWebhookById } = getDatabase();
    const webhook = await getDiscordWebhookById(parseInt(id));

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    // Don't expose full webhook URL for security
    res.json({
      success: true,
      webhook: {
        id: webhook.id,
        webhookUrl: webhook.webhook_url ? "***configured***" : null,
        serverName: webhook.server_name || null,
        channelName: webhook.channel_name || null,
        avatarUrl: webhook.avatar_url || null,
        guildId: webhook.guild_id || null,
        channelId: webhook.channel_id || null,
        enabled: webhook.enabled === 1,
        name: webhook.name || null,
        createdAt: webhook.created_at,
        updatedAt: webhook.updated_at,
        hasWebhook: !!webhook.webhook_url,
      },
    });
  } catch (error) {
    logger.error("Error getting Discord webhook:", error);
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    let { webhookUrl, serverName, channelName, enabled } = req.body;

    // Check webhook limit (max 3)
    const { getAllDiscordWebhooks, createDiscordWebhook } = getDatabase();
    const existingWebhooks = await getAllDiscordWebhooks(userId);
    if (existingWebhooks.length >= 3) {
      return res.status(400).json({
        success: false,
        error: "Maximum of 3 webhooks allowed",
      });
    }

    // Validate webhook URL
    const discord = getDiscordService();
    if (!webhookUrl || !discord.validateWebhookUrl(webhookUrl)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}",
      });
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
      logger.debug("Could not fetch webhook info:", error);
    }

    const id = await createDiscordWebhook(
      userId,
      webhookUrl,
      serverName || null,
      channelName || null,
      enabled !== undefined ? Boolean(enabled) : true,
      avatarUrl,
      guildId,
      channelId
    );

    res.json({
      success: true,
      message: "Discord webhook created successfully",
      id: id,
    });
  } catch (error) {
    logger.error("Error creating Discord webhook:", error);
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
    const { getDiscordWebhookById, updateDiscordWebhook } = getDatabase();
    const existing = await getDiscordWebhookById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    // Build update data
    const updateData = {};

    // Handle webhook URL - if provided and not empty, validate and update; if empty, preserve existing
    if (webhookUrl !== undefined) {
      if (webhookUrl === null || webhookUrl === "") {
        // Empty string or null means preserve existing (don't update)
        // Don't add to updateData
      } else {
        // Validate webhook URL if provided
        const discord = getDiscordService();
        if (!discord.validateWebhookUrl(webhookUrl)) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}",
          });
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
          logger.debug("Could not fetch webhook info for update:", error);
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

    await updateDiscordWebhook(parseInt(id), updateData);

    res.json({
      success: true,
      message: "Discord webhook updated successfully",
    });
  } catch (error) {
    logger.error("Error updating Discord webhook:", error);
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
    const { getDiscordWebhookById, deleteDiscordWebhook } = getDatabase();
    const existing = await getDiscordWebhookById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    await deleteDiscordWebhook(parseInt(id));

    res.json({
      success: true,
      message: "Discord webhook deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting Discord webhook:", error);
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
      return res.status(400).json({
        success: false,
        error: "Webhook URL is required",
      });
    }

    const discord = getDiscordService();
    if (!discord.validateWebhookUrl(webhookUrl)) {
      return res.status(400).json({
        success: false,
        error: "Invalid webhook URL format",
      });
    }

    const result = await discord.testWebhook(webhookUrl);

    if (result.success) {
      res.json({
        success: true,
        message: "Webhook test successful! Check your Discord channel.",
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Webhook test failed",
      });
    }
  } catch (error) {
    logger.error("Error testing Discord webhook:", error);
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
    const { getDiscordWebhookById } = getDatabase();
    const webhook = await getDiscordWebhookById(parseInt(id));

    if (!webhook || !webhook.webhook_url) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found or webhook URL not configured",
      });
    }

    const discord = getDiscordService();
    const result = await discord.testWebhook(webhook.webhook_url);

    if (result.success) {
      res.json({
        success: true,
        message: "Webhook test successful! Check your Discord channel.",
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Webhook test failed",
      });
    }
  } catch (error) {
    logger.error("Error testing Discord webhook by ID:", error);
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
      return res.status(400).json({
        success: false,
        error: "Webhook URL is required",
      });
    }

    const discord = getDiscordService();
    const info = await discord.getWebhookInfo(webhookUrl);

    if (info.success) {
      res.json({
        success: true,
        info: {
          name: info.name,
          channel_id: info.channel_id,
          guild_id: info.guild_id,
          avatar: info.avatar,
        },
        note: "Discord API only provides webhook name and IDs. Server and channel names require a bot token.",
      });
    } else {
      res.status(400).json({
        success: false,
        error: info.error || "Failed to fetch webhook information",
      });
    }
  } catch (error) {
    logger.error("Error getting webhook info:", error);
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
    res.json({
      success: true,
      message:
        "Discord webhooks do not require a bot invite. Simply create a webhook in your Discord channel settings.",
      instructions: [
        "1. Open your Discord server",
        "2. Go to Server Settings > Integrations > Webhooks",
        '3. Click "New Webhook"',
        "4. Configure the webhook (name, channel, etc.)",
        "5. Copy the webhook URL",
        "6. Paste it in the Discord settings below",
      ],
    });
  } catch (error) {
    logger.error("Error getting Discord bot invite:", error);
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
