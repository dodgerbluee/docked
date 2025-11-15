/**
 * Batch page constants
 */

import { DEFAULT_POLLING_INTERVAL_MS } from "./numbers";

export const BATCH_TABS = {
  HISTORY: "history",
  SETTINGS: "settings",
};

export const BATCH_TAB_LABELS = {
  [BATCH_TABS.HISTORY]: "Jobs",
  [BATCH_TABS.SETTINGS]: "Settings",
};

export const BATCH_JOB_TYPES = {
  DOCKER_HUB_PULL: "docker-hub-pull",
  TRACKED_APPS_CHECK: "tracked-apps-check",
};

export const BATCH_JOB_TYPE_LABELS = {
  [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: "Docker Hub Scan",
  [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: "Tracked Apps Scan",
};

export const BATCH_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const BATCH_STATUS_LABELS = {
  [BATCH_STATUS.RUNNING]: "Running",
  [BATCH_STATUS.COMPLETED]: "Completed",
  [BATCH_STATUS.FAILED]: "Failed",
};

export const REFRESH_INTERVAL_MS = DEFAULT_POLLING_INTERVAL_MS;

export const DEFAULT_RUN_LIMIT = 20;
