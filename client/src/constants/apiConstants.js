/**
 * API-related constants
 * Centralized constants for API timeouts, endpoints, and configuration
 */

export const API_TIMEOUTS = {
  PULL_OPERATION: 300000, // 5 minutes for Docker Hub pull operations
  DEFAULT: 30000, // 30 seconds default timeout
};

export const STORAGE_KEYS = {
  DOCKER_HUB_DATA_PULLED: "dockerHubDataPulled",
  LAST_PULL_TIME: "lastPullTime",
  LAST_BATCH_INITIAL_PULL: "lastBatchInitialPull",
  DISMISSED_CONTAINER_NOTIFICATIONS: "dismissedContainerNotifications",
  DISMISSED_TRACKED_APP_NOTIFICATIONS: "dismissedTrackedAppNotifications",
  COLOR_SCHEME: "colorScheme",
};

export const TAB_NAMES = {
  SUMMARY: "summary",
  PORTAINER: "portainer",
  TRACKED_APPS: "tracked-apps",
  AUTO_UPDATE: "auto-update",
  ANALYTICS: "analytics",
  SETTINGS: "settings",
  CONFIGURATION: "configuration",
  BATCH_LOGS: "batch-logs",
  ADMIN: "admin",
};

export const CONTENT_TABS = {
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
};

export const SETTINGS_TABS = {
  GENERAL: "general",
  USERNAME: "username",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DOCKERHUB: "dockerhub",
  AVATAR: "avatar",
  BATCH: "batch",
};

export const CONFIGURATION_TABS = {
  HISTORY: "history",
  SETTINGS: "settings",
};
