/**
 * Data Transfer Objects (DTOs)
 * Standardized request/response shapes for API consistency
 */

/**
 * Standard API response wrapper
 */
class ApiResponse {
  constructor(success, data = null, error = null, metadata = {}) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
  }

  static success(data, metadata = {}) {
    return new ApiResponse(true, data, null, metadata);
  }

  static error(error, metadata = {}) {
    return new ApiResponse(false, null, error, metadata);
  }
}

/**
 * Pagination metadata
 */
class PaginationMeta {
  constructor(page, limit, total, totalPages) {
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = totalPages;
  }
}

/**
 * Container DTO
 */
class ContainerDTO {
  constructor(container) {
    this.id = container.id;
    this.name = container.name;
    this.image = container.image;
    this.status = container.status;
    this.state = container.state;
    this.endpointId = container.endpointId;
    this.portainerUrl = container.portainerUrl;
    this.portainerName = container.portainerName;
    this.hasUpdate = container.hasUpdate || false;
    this.currentTag = container.currentTag;
    this.currentVersion = container.currentVersion;
    this.currentDigest = container.currentDigest;
    this.latestTag = container.latestTag;
    this.newVersion = container.newVersion;
    this.latestDigest = container.latestDigest;
    this.imageRepo = container.imageRepo;
    this.stackName = container.stackName || null;
  }
}

/**
 * Portainer Instance DTO
 */
class PortainerInstanceDTO {
  constructor(instance) {
    this.id = instance.id;
    this.name = instance.name;
    this.url = instance.url;
    this.username = instance.username || null;
    this.authType = instance.auth_type || 'password';
    this.displayOrder = instance.display_order || 0;
    this.ipAddress = instance.ip_address || null;
    this.createdAt = instance.created_at;
    this.updatedAt = instance.updated_at;
    // Never expose password or API key
  }
}

/**
 * Tracked Image DTO
 */
class TrackedImageDTO {
  constructor(trackedImage) {
    this.id = trackedImage.id;
    this.name = trackedImage.name;
    this.imageName = trackedImage.image_name;
    this.githubRepo = trackedImage.github_repo;
    this.sourceType = trackedImage.source_type || 'docker';
    this.currentVersion = trackedImage.current_version;
    this.currentDigest = trackedImage.current_digest;
    this.latestVersion = trackedImage.latest_version;
    this.latestDigest = trackedImage.latest_digest;
    this.hasUpdate = trackedImage.has_update === 1;
    this.currentVersionPublishDate = trackedImage.current_version_publish_date;
    this.latestVersionPublishDate = trackedImage.latest_version_publish_date;
    this.lastChecked = trackedImage.last_checked;
    this.createdAt = trackedImage.created_at;
    this.updatedAt = trackedImage.updated_at;
  }
}

/**
 * Batch Run DTO
 */
class BatchRunDTO {
  constructor(batchRun) {
    this.id = batchRun.id;
    this.status = batchRun.status;
    this.jobType = batchRun.job_type || 'docker-hub-pull';
    this.isManual = batchRun.is_manual === 1;
    this.startedAt = batchRun.started_at;
    this.completedAt = batchRun.completed_at;
    this.durationMs = batchRun.duration_ms;
    this.containersChecked = batchRun.containers_checked || 0;
    this.containersUpdated = batchRun.containers_updated || 0;
    this.errorMessage = batchRun.error_message;
    this.logs = batchRun.logs;
  }
}

/**
 * User DTO (safe - no sensitive data)
 */
class UserDTO {
  constructor(user) {
    this.id = user.id;
    this.username = user.username;
    this.role = user.role;
    this.createdAt = user.created_at;
    this.updatedAt = user.updated_at;
    // Never expose password_hash
  }
}

/**
 * Discord Webhook DTO (safe - no sensitive URLs)
 */
class DiscordWebhookDTO {
  constructor(webhook) {
    this.id = webhook.id;
    this.serverName = webhook.server_name;
    this.channelName = webhook.channel_name;
    this.avatarUrl = webhook.avatar_url;
    this.guildId = webhook.guild_id;
    this.channelId = webhook.channel_id;
    this.enabled = webhook.enabled === 1;
    this.hasWebhook = !!webhook.webhook_url;
    this.createdAt = webhook.created_at;
    this.updatedAt = webhook.updated_at;
    // Never expose webhook_url
  }
}

module.exports = {
  ApiResponse,
  PaginationMeta,
  ContainerDTO,
  PortainerInstanceDTO,
  TrackedImageDTO,
  BatchRunDTO,
  UserDTO,
  DiscordWebhookDTO,
};

