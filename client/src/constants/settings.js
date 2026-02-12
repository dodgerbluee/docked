/**
 * Settings page constants
 */

export const SETTINGS_TABS = {
  GENERAL: "general",
  USERNAME: "username",
  PASSWORD: "password",
  AVATAR: "avatar",
  PORTAINER: "portainer",
  TRACKED_APPS: "trackedapps",
  // DOCKERHUB removed - credentials no longer stored
  DISCORD: "discord",
  USER_DETAILS: "userdetails",
  REPOSITORIES: "repositories",
  LOGS: "logs",
  DATA: "data",
};

export const SETTINGS_TAB_LABELS = {
  [SETTINGS_TABS.GENERAL]: "General",
  [SETTINGS_TABS.USERNAME]: "Username",
  [SETTINGS_TABS.PASSWORD]: "Password",
  [SETTINGS_TABS.AVATAR]: "Avatar",
  [SETTINGS_TABS.PORTAINER]: "Portainer",
  [SETTINGS_TABS.TRACKED_APPS]: "Tracked Apps",
  // Docker Hub tab removed
  [SETTINGS_TABS.DISCORD]: "Notifications",
  [SETTINGS_TABS.USER_DETAILS]: "User",
  [SETTINGS_TABS.REPOSITORIES]: "Repositories",
  [SETTINGS_TABS.LOGS]: "Logs",
  [SETTINGS_TABS.DATA]: "Data",
};

export const COLOR_SCHEMES = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
};

export const LOG_LEVELS = {
  INFO: "info",
  DEBUG: "debug",
};

export const BATCH_JOB_TYPES = {
  DOCKER_HUB_PULL: "docker-hub-pull",
  TRACKED_APPS_CHECK: "tracked-apps-check",
  AUTO_UPDATE: "auto-update",
};

export const BATCH_INTERVAL_UNITS = {
  MINUTES: "minutes",
  HOURS: "hours",
};

export const DEFAULT_BATCH_CONFIG = {
  enabled: false,
  intervalMinutes: 60,
  intervalValue: 60,
  intervalUnit: BATCH_INTERVAL_UNITS.MINUTES,
};
