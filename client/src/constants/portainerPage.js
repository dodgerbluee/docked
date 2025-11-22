/**
 * Portainer page constants
 */

export const PORTAINER_CONTENT_TABS = {
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
  ALL: "all",
};

export const PORTAINER_CONTENT_TAB_LABELS = {
  [PORTAINER_CONTENT_TABS.UPDATES]: "Updates",
  [PORTAINER_CONTENT_TABS.CURRENT]: "Up to date",
  [PORTAINER_CONTENT_TABS.UNUSED]: "Unused",
  [PORTAINER_CONTENT_TABS.ALL]: "All",
};

export const PORTAINER_IMAGE_SOURCE_FILTERS = {
  DOCKERHUB: "dockerhub",
  GITHUB: "github",
  GITLAB: "gitlab",
  GOOGLE: "google",
};

export const PORTAINER_IMAGE_SOURCE_FILTER_LABELS = {
  [PORTAINER_IMAGE_SOURCE_FILTERS.DOCKERHUB]: "Docker Hub",
  [PORTAINER_IMAGE_SOURCE_FILTERS.GITHUB]: "GitHub",
  [PORTAINER_IMAGE_SOURCE_FILTERS.GITLAB]: "GitLab",
  [PORTAINER_IMAGE_SOURCE_FILTERS.GOOGLE]: "Google",
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
