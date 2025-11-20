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

const axios = require("axios");
const logger = require("../utils/logger");

// Lazy load database functions to avoid initialization issues
function getDatabase() {
  return require("../db/database");
}

// Discord webhook rate limits: 30 requests per 60 seconds per webhook
const DISCORD_RATE_LIMIT = 30;
const DISCORD_RATE_LIMIT_WINDOW = 60000; // 60 seconds in milliseconds
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 100;

// In-memory queue for notifications
const notificationQueue = [];
let isProcessingQueue = false;
const rateLimitTracker = new Map(); // webhookUrl -> { count, resetAt }

// Deduplication: Track recent notifications to prevent duplicates
const recentNotifications = new Map(); // key -> timestamp
const DEDUPLICATION_WINDOW = 365 * 24 * 60 * 60 * 1000; // 1 year (for fallback version-based keys)

// Cleanup interval for memory management (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
let cleanupIntervalId = null;

/**
 * Clean up expired entries from in-memory maps to prevent memory leaks
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  let cleanedCount = 0;

  // Clean up expired notification deduplication entries
  // Only clean up version-based keys (fallback), never clean SHA-based keys (permanent)
  for (const [key, timestamp] of recentNotifications.entries()) {
    // Check if this is a SHA-based key (contains a 64-char hex digest)
    const isShaBased = /:[a-f0-9]{64}$/.test(key);
    if (!isShaBased && now - timestamp > DEDUPLICATION_WINDOW) {
      recentNotifications.delete(key);
      cleanedCount++;
    }
  }

  // Clean up expired rate limit trackers
  for (const [webhookUrl, tracker] of rateLimitTracker.entries()) {
    if (now > tracker.resetAt) {
      rateLimitTracker.delete(webhookUrl);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug(`Cleaned up ${cleanedCount} expired entries from notification maps`);
  }
}

/**
 * Start periodic cleanup of expired entries
 */
function startCleanupInterval() {
  if (cleanupIntervalId) {
    return; // Already started
  }

  // Run cleanup immediately, then periodically
  cleanupExpiredEntries();
  cleanupIntervalId = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL);
  logger.debug("Started periodic cleanup of notification maps");
}

/**
 * Stop periodic cleanup (useful for testing or graceful shutdown)
 */
function stopCleanupInterval() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    logger.debug("Stopped periodic cleanup of notification maps");
  }
}

// Start cleanup interval on module load
startCleanupInterval();

/**
 * Sleep utility for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate webhook URL format
 * @param {string} webhookUrl - Webhook URL to validate
 * @returns {boolean} - True if valid
 */
function validateWebhookUrl(webhookUrl) {
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return false;
  }
  // Discord webhook URLs follow pattern: https://discord.com/api/webhooks/{id}/{token}
  const webhookPattern =
    /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
  return webhookPattern.test(webhookUrl.trim());
}

/**
 * Test webhook connectivity
 * @param {string} webhookUrl - Webhook URL to test
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testWebhook(webhookUrl) {
  if (!validateWebhookUrl(webhookUrl)) {
    return { success: false, error: "Invalid webhook URL format" };
  }

  try {
    const testPayload = {
      embeds: [
        {
          title: "🔧 Webhook Test",
          description:
            "This is a test notification from Docked. If you see this, your webhook is configured correctly!",
          color: 23196, // Dodger Blue (#005A9C)
          timestamp: new Date().toISOString(),
          footer: { text: "Docked System" },
        },
      ],
    };

    const response = await axios.post(webhookUrl, testPayload, {
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true, // Don't throw on any status
    });

    if (response.status >= 200 && response.status < 300) {
      return { success: true };
    } else {
      const errorText = response.data
        ? JSON.stringify(response.data)
        : response.statusText || "Unknown error";
      return { success: false, error: `Webhook returned status ${response.status}: ${errorText}` };
    }
  } catch (error) {
    logger.error("Error testing webhook:", error);
    return { success: false, error: error.message || "Failed to connect to webhook" };
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
  // Normalize digest for consistent comparison (remove sha256: prefix, lowercase)
  const normalizeDigest = (digest) => {
    if (!digest) return "";
    return String(digest)
      .replace(/^sha256:/i, "")
      .toLowerCase()
      .trim();
  };

  const imageName = notification.imageName || "";
  const latestDigest = normalizeDigest(
    notification.latestDigest || notification.latest_digest || ""
  );
  const containerName = notification.name || notification.containerName || "";
  const userId = notification.userId || notification.user_id || "";

  // For portainer containers, use SHA digest as the key (one notification per unique SHA)
  if (notification.notificationType === "portainer-container") {
    if (!latestDigest) {
      // Fallback to version if no digest available (shouldn't happen normally)
      const latestVersion = notification.latestVersion || "";
      return `${userId}:${containerName}:${imageName}:${latestVersion}`;
    }
    return `${userId}:${containerName}:${imageName}:${latestDigest}`;
  }

  // For tracked images, use SHA digest as the key
  // For GitHub/GitLab, use githubRepo if imageName is not available
  const identifier = imageName || notification.githubRepo || notification.name || "";
  if (!latestDigest) {
    // Fallback to version if no digest available (for GitHub/GitLab tracked images)
    const latestVersion = notification.latestVersion || "";
    return `${userId}:${identifier}:${latestVersion}`;
  }
  return `${userId}:${identifier}:${latestDigest}`;
}

/**
 * Check if notification is a duplicate
 * @param {string} key - Deduplication key
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} - True if duplicate
 */
