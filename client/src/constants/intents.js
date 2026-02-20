/**
 * Constants for Intents feature
 */

// Schedule types
export const SCHEDULE_TYPES = {
  IMMEDIATE: "immediate",
  SCHEDULED: "scheduled",
};

// Schedule type labels
export const SCHEDULE_TYPE_LABELS = {
  [SCHEDULE_TYPES.IMMEDIATE]: "Immediate",
  [SCHEDULE_TYPES.SCHEDULED]: "Scheduled (Cron)",
};

// Match criteria types for the unified type selector
export const MATCH_TYPES = {
  CONTAINERS: "matchContainers",
  IMAGES: "matchImages",
  STACKS: "matchStacks",
  INSTANCES: "matchInstances",
  REGISTRIES: "matchRegistries",
};

export const MATCH_TYPE_LABELS = {
  [MATCH_TYPES.CONTAINERS]: "Containers",
  [MATCH_TYPES.IMAGES]: "Images",
  [MATCH_TYPES.STACKS]: "Stacks",
  [MATCH_TYPES.INSTANCES]: "Portainer",
  [MATCH_TYPES.REGISTRIES]: "Registries",
};

export const MATCH_TYPE_PLACEHOLDERS = {
  [MATCH_TYPES.CONTAINERS]: "e.g., nginx-proxy",
  [MATCH_TYPES.IMAGES]: "e.g., nginx:* or library/redis:*",
  [MATCH_TYPES.STACKS]: "e.g., production-*",
  [MATCH_TYPES.INSTANCES]: "e.g., My Portainer Server",
  [MATCH_TYPES.REGISTRIES]: "e.g., docker.io, ghcr.io",
};

export const MATCH_TYPE_HELPERS = {
  [MATCH_TYPES.CONTAINERS]:
    "Supports glob patterns with * (e.g., nginx-* matches nginx-proxy, nginx-web)",
  [MATCH_TYPES.IMAGES]: "Supports glob patterns with *",
  [MATCH_TYPES.STACKS]: "Matches Portainer/Docker Compose stack names, supports *",
  [MATCH_TYPES.INSTANCES]: "Filter by Portainer instance name",
  [MATCH_TYPES.REGISTRIES]: "Filter by container registry, supports *",
};

// Execution statuses
export const EXECUTION_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  PARTIAL: "partial",
};

// Max intents per user
export const MAX_INTENTS_PER_USER = 50;

// Default form values for a new intent
export const DEFAULT_INTENT_FORM = {
  name: "",
  enabled: true,
  matchType: MATCH_TYPES.CONTAINERS,
  matchValues: [],
  scheduleType: SCHEDULE_TYPES.IMMEDIATE,
  scheduleCron: "0 0 * * *",
  dryRun: true,
};

// Common cron presets
export const CRON_PRESETS = [
  { label: "Every night at midnight", value: "0 0 * * *" },
  { label: "Every day at 2:00 AM", value: "0 2 * * *" },
  { label: "Every Sunday at 3:00 AM", value: "0 3 * * 0" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
];

// Execution status labels
export const EXECUTION_STATUS_LABELS = {
  [EXECUTION_STATUSES.PENDING]: "Pending",
  [EXECUTION_STATUSES.RUNNING]: "Running",
  [EXECUTION_STATUSES.COMPLETED]: "Completed",
  [EXECUTION_STATUSES.FAILED]: "Failed",
  [EXECUTION_STATUSES.PARTIAL]: "Partial",
};

// Execution status color map (CSS variable names)
export const EXECUTION_STATUS_COLORS = {
  [EXECUTION_STATUSES.PENDING]: "var(--text-secondary)",
  [EXECUTION_STATUSES.RUNNING]: "var(--dodger-blue)",
  [EXECUTION_STATUSES.COMPLETED]: "var(--success-green)",
  [EXECUTION_STATUSES.FAILED]: "var(--dodger-red)",
  [EXECUTION_STATUSES.PARTIAL]: "#d97706",
};

// Trigger type labels
export const TRIGGER_TYPE_LABELS = {
  manual: "Manual",
  scan_detected: "Scan Detected",
  scheduled_window: "Scheduled",
};

// Container execution status constants
export const CONTAINER_STATUSES = {
  UPGRADED: "upgraded",
  FAILED: "failed",
  SKIPPED: "skipped",
  DRY_RUN: "dry_run",
};

// Container execution status labels
export const CONTAINER_STATUS_LABELS = {
  [CONTAINER_STATUSES.UPGRADED]: "Upgraded",
  [CONTAINER_STATUSES.FAILED]: "Failed",
  [CONTAINER_STATUSES.SKIPPED]: "Skipped",
  [CONTAINER_STATUSES.DRY_RUN]: "Dry Run",
};

// Container status color map
export const CONTAINER_STATUS_COLORS = {
  [CONTAINER_STATUSES.UPGRADED]: "var(--success-green)",
  [CONTAINER_STATUSES.FAILED]: "var(--dodger-red)",
  [CONTAINER_STATUSES.SKIPPED]: "var(--text-secondary)",
  [CONTAINER_STATUSES.DRY_RUN]: "#d97706",
};

// Timeout constants (in milliseconds)
export const SUCCESS_MESSAGE_DURATION = 6000;
export const SHORT_SUCCESS_MESSAGE_DURATION = 3000;
