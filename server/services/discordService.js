/**
 * Discord Notification Service
 * Handles sending notifications to Discord webhooks with best practices:
 * - Rich embeds with proper formatting
 * - Retry logic with exponential backoff
 * - Rate limiting handling
 * - Queue management
 * - Error handling and logging
 * - Deduplication
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Lazy load database functions to avoid initialization issues
function getDatabase() {
  return require('../db/database');
}

// Discord webhook rate limits: 30 requests per 60 seconds per webhook
const DISCORD_RATE_LIMIT = 30;
const DISCORD_RATE_LIMIT_WINDOW = 60000; // 60 seconds in milliseconds
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 100;

// In-memory queue for notifications
const notificationQueue = [];
let isProcessingQueue = false;
let rateLimitTracker = new Map(); // webhookUrl -> { count, resetAt }

// Deduplication: Track recent notifications to prevent duplicates
const recentNotifications = new Map(); // key -> timestamp
const DEDUPLICATION_WINDOW = 5 * 60 * 1000; // 5 minutes

/**
 * Sleep utility for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * Validate webhook URL format
 * @param {string} webhookUrl - Webhook URL to validate
 * @returns {boolean} - True if valid
 */
function validateWebhookUrl(webhookUrl) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return false;
  }
  // Discord webhook URLs follow pattern: https://discord.com/api/webhooks/{id}/{token}
  const webhookPattern = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
  return webhookPattern.test(webhookUrl.trim());
}

/**
 * Test webhook connectivity
 * @param {string} webhookUrl - Webhook URL to test
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testWebhook(webhookUrl) {
  if (!validateWebhookUrl(webhookUrl)) {
    return { success: false, error: 'Invalid webhook URL format' };
  }

  try {
    const testPayload = {
      embeds: [{
        title: '🔧 Webhook Test',
        description: 'This is a test notification from Docked. If you see this, your webhook is configured correctly!',
        color: 3066993, // Green
        timestamp: new Date().toISOString(),
        footer: { text: 'Docked System' },
      }],
    };

    const response = await axios.post(webhookUrl, testPayload, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true, // Don't throw on any status
    });

    if (response.status >= 200 && response.status < 300) {
      return { success: true };
    } else {
      const errorText = response.data ? JSON.stringify(response.data) : response.statusText || 'Unknown error';
      return { success: false, error: `Webhook returned status ${response.status}: ${errorText}` };
    }
  } catch (error) {
    logger.error('Error testing webhook:', error);
    return { success: false, error: error.message || 'Failed to connect to webhook' };
  }
}

/**
 * Check if we're rate limited for a webhook
 * @param {string} webhookUrl - Webhook URL
 * @returns {boolean} - True if rate limited
 */
function isRateLimited(webhookUrl) {
  const tracker = rateLimitTracker.get(webhookUrl);
  if (!tracker) {
    return false;
  }

  const now = Date.now();
  if (now > tracker.resetAt) {
    // Reset window expired, clear tracker
    rateLimitTracker.delete(webhookUrl);
    return false;
  }

  return tracker.count >= DISCORD_RATE_LIMIT;
}

/**
 * Record a request for rate limiting
 * @param {string} webhookUrl - Webhook URL
 */
function recordRequest(webhookUrl) {
  const tracker = rateLimitTracker.get(webhookUrl);
  const now = Date.now();

  if (!tracker || now > tracker.resetAt) {
    // New window or expired window
    rateLimitTracker.set(webhookUrl, {
      count: 1,
      resetAt: now + DISCORD_RATE_LIMIT_WINDOW,
    });
  } else {
    tracker.count++;
  }
}

/**
 * Get time until rate limit resets
 * @param {string} webhookUrl - Webhook URL
 * @returns {number} - Milliseconds until reset
 */
function getRateLimitResetTime(webhookUrl) {
  const tracker = rateLimitTracker.get(webhookUrl);
  if (!tracker) {
    return 0;
  }

  const now = Date.now();
  if (now > tracker.resetAt) {
    return 0;
  }

  return tracker.resetAt - now;
}

