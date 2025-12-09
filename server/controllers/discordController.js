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
    database = require("../db/index");
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
    const refreshPromises = webhooks.map(async webhook => {
      // If webhook has a URL but no avatar URL, try to fetch it from Discord
      if (webhook.hasWebhook && !webhook.avatarUrl) {
        try {
          // Get the full webhook from database to access webhook_url (not exposed in sanitized response)
          const fullWebhook = await getDiscordWebhookById(webhook.id);
          if (fullWebhook && fullWebhook.webhook_url) {
            const webhookInfo = await discord.getWebhookInfo(fullWebhook.webhook_url);
            if (webhookInfo.success && webhookInfo.avatarUrl) {
              // Update the webhook with the avatar URL from Discord
              const updatedAvatarUrl = webhookInfo.avatarUrl;
              await updateDiscordWebhook(webhook.id, { avatarUrl: updatedAvatarUrl });
              // Update the webhook object in the response so it's immediately available
              // Use the value from webhookInfo to avoid race condition
              // eslint-disable-next-line require-atomic-updates -- Using webhookInfo.avatarUrl directly to avoid race condition
              webhook.avatarUrl = webhookInfo.avatarUrl;
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

    // Map database fields (snake_case) to response format (camelCase)
    const formattedWebhooks = webhooks.map(webhook => ({
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
      hasWebhook: Boolean(webhook.webhook_url),
    }));

    return res.json({
      success: true,
      webhooks: formattedWebhooks,
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
    const webhook = await getDiscordWebhookById(parseInt(id, 10));

    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    // Don't expose full webhook URL for security
    return res.json({
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
        hasWebhook: Boolean(webhook.webhook_url),
      },
    });
  } catch (error) {
    logger.error("Error getting Discord webhook:", error);
    next(error);
  }
}

/**
 * Validate webhook URL
 * @param {string} webhookUrl - Webhook URL to validate
 * @returns {Object} - Validation result with isValid and error message
 */
function validateWebhookUrl(webhookUrl) {
  const discord = getDiscordService();
  if (!webhookUrl || !discord.validateWebhookUrl(webhookUrl)) {
    return {
      isValid: false,
      error: "Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}",
    };
  }
  return { isValid: true };
}

/**
 * Check webhook limit
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Result with isWithinLimit and error message
 */
async function checkWebhookLimit(userId) {
  const { getAllDiscordWebhooks } = getDatabase();
  const existingWebhooks = await getAllDiscordWebhooks(userId);
  if (existingWebhooks.length >= 3) {
    return {
      isWithinLimit: false,
      error: "Maximum of 3 webhooks allowed",
    };
  }
  return { isWithinLimit: true };
}

/**
 * Fetch and extract webhook info from Discord
 * @param {string} webhookUrl - Webhook URL
 * @param {string} serverName - Current server name (may be updated)
 * @returns {Promise<Object>} - Webhook info with avatarUrl, guildId, channelId, and updated serverName
 */
async function fetchWebhookInfo(webhookUrl, serverName) {
  const discord = getDiscordService();
  let avatarUrl = null;
  let guildId = null;
  let channelId = null;
  // Preserve the user-provided serverName - only use webhookInfo.name if serverName is not provided
  // If serverName is a non-empty string, always preserve it
  let finalServerName = (serverName && typeof serverName === 'string' && serverName.trim()) ? serverName.trim() : null;

  try {
    const webhookInfo = await discord.getWebhookInfo(webhookUrl);
    if (webhookInfo.success) {
      // Only use webhookInfo.name if serverName was not provided (null, undefined, or empty string)
      // If user provided a serverName, never overwrite it with webhookInfo.name
      if (!finalServerName && webhookInfo.name) {
        finalServerName = webhookInfo.name;
      }
      const { avatarUrl: infoAvatarUrl, guildId: infoGuildId, channelId: infoChannelId } = webhookInfo;
      if (infoAvatarUrl) {
        avatarUrl = infoAvatarUrl;
      }
      if (infoGuildId) {
        guildId = infoGuildId;
      }
      if (infoChannelId) {
        channelId = infoChannelId;
      }
    }
  } catch (error) {
    logger.debug("Could not fetch webhook info:", error);
  }

  return { avatarUrl, guildId, channelId, serverName: finalServerName };
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

    const { webhookUrl, serverName, channelName, enabled } = req.body;

    // Log received serverName for debugging
    logger.debug("Creating Discord webhook - received serverName:", { serverName, type: typeof serverName });

    const limitCheck = await checkWebhookLimit(userId);
    if (!limitCheck.isWithinLimit) {
      return res.status(400).json({
        success: false,
        error: limitCheck.error,
      });
    }

    const urlValidation = validateWebhookUrl(webhookUrl);
    if (!urlValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: urlValidation.error,
      });
    }

    // Preserve user-provided serverName - only fetch from Discord if not provided
    // Normalize serverName: preserve non-empty strings, convert empty strings to null
    const normalizedServerName = (serverName && typeof serverName === 'string' && serverName.trim()) ? serverName.trim() : null;
    
    const { avatarUrl, guildId, channelId, serverName: finalServerName } = await fetchWebhookInfo(
      webhookUrl,
      normalizedServerName,
    );

    logger.debug("After fetchWebhookInfo - finalServerName:", { finalServerName, normalizedServerName });

    const { createDiscordWebhook } = getDatabase();
    // Preserve serverName if it's a non-empty string, otherwise use null
    const finalServerNameToSave = (finalServerName && typeof finalServerName === 'string' && finalServerName.trim()) ? finalServerName.trim() : null;
    
    logger.debug("Saving webhook with serverName:", { finalServerNameToSave });
    const id = await createDiscordWebhook({
      userId,
      webhookUrl,
      serverName: finalServerNameToSave,
      channelName: channelName || null,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      name: null,
      avatarUrl,
      guildId,
      channelId,
    });

    return res.json({
      success: true,
      message: "Discord webhook created successfully",
      id,
    });
  } catch (error) {
    logger.error("Error creating Discord webhook:", error);
    next(error);
  }
}

/**
 * Process webhook URL update
 * @param {string} webhookUrl - New webhook URL
 * @param {Object} updateData - Update data object to modify
 * @returns {Promise<Object|null>} - Error response or null if successful
 */
async function processWebhookUrlUpdate(webhookUrl, updateData) {
  if (webhookUrl === null || webhookUrl === "") {
    return null; // Preserve existing, don't update
  }

  const urlValidation = validateWebhookUrl(webhookUrl);
  if (!urlValidation.isValid) {
    return {
      status: 400,
      error: urlValidation.error,
    };
  }

  updateData.webhookUrl = webhookUrl;
  const { avatarUrl, guildId, channelId } = await fetchWebhookInfo(webhookUrl, null);
  if (avatarUrl) {
    updateData.avatarUrl = avatarUrl;
  }
  if (guildId) {
    updateData.guildId = guildId;
  }
  if (channelId) {
    updateData.channelId = channelId;
  }

  return null;
}

/**
 * Build update data object from request body
 * @param {Object} body - Request body
 * @returns {Promise<Object>} - Update data object
 */
async function buildWebhookUpdateData(body) {
  const { webhookUrl, serverName, channelName, enabled } = body;
  const updateData = {};

  // Log received serverName for debugging
  logger.debug("Updating Discord webhook - received serverName:", { serverName, type: typeof serverName });

  if (webhookUrl !== undefined) {
    const error = await processWebhookUrlUpdate(webhookUrl, updateData);
    if (error) {
      return { error };
    }
  }

  if (serverName !== undefined) {
    // Preserve the serverName if it's a non-empty string, otherwise set to null
    // This allows users to clear the serverName by sending an empty string
    const normalizedServerName = (serverName && typeof serverName === 'string' && serverName.trim()) ? serverName.trim() : null;
    updateData.serverName = normalizedServerName;
    logger.debug("Updating webhook with serverName:", { normalizedServerName });
  }
  if (channelName !== undefined) {
    updateData.channelName = channelName || null;
  }
  if (enabled !== undefined) {
    updateData.enabled = Boolean(enabled);
  }

  return { updateData };
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

    const { getDiscordWebhookById, updateDiscordWebhook } = getDatabase();
    const existing = await getDiscordWebhookById(parseInt(id, 10));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    const result = await buildWebhookUpdateData(req.body);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        error: result.error.error,
      });
    }

    await updateDiscordWebhook(parseInt(id, 10), result.updateData);

    return res.json({
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
    const existing = await getDiscordWebhookById(parseInt(id, 10));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found",
      });
    }

    await deleteDiscordWebhook(parseInt(id, 10));

    return res.json({
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
      return res.json({
        success: true,
        message: "Webhook test successful! Check your Discord channel.",
      });
    }
    return res.status(400).json({
      success: false,
      error: result.error || "Webhook test failed",
    });
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
    const webhook = await getDiscordWebhookById(parseInt(id, 10));

    if (!webhook || !webhook.webhook_url) {
      return res.status(404).json({
        success: false,
        error: "Webhook not found or webhook URL not configured",
      });
    }

    const discord = getDiscordService();
    const result = await discord.testWebhook(webhook.webhook_url);

    if (result.success) {
      return res.json({
        success: true,
        message: "Webhook test successful! Check your Discord channel.",
      });
    }
    return res.status(400).json({
      success: false,
      error: result.error || "Webhook test failed",
    });
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
      return res.json({
        success: true,
        info: {
          name: info.name,
          channelId: info.channelId,
          guildId: info.guildId,
          avatar: info.avatar,
        },
        note: "Discord API only provides webhook name and IDs. Server and channel names require a bot token.",
      });
    }
    return res.status(400).json({
      success: false,
      error: info.error || "Failed to fetch webhook information",
    });
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
function getDiscordBotInvite(req, res, next) {
  try {
    // For webhooks, we don't need a bot invite - webhooks work without a bot
    // But we can provide instructions
    return res.json({
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
    return next(error);
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
