/**
 * Discord Controller
 * Handles Discord notification configuration endpoints
 */

const discordService = require('../services/discordService');
const logger = require('../utils/logger');

/**
 * Get Discord configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDiscordConfig(req, res, next) {
  try {
    const config = await discordService.getDiscordConfig();
    
    // Don't expose full webhook URL for security, just indicate if it's set
    res.json({
      success: true,
      config: {
        webhookUrl: config.webhookUrl ? '***configured***' : null,
        channelId: config.channelId || null,
        enabled: config.enabled,
        hasWebhook: !!config.webhookUrl,
      },
    });
  } catch (error) {
    logger.error('Error getting Discord config:', error);
    next(error);
  }
}

/**
 * Update Discord configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateDiscordConfig(req, res, next) {
  try {
    const { webhookUrl, channelId, enabled } = req.body;

    // Get current config to preserve webhook URL if not provided
    const currentConfig = await discordService.getDiscordConfig();

    // Determine the webhook URL to use
    let finalWebhookUrl = currentConfig.webhookUrl;
    if (webhookUrl !== undefined) {
      if (webhookUrl === null || webhookUrl === '') {
        // Empty string or null means clear the webhook
        finalWebhookUrl = null;
      } else {
        // Validate webhook URL if provided
        if (!discordService.validateWebhookUrl(webhookUrl)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}',
          });
        }
        finalWebhookUrl = webhookUrl;
      }
    }

    // Update configuration
    await discordService.updateDiscordConfig({
      webhookUrl: finalWebhookUrl,
      channelId: channelId !== undefined ? (channelId || null) : undefined,
      enabled: enabled !== undefined ? Boolean(enabled) : undefined,
    });

    res.json({
      success: true,
      message: 'Discord configuration updated successfully',
    });
  } catch (error) {
    logger.error('Error updating Discord config:', error);
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
        error: 'Webhook URL is required',
      });
    }

    if (!discordService.validateWebhookUrl(webhookUrl)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook URL format',
      });
    }

    const result = await discordService.testWebhook(webhookUrl);

    if (result.success) {
      res.json({
        success: true,
        message: 'Webhook test successful! Check your Discord channel.',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Webhook test failed',
      });
    }
  } catch (error) {
    logger.error('Error testing Discord webhook:', error);
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
  getDiscordConfig,
  updateDiscordConfig,
  testDiscordWebhook,
  getDiscordBotInvite,
};

