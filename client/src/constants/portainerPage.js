/**
 * Portainer page constants
 */

export const PORTAINER_CONTENT_TABS = {
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
};

export const PORTAINER_CONTENT_TAB_LABELS = {
  [PORTAINER_CONTENT_TABS.UPDATES]: "Updates",
  [PORTAINER_CONTENT_TABS.CURRENT]: "Current",
  [PORTAINER_CONTENT_TABS.UNUSED]: "Unused",
};

// Stack constants
export const STACK_NAMES = {
  STANDALONE: "Standalone",
};

// Container status constants
export const CONTAINER_STATUS = {
  HAS_UPDATE: "hasUpdate",
  UP_TO_DATE: "upToDate",
};

// Portainer container detection
export const PORTAINER_CONTAINER_MESSAGE =
  "Portainer cannot be upgraded automatically. It must be upgraded manually.";

// Date formatting
export const DEFAULT_TIMEZONE = "America/Chicago";
export const DATE_FORMAT_OPTIONS = {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hour12: true,
};

// Grid layout constants
export const GRID_COLUMNS = {
  DESKTOP: 3,
  TABLET: 2,
  MOBILE: 1,
};