async function isDuplicate(key, userId) {
  // First check in-memory cache for fast lookup
  const timestamp = recentNotifications.get(key);
  if (timestamp) {
    // For SHA-based keys (contain 64-char hex digest), never expire - once notified, never notify again
    // For version-based keys (fallback), use the window
    const isShaBased = /:[a-f0-9]{64}$/.test(key);

    if (isShaBased) {
      // SHA-based keys never expire - permanent deduplication
      return true;
    }

    // Version-based keys (fallback) use the window
    const now = Date.now();
    if (now - timestamp > DEDUPLICATION_WINDOW) {
      recentNotifications.delete(key);
      // Fall through to database check
    } else {
      return true;
    }
  }

  // Check database for persistent deduplication (survives server restarts)
  if (userId) {
    try {
      const { hasDiscordNotificationBeenSent } = getDatabase();
      const wasSent = await hasDiscordNotificationBeenSent(userId, key);
      if (wasSent) {
        // Update in-memory cache for future lookups
        recordNotification(key);
        return true;
      }
    } catch (error) {
      // If database check fails, log error but don't block notification
      // Fall through to allow notification (fail open)
      logger.warn("Error checking database for duplicate notification:", error);
    }
  }

  return false;
}

/**
 * Record notification for deduplication
 * @param {string} key - Deduplication key
 * @param {number} userId - User ID (optional, for database persistence)
 * @param {string} notificationType - Notification type (optional, for database persistence)
 */