/**
 * Create deduplication key for a notification
 * @param {Object} notification - Notification data
 * @returns {string} - Deduplication key
 */
function createDeduplicationKey(notification) {
  // Use image name and latest version as key
  const imageName = notification.imageName || notification.name || '';
  const latestVersion = notification.latestVersion || '';
  return `${imageName}:${latestVersion}`;
}

/**
 * Check if notification is a duplicate
 * @param {string} key - Deduplication key
 * @returns {boolean} - True if duplicate
 */
function isDuplicate(key) {
  const timestamp = recentNotifications.get(key);
  if (!timestamp) {
    return false;
  }

  const now = Date.now();
  if (now - timestamp > DEDUPLICATION_WINDOW) {
    // Outside deduplication window, remove old entry
    recentNotifications.delete(key);
    return false;
  }

  return true;
}

/**
 * Record notification for deduplication
 * @param {string} key - Deduplication key
 */
function recordNotification(key) {
  recentNotifications.set(key, Date.now());

  // Clean up old entries periodically
  if (recentNotifications.size > 1000) {
    const now = Date.now();
    for (const [k, timestamp] of recentNotifications.entries()) {
      if (now - timestamp > DEDUPLICATION_WINDOW) {
        recentNotifications.delete(k);
      }
    }
  }
}

/**
 * Send notification to Discord webhook with retry logic
 * @param {string} webhookUrl - Webhook URL
 * @param {Object} payload - Discord webhook payload
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendNotificationWithRetry(webhookUrl, payload, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Check rate limit before sending
      if (isRateLimited(webhookUrl)) {
        const waitTime = getRateLimitResetTime(webhookUrl);
        if (waitTime > 0) {
          logger.warn(`Rate limited for webhook, waiting ${waitTime}ms`);
          await sleep(waitTime);
        }
      }

      const response = await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true, // Don't throw on any status, handle manually
      });

      // Record request for rate limiting
      recordRequest(webhookUrl);

      if (response.status === 429) {
        // Rate limited - get retry-after header
        const retryAfter = parseInt(response.headers['retry-after'] || '60');
        const waitTime = retryAfter * 1000;
        
        logger.warn(`Discord rate limit hit, waiting ${waitTime}ms`);
        
        if (attempt < retries) {
          await sleep(waitTime);
          continue; // Retry after waiting
        } else {
          return { success: false, error: 'Rate limited and max retries exceeded' };
        }
      }

      if (response.status >= 200 && response.status < 300) {
        logger.info('Discord notification sent successfully');
        return { success: true };
      } else {
        const errorText = response.data ? JSON.stringify(response.data) : response.statusText || 'Unknown error';
        const error = `HTTP ${response.status}: ${errorText}`;
        
        // Don't retry on client errors (4xx) except 429
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          logger.error(`Discord webhook error (not retrying): ${error}`);
          return { success: false, error };
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < retries) {
          const backoffTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn(`Discord notification failed, retrying in ${backoffTime}ms: ${error}`);
          await sleep(backoffTime);
          continue;
        } else {
          logger.error(`Discord notification failed after ${retries} retries: ${error}`);
          return { success: false, error };
        }
      }
    } catch (error) {
      logger.error(`Error sending Discord notification (attempt ${attempt + 1}/${retries + 1}):`, error);
      
      if (attempt < retries) {
        const backoffTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        await sleep(backoffTime);
        continue;
      } else {
        return { success: false, error: error.message || 'Network error' };
      }
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

/**
 * Format notification for new version available
 * @param {Object} imageData - Tracked image data
 * @returns {Object} - Discord embed payload
 */
