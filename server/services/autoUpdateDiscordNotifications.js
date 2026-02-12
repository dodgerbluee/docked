/**
 * Discord Notifications for Auto-Update System
 *
 * This file documents the Discord notification integration for auto-updates.
 * The notification types are defined below with templates, but the actual
 * integration into AutoUpdateHandler is marked for future implementation.
 *
 * CURRENT STATE: Design documented, integration marked with TODO comments
 * NEXT STEPS: Implement using discordService.queueNotification() pattern
 *
 * NOTE: This is intentionally kept separate from AutoUpdateHandler to maintain
 * clear separation of concerns and allow notifications to be enhanced independently.
 */

/**
 * Discord Notification Types for Auto-Update System
 *
 * The following notification types should be supported:
 *
 * 1. auto-update-detected
 *    Sent when an update is detected for a matched container
 *    - Triggered by: Batch job when checking for updates
 *    - Conditions: Container matches intent AND has_update = true
 *    - Enabled by: intent.notify_discord && intent.notify_on_update_detected
 *
 * 2. auto-update-batch-started
 *    Sent when batch job starts processing an intent
 *    - Triggered by: AutoUpdateHandler.executeIntent()
 *    - Data: Intent description, container count, container names
 *    - Enabled by: intent.notify_discord && intent.notify_on_batch_start
 *
 * 3. auto-update-success
 *    Sent when a container upgrade succeeds
 *    - Triggered by: AutoUpdateHandler after upgradeSingleContainer() succeeds
 *    - Data: Container name, old image, new image, new digest
 *    - Enabled by: intent.notify_discord && intent.notify_on_success
 *
 * 4. auto-update-failure
 *    Sent when a container upgrade fails
 *    - Triggered by: AutoUpdateHandler when upgradeSingleContainer() fails
 *    - Data: Container name, error message, intent description
 *    - Enabled by: intent.notify_discord && intent.notify_on_failure
 *
 * 5. auto-update-batch-summary
 *    Sent at end of batch job execution
 *    - Triggered by: AutoUpdateHandler.handle() completion
 *    - Data: Total intents, upgraded count, failed count, duration
 *    - Enabled by: Any intent in batch had notify_discord enabled
 */

/**
 * Discord Embed Template Examples
 *
 * These are example embed templates for each notification type.
 * Implementation should follow the existing pattern in discordService.formatVersionUpdateNotification()
 */

// Example 1: Auto-Update Detected
const autoUpdateDetectedEmbed = {
  title: "🆕 Container Update Available",
  description: "An update is available for a container with auto-update enabled",
  color: 3447003, // Blue
  fields: [
    {
      name: "Container",
      value: "plex",
      inline: true,
    },
    {
      name: "Image",
      value: "ghcr.io/linuxserver/plex",
      inline: true,
    },
    {
      name: "Current Version",
      value: "1.40.0.1234",
      inline: true,
    },
    {
      name: "Latest Version",
      value: "1.41.0.5678",
      inline: true,
    },
    {
      name: "Action",
      value: "Waiting for scheduled auto-update batch",
      inline: false,
    },
  ],
  timestamp: new Date().toISOString(),
  footer: { text: "Docked Auto-Update System" },
};

// Example 2: Batch Started
const batchStartedEmbed = {
  title: "🚀 Auto-Update Batch Started",
  description: "Beginning to process auto-update intents",
  color: 3447003, // Blue
  fields: [
    {
      name: "Intent",
      value: "Auto-upgrade all Plex instances",
      inline: false,
    },
    {
      name: "Containers to Process",
      value: "3",
      inline: true,
    },
    {
      name: "With Available Updates",
      value: "2",
      inline: true,
    },
  ],
  timestamp: new Date().toISOString(),
  footer: { text: "Docked Auto-Update System" },
};

// Example 3: Upgrade Success
const upgradeSuccessEmbed = {
  title: "✅ Container Upgraded Successfully",
  description: "A container has been automatically upgraded",
  color: 3066993, // Green
  fields: [
    {
      name: "Container",
      value: "plex",
      inline: true,
    },
    {
      name: "Status",
      value: "Running",
      inline: true,
    },
    {
      name: "Old Version",
      value: "1.40.0.1234",
      inline: true,
    },
    {
      name: "New Version",
      value: "1.41.0.5678",
      inline: true,
    },
    {
      name: "Image",
      value: "ghcr.io/linuxserver/plex:latest",
      inline: false,
    },
  ],
  timestamp: new Date().toISOString(),
  footer: { text: "Docked Auto-Update System" },
};

// Example 4: Upgrade Failure
const upgradeFailureEmbed = {
  title: "❌ Container Upgrade Failed",
  description: "An automatic container upgrade encountered an error",
  color: 15158332, // Red
  fields: [
    {
      name: "Container",
      value: "plex",
      inline: true,
    },
    {
      name: "Version",
      value: "1.40.0.1234 (not upgraded)",
      inline: true,
    },
    {
      name: "Error",
      value: "Connection timeout to Portainer API",
      inline: false,
    },
    {
      name: "Action Required",
      value: "Manual retry or Portainer investigation needed",
      inline: false,
    },
  ],
  timestamp: new Date().toISOString(),
  footer: { text: "Docked Auto-Update System" },
};

// Example 5: Batch Summary
const batchSummaryEmbed = {
  title: "📊 Auto-Update Batch Complete",
  description: "Auto-update batch job has completed",
  color: 3447003, // Blue
  fields: [
    {
      name: "Duration",
      value: "2m 34s",
      inline: true,
    },
    {
      name: "Total Intents",
      value: "3",
      inline: true,
    },
    {
      name: "✅ Succeeded",
      value: "5",
      inline: true,
    },
    {
      name: "❌ Failed",
      value: "1",
      inline: true,
    },
    {
      name: "Status",
      value: "Partial success (5/6 upgraded)",
      inline: false,
    },
  ],
  timestamp: new Date().toISOString(),
  footer: { text: "Docked Auto-Update System" },
};

/**
 * Implementation Notes
 *
 * 1. Service Pattern
 *    Use existing discordService.queueNotification() for consistency:
 *
 *    await discordService.queueNotification({
 *      userId,
 *      name: containerName,
 *      imageName: imageRepo,
 *      notificationType: "auto-update-success",
 *      // ... other fields
 *    });
 *
 * 2. Deduplication
 *    The discordService already handles deduplication using SHA-256 digests.
 *    Auto-update notifications should include stable identifiers:
 *    - Container ID + version for success/failure
 *    - Intent ID + batch timestamp for batch events
 *
 * 3. Rate Limiting
 *    Discord webhooks are rate limited to 30 requests per 60 seconds.
 *    The discordService.queueNotification() queue handles this automatically.
 *    No additional rate limiting needed.
 *
 * 4. User Opt-In
 *    - Global: Must have Discord webhooks configured
 *    - Intent-level: Each intent has notify_discord flag
 *    - Notification-type: Each intent can enable/disable specific types
 *
 * 5. Handling Webhook Errors
 *    If webhooks are deleted or become invalid after intent creation:
 *    - getEnabledDiscordWebhooks() returns empty array
 *    - Notifications are silently skipped
 *    - Logging still records the intent action
 *
 * 6. Testing
 *    Test intention matching without notifications:
 *    POST /api/auto-update/intents/:id/test-match
 *    (Notifications can be enabled/disabled per intent after creation)
 */

module.exports = {
  // Export for documentation purposes
  exampleEmbeds: {
    autoUpdateDetectedEmbed,
    batchStartedEmbed,
    upgradeSuccessEmbed,
    upgradeFailureEmbed,
    batchSummaryEmbed,
  },
};
