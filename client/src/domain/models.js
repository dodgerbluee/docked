/**
 * Domain Models / DTOs
 * Type-safe data structures for API responses
 * Mirrors backend DTO structure for consistency
 */

/**
 * User Model
 */
export class User {
  constructor(data) {
    this.id = data.id;
    this.username = data.username;
    this.role = data.role || 'Administrator';
    this.passwordChanged = data.passwordChanged || data.password_changed === true || data.password_changed === 1;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }
  
  static fromApi(data) {
    return new User(data);
  }
}

/**
 * Portainer Instance Model
 */
export class PortainerInstance {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.url = data.url;
    this.username = data.username || null;
    this.authType = data.authType || data.auth_type || 'password';
    this.displayOrder = data.displayOrder || data.display_order || 0;
    this.ipAddress = data.ipAddress || data.ip_address || null;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }
  
  static fromApi(data) {
    return new PortainerInstance(data);
  }
  
  static fromApiArray(dataArray) {
    return (dataArray || []).map(item => PortainerInstance.fromApi(item));
  }
}

/**
 * Container Model
 */
export class Container {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.image = data.image;
    this.status = data.status;
    this.state = data.state;
    this.endpointId = data.endpointId || data.endpoint_id;
    this.portainerUrl = data.portainerUrl || data.portainer_url;
    this.portainerName = data.portainerName || data.portainer_name;
    this.hasUpdate = data.hasUpdate || data.has_update === true || data.has_update === 1;
    this.currentTag = data.currentTag || data.current_tag;
    this.currentVersion = data.currentVersion || data.current_version;
    this.currentDigest = data.currentDigest || data.current_digest;
    this.latestTag = data.latestTag || data.latest_tag;
    this.newVersion = data.newVersion || data.new_version;
    this.latestDigest = data.latestDigest || data.latest_digest;
    this.imageRepo = data.imageRepo || data.image_repo;
    this.stackName = data.stackName || data.stack_name;
  }
  
  static fromApi(data) {
    return new Container(data);
  }
  
  static fromApiArray(dataArray) {
    return (dataArray || []).map(item => Container.fromApi(item));
  }
}

/**
 * Tracked Image Model
 */
export class TrackedImage {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.imageName = data.imageName || data.image_name;
    this.githubRepo = data.githubRepo || data.github_repo;
    this.sourceType = data.sourceType || data.source_type || 'docker';
    this.currentVersion = data.currentVersion || data.current_version;
    this.currentDigest = data.currentDigest || data.current_digest;
    this.latestVersion = data.latestVersion || data.latest_version;
    this.latestDigest = data.latestDigest || data.latest_digest;
    this.hasUpdate = data.hasUpdate || data.has_update === true || data.has_update === 1;
    this.currentVersionPublishDate = data.currentVersionPublishDate || data.current_version_publish_date;
    this.latestVersionPublishDate = data.latestVersionPublishDate || data.latest_version_publish_date;
    this.lastChecked = data.lastChecked || data.last_checked;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }
  
  static fromApi(data) {
    return new TrackedImage(data);
  }
  
  static fromApiArray(dataArray) {
    return (dataArray || []).map(item => TrackedImage.fromApi(item));
  }
}

/**
 * Batch Run Model
 */
export class BatchRun {
  constructor(data) {
    this.id = data.id;
    this.status = data.status;
    this.jobType = data.jobType || data.job_type || 'docker-hub-pull';
    this.isManual = data.isManual || data.is_manual === true || data.is_manual === 1;
    this.startedAt = data.startedAt || data.started_at;
    this.completedAt = data.completedAt || data.completed_at;
    this.durationMs = data.durationMs || data.duration_ms;
    this.containersChecked = data.containersChecked || data.containers_checked || 0;
    this.containersUpdated = data.containersUpdated || data.containers_updated || 0;
    this.errorMessage = data.errorMessage || data.error_message;
    this.logs = data.logs;
  }
  
  static fromApi(data) {
    return new BatchRun(data);
  }
  
  static fromApiArray(dataArray) {
    return (dataArray || []).map(item => BatchRun.fromApi(item));
  }
}

/**
 * Discord Webhook Model
 */
export class DiscordWebhook {
  constructor(data) {
    this.id = data.id;
    this.serverName = data.serverName || data.server_name;
    this.channelName = data.channelName || data.channel_name;
    this.avatarUrl = data.avatarUrl || data.avatar_url;
    this.guildId = data.guildId || data.guild_id;
    this.channelId = data.channelId || data.channel_id;
    this.enabled = data.enabled === true || data.enabled === 1;
    this.hasWebhook = data.hasWebhook || !!data.webhook_url;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }
  
  static fromApi(data) {
    return new DiscordWebhook(data);
  }
  
  static fromApiArray(dataArray) {
    return (dataArray || []).map(item => DiscordWebhook.fromApi(item));
  }
}

/**
 * Docker Hub Credentials Model
 */
export class DockerHubCredentials {
  constructor(data) {
    this.username = data.username;
    this.hasToken = data.hasToken || !!data.token;
    this.updatedAt = data.updatedAt || data.updated_at;
  }
  
  static fromApi(data) {
    return new DockerHubCredentials(data);
  }
}

/**
 * Batch Config Model
 */
export class BatchConfig {
  constructor(data) {
    this.enabled = data.enabled === true || data.enabled === 1;
    this.interval = data.interval || 60; // minutes
    this.checkOnStartup = data.checkOnStartup || data.check_on_startup === true || data.check_on_startup === 1;
  }
  
  static fromApi(data) {
    return new BatchConfig(data);
  }
}