function formatVersionUpdateNotification(imageData) {
  const {
    name,
    imageName,
    githubRepo,
    sourceType,
    currentVersion,
    latestVersion,
    latestVersionPublishDate,
    releaseUrl,
  } = imageData;

  // Determine source display with hyperlink for GitHub
  let sourceDisplay;
  if (sourceType === 'github' && githubRepo) {
    const repoUrl = `https://github.com/${githubRepo}`;
    sourceDisplay = `[GitHub: ${githubRepo}](${repoUrl})`;
  } else if (sourceType === 'github') {
    sourceDisplay = 'GitHub: Unknown';
  } else {
    sourceDisplay = `Docker: ${imageName || 'Unknown'}`;
  }

  // Format latest version with hyperlink to release page if available
  let latestVersionDisplay = latestVersion || 'Unknown';
  if (sourceType === 'github' && releaseUrl && latestVersion) {
    // Use the release URL if available
    latestVersionDisplay = `[${latestVersion}](${releaseUrl})`;
  } else if (sourceType === 'github' && githubRepo && latestVersion) {
    // Fallback: construct release URL from repo and tag
    const constructedReleaseUrl = `https://github.com/${githubRepo}/releases/tag/${latestVersion}`;
    latestVersionDisplay = `[${latestVersion}](${constructedReleaseUrl})`;
  }

  // Format publish date
  let publishDateText = 'Not available';
  if (latestVersionPublishDate) {
    try {
      const date = new Date(latestVersionPublishDate);
      publishDateText = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (e) {
      // Invalid date, use raw value
      publishDateText = latestVersionPublishDate;
    }
  }

  // Create embed
  const embed = {
    title: '🆕 Version Available',
    description: `A new version of **${name}** is now available!`,
    color: 3066993, // Green
    fields: [
      {
        name: 'Current Version',
        value: currentVersion || 'Unknown',
        inline: true,
      },
      {
        name: 'Latest Version',
        value: latestVersionDisplay,
        inline: true,
      },
      {
        name: 'Source',
        value: sourceDisplay,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Docked System',
    },
  };

  // Add publish date if available
  if (latestVersionPublishDate) {
    embed.fields.push({
      name: 'Release Date',
      value: publishDateText,
      inline: true,
    });
  }

  return {
    embeds: [embed],
  };
}

/**
 * Queue a notification for sending
 * @param {Object} imageData - Tracked image data
 * @returns {Promise<void>}
 */
async function queueNotification(imageData) {
  // Get all enabled webhooks
  const { getEnabledDiscordWebhooks } = getDatabase();
  const webhooks = await getEnabledDiscordWebhooks();
  if (!webhooks || webhooks.length === 0) {
    logger.debug('No enabled Discord webhooks configured');
    return;
  }

  // Check for duplicates
  const dedupKey = createDeduplicationKey(imageData);
  if (isDuplicate(dedupKey)) {
    logger.debug(`Skipping duplicate notification for ${dedupKey}`);
    return;
  }

  // Format notification payload once
  const payload = formatVersionUpdateNotification(imageData);

  // Queue notification for each enabled webhook
  for (const webhook of webhooks) {
    // Check queue size
    if (notificationQueue.length >= MAX_QUEUE_SIZE) {
      logger.error(`Discord notification queue full (${MAX_QUEUE_SIZE}), dropping notification`);
      continue;
    }

    notificationQueue.push({
      webhookUrl: webhook.webhook_url,
      payload,
      imageData,
      dedupKey,
    });

    logger.debug(`Queued Discord notification for ${imageData.name} to webhook ${webhook.id}`);
  }

  // Start processing queue if not already processing
  if (!isProcessingQueue) {
    processNotificationQueue();
  }
}

/**
 * Process the notification queue
 */
async function processNotificationQueue() {
  if (isProcessingQueue || notificationQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (notificationQueue.length > 0) {
    const notification = notificationQueue.shift();
    
    try {
      // Check rate limit before processing
      if (isRateLimited(notification.webhookUrl)) {
        const waitTime = getRateLimitResetTime(notification.webhookUrl);
        if (waitTime > 0) {
          logger.debug(`Rate limited, waiting ${waitTime}ms before processing queue`);
          await sleep(waitTime);
        }
      }

      const result = await sendNotificationWithRetry(
        notification.webhookUrl,
        notification.payload
      );

      if (result.success) {
        // Record successful notification for deduplication
        recordNotification(notification.dedupKey);
        logger.info(`Discord notification sent for ${notification.imageData.name}`);
      } else {
        logger.error(`Failed to send Discord notification for ${notification.imageData.name}: ${result.error}`);
        // Could implement a dead letter queue here if needed
      }

      // Small delay between notifications to avoid hitting rate limits
      await sleep(100);
    } catch (error) {
      logger.error('Error processing Discord notification:', error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Send notification immediately (bypasses queue, use with caution)
 * @param {Object} imageData - Tracked image data
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendNotificationImmediate(imageData) {
  // Get all enabled webhooks
  const { getEnabledDiscordWebhooks } = getDatabase();
  const webhooks = await getEnabledDiscordWebhooks();
  if (!webhooks || webhooks.length === 0) {
    return { success: false, error: 'No enabled Discord webhooks configured' };
  }

  // Check for duplicates
  const dedupKey = createDeduplicationKey(imageData);
  if (isDuplicate(dedupKey)) {
    return { success: false, error: 'Duplicate notification' };
  }

  const payload = formatVersionUpdateNotification(imageData);
  
  // Send to first enabled webhook
  const result = await sendNotificationWithRetry(webhooks[0].webhook_url, payload);

  if (result.success) {
    recordNotification(dedupKey);
  }

  return result;
}

/**
 * Get webhook information from Discord API
 * @param {string} webhookUrl - Webhook URL
 * @returns {Promise<{success: boolean, name?: string, channel_id?: string, guild_id?: string, avatar?: string, avatar_url?: string, error?: string}>}
 */
async function getWebhookInfo(webhookUrl) {
  if (!validateWebhookUrl(webhookUrl)) {
    return { success: false, error: 'Invalid webhook URL format' };
  }

  try {
    // Discord allows GET requests to webhook URLs to retrieve webhook information
    const response = await axios.get(webhookUrl, {
      validateStatus: () => true, // Don't throw on any status
    });

    if (response.status === 200 && response.data) {
      const data = response.data;
      
      // Construct avatar URL if avatar hash is provided
      let avatarUrl = null;
      if (data.avatar) {
        // Discord CDN URL format: https://cdn.discordapp.com/avatars/{webhook_id}/{avatar_hash}.{ext}
        // Extract webhook ID from URL
        const webhookIdMatch = webhookUrl.match(/\/webhooks\/(\d+)\//);
        if (webhookIdMatch) {
          const webhookId = webhookIdMatch[1];
          const avatarHash = data.avatar;
          // Discord avatars can be .png, .jpg, .webp, or .gif
          // Try .png first, but the actual format might vary
          avatarUrl = `https://cdn.discordapp.com/avatars/${webhookId}/${avatarHash}.png`;
        }
      }

      return {
        success: true,
        name: data.name || null,
        channel_id: data.channel_id || null,
        guild_id: data.guild_id || null,
        avatar: data.avatar || null,
        avatar_url: avatarUrl,
        type: data.type || null,
        id: data.id || null,
        application_id: data.application_id || null,
        source_guild: data.source_guild ? {
          id: data.source_guild.id,
          name: data.source_guild.name,
          icon: data.source_guild.icon ? '***present***' : null,
        } : null,
        source_channel: data.source_channel ? {
          id: data.source_channel.id,
          name: data.source_channel.name,
        } : null,
      };
    } else {
      logger.warn('Failed to fetch webhook info:', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });
      return { success: false, error: `Failed to fetch webhook info: ${response.status}` };
    }
  } catch (error) {
    logger.error('Error fetching webhook info:', {
      error: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    return { success: false, error: error.message || 'Failed to fetch webhook information' };
  }
}

module.exports = {
  validateWebhookUrl,
  testWebhook,
  getWebhookInfo,
  queueNotification,
  sendNotificationImmediate,
  formatVersionUpdateNotification,
};