async function recordNotification(key, userId = null, notificationType = null) {
  // Update in-memory cache for fast lookups
  recentNotifications.set(key, Date.now());

  // Also persist to database if userId provided (ensures deduplication survives restarts)
  if (userId) {
    try {
      const { recordDiscordNotificationSent } = getDatabase();
      await recordDiscordNotificationSent(userId, key, notificationType || "unknown");
    } catch (error) {
      // Log error but don't fail - in-memory cache still works
      logger.warn("Error recording notification to database:", error);
    }
  }

  // Trigger cleanup if map grows too large (safety check in addition to periodic cleanup)
  if (recentNotifications.size > 1000) {
    cleanupExpiredEntries();
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
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true, // Don't throw on any status, handle manually
      });

      // Record request for rate limiting
      recordRequest(webhookUrl);

      if (response.status === 429) {
        // Rate limited - get retry-after header
        const retryAfter = parseInt(response.headers["retry-after"] || "60");
        const waitTime = retryAfter * 1000;

        logger.warn(`Discord rate limit hit, waiting ${waitTime}ms`);

        if (attempt < retries) {
          await sleep(waitTime);
          continue; // Retry after waiting
        } else {
          return { success: false, error: "Rate limited and max retries exceeded" };
        }
      }

      if (response.status >= 200 && response.status < 300) {
        logger.info("Discord notification sent successfully");
        return { success: true };
      } else {
        const errorText = response.data
          ? JSON.stringify(response.data)
          : response.statusText || "Unknown error";
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
      logger.error(
        `Error sending Discord notification (attempt ${attempt + 1}/${retries + 1}):`,
        error
      );

      if (attempt < retries) {
        const backoffTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        await sleep(backoffTime);
        continue;
      } else {
        return { success: false, error: error.message || "Network error" };
      }
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

/**
 * Format notification for new version available
 * @param {Object} imageData - Tracked image data
 * @returns {Object} - Discord embed payload
 */
/**
 * Generate Docker Hub repository URL from image name
 * @param {string} imageName - Image name (e.g., "jc21/nginx-proxy-manager:latest")
 * @returns {string|null} - Docker Hub URL or null
 */
function getDockerHubRepoUrl(imageName) {
  if (!imageName) {
    return null;
  }

  // Parse image name (remove tag if present)
  let repo = imageName;
  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    repo = parts[0];
  }

  // Remove registry prefixes
  const registryPrefixes = ["docker.io/", "registry-1.docker.io/"];
  for (const prefix of registryPrefixes) {
    if (repo.startsWith(prefix)) {
      repo = repo.replace(prefix, "");
    }
  }

  // Format: https://hub.docker.com/r/{namespace}/{repo}
  if (repo.includes("/")) {
    // User image
    return `https://hub.docker.com/r/${repo}`;
  } else {
    // Official image (library)
    return `https://hub.docker.com/r/library/${repo}`;
  }
}

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
    notificationType, // 'tracked-app' or 'portainer-container'
  } = imageData;

  // Determine notification title based on type
  let notificationTitle;
  if (notificationType === "portainer-container") {
    notificationTitle = "New Portainer Container Update Available 🫙";
  } else {
    // Default to tracked app
    notificationTitle = "🆕 Tracked Application Update Available";
  }

  // Determine source display with hyperlink
  let sourceDisplay;
  if (sourceType === "github" && githubRepo) {
    const repoUrl = `https://github.com/${githubRepo}`;
    sourceDisplay = `[GitHub: ${githubRepo}](${repoUrl})`;
  } else if (sourceType === "github") {
    sourceDisplay = "GitHub: Unknown";
  } else {
    // Docker - create hyperlink to Docker Hub
    const dockerHubUrl = getDockerHubRepoUrl(imageName);
    if (dockerHubUrl) {
      sourceDisplay = `[Docker: ${imageName || "Unknown"}](${dockerHubUrl})`;
    } else {
      sourceDisplay = `Docker: ${imageName || "Unknown"}`;
    }
  }

  // Format versions (no SHAs)
  let latestDisplay = latestVersion || "Unknown";
  const currentDisplay = currentVersion || "Unknown";

  // For GitHub, format latest version with hyperlink to release page if available
  if (sourceType === "github" && releaseUrl && latestVersion) {
    // Use the release URL if available
    latestDisplay = `[${latestVersion}](${releaseUrl})`;
  } else if (sourceType === "github" && githubRepo && latestVersion) {
    // Fallback: construct release URL from repo and tag
    const constructedReleaseUrl = `https://github.com/${githubRepo}/releases/tag/${latestVersion}`;
    latestDisplay = `[${latestVersion}](${constructedReleaseUrl})`;
  }

  // Format publish date
  let publishDateText = "Not available";
  if (latestVersionPublishDate) {
    try {
      const date = new Date(latestVersionPublishDate);
      publishDateText = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      // Invalid date, use raw value
      publishDateText = latestVersionPublishDate;
    }
  }

  // Create embed
  const embed = {
    title: notificationTitle,
    description: `A new version of **${name}** is now available!`,
    color: 23196, // Dodger Blue (#005A9C)
    fields: [],
    timestamp: new Date().toISOString(),
    footer: {
      text: "Docked System",
    },
  };

  // For tracked applications, organize fields in specific order
  if (notificationType === "tracked-app") {
    // Top row: Latest Version (left) and Release Date (right) - inline
    embed.fields.push({
      name: "Latest Version",
      value: latestDisplay,
      inline: true,
    });

    if (latestVersionPublishDate) {
      embed.fields.push({
        name: "Release Date",
        value: publishDateText,
        inline: true,
      });
    }

    // Underneath: Source (full width)
    embed.fields.push({
      name: "Source",
      value: sourceDisplay,
      inline: false,
    });

    // Underneath Source: Current Version
    embed.fields.push({
      name: "Current Version",
      value: currentDisplay,
      inline: false,
    });
  } else {
    // For portainer containers, keep original layout
    embed.fields.push({
      name: "Source",
      value: sourceDisplay,
      inline: false,
    });

    // Add publish date if available
    if (latestVersionPublishDate) {
      embed.fields.push({
        name: "Release Date",
        value: publishDateText,
        inline: true,
      });
    }
  }

  return {
    embeds: [embed],
  };
}

/**
 * Queue a notification for sending
 * @param {Object} imageData - Tracked image data (must include userId)
 * @returns {Promise<void>}
 */
async function queueNotification(imageData) {
  // Get enabled webhooks for this user only
  const { getEnabledDiscordWebhooks } = getDatabase();
  const userId = imageData.userId || imageData.user_id;
  if (!userId) {
    logger.warn("Discord notification skipped: no userId provided in imageData");
    return;
  }
  const webhooks = await getEnabledDiscordWebhooks(userId);
  if (!webhooks || webhooks.length === 0) {
    logger.debug(`No enabled Discord webhooks configured for user ${userId}`);
    return;
  }

  // Check for duplicates (checks both in-memory cache and database)
  const dedupKey = createDeduplicationKey(imageData);
  const isDup = await isDuplicate(dedupKey, userId);
  if (isDup) {
    logger.debug(`Skipping duplicate notification for ${dedupKey}`);
    return;
  }

  // Record immediately when queuing (prevents duplicates even if processing is delayed)
  // This records to both in-memory cache and database
  await recordNotification(dedupKey, userId, imageData.notificationType || "tracked-app");

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

      const result = await sendNotificationWithRetry(notification.webhookUrl, notification.payload);

      if (result.success) {
        // Record successful notification for deduplication (already recorded when queued, but ensure it's persisted)
        const userId = notification.imageData.userId || notification.imageData.user_id;
        await recordNotification(
          notification.dedupKey,
          userId,
          notification.imageData.notificationType || "tracked-app"
        );
        logger.info(`Discord notification sent for ${notification.imageData.name}`);
      } else {
        logger.error(
          `Failed to send Discord notification for ${notification.imageData.name}: ${result.error}`
        );
        // Could implement a dead letter queue here if needed
      }

      // Small delay between notifications to avoid hitting rate limits
      await sleep(100);
    } catch (error) {
      logger.error("Error processing Discord notification:", error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Send notification immediately (bypasses queue, use with caution)
 * @param {Object} imageData - Tracked image data (must include userId)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendNotificationImmediate(imageData) {
  // Get enabled webhooks for this user only
  const { getEnabledDiscordWebhooks } = getDatabase();
  const userId = imageData.userId || imageData.user_id;
  if (!userId) {
    return { success: false, error: "No userId provided in imageData" };
  }
  const webhooks = await getEnabledDiscordWebhooks(userId);
  if (!webhooks || webhooks.length === 0) {
    return { success: false, error: `No enabled Discord webhooks configured for user ${userId}` };
  }

  // Check for duplicates (checks both in-memory cache and database)
  const dedupKey = createDeduplicationKey(imageData);
  const isDup = await isDuplicate(dedupKey, userId);
  if (isDup) {
    return { success: false, error: "Duplicate notification" };
  }

  const payload = formatVersionUpdateNotification(imageData);

  // Send to first enabled webhook
  const result = await sendNotificationWithRetry(webhooks[0].webhook_url, payload);

  if (result.success) {
    await recordNotification(dedupKey, userId, imageData.notificationType || "tracked-app");
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
    return { success: false, error: "Invalid webhook URL format" };
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
        source_guild: data.source_guild
          ? {
              id: data.source_guild.id,
              name: data.source_guild.name,
              icon: data.source_guild.icon ? "***present***" : null,
            }
          : null,
        source_channel: data.source_channel
          ? {
              id: data.source_channel.id,
              name: data.source_channel.name,
            }
          : null,
      };
    } else {
      logger.warn("Failed to fetch webhook info:", {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });
      return { success: false, error: `Failed to fetch webhook info: ${response.status}` };
    }
  } catch (error) {
    logger.error("Error fetching webhook info:", {
      error: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    return { success: false, error: error.message || "Failed to fetch webhook information" };
  }
}

module.exports = {
  validateWebhookUrl,
  testWebhook,
  getWebhookInfo,
  queueNotification,
  sendNotificationImmediate,
  formatVersionUpdateNotification,
  startCleanupInterval,
  stopCleanupInterval,
  cleanupExpiredEntries, // Exported for testing
};
