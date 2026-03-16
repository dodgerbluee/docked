/**
 * Containers page constants
 */

export const CONTAINERS_CONTENT_TABS = {
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
  ALL: "all",
  HISTORY: "history",
};

export const CONTAINERS_CONTENT_TAB_LABELS = {
  [CONTAINERS_CONTENT_TABS.UPDATES]: "Updates",
  [CONTAINERS_CONTENT_TABS.CURRENT]: "Up to date",
  [CONTAINERS_CONTENT_TABS.UNUSED]: "Unused",
  [CONTAINERS_CONTENT_TABS.ALL]: "All",
  [CONTAINERS_CONTENT_TABS.HISTORY]: "History",
};

export const CONTAINERS_IMAGE_SOURCE_FILTERS = {
  DOCKERHUB: "dockerhub",
  GITHUB: "github",
  GITLAB: "gitlab",
  GOOGLE: "google",
};

export const CONTAINERS_IMAGE_SOURCE_FILTER_LABELS = {
  [CONTAINERS_IMAGE_SOURCE_FILTERS.DOCKERHUB]: "Docker Hub",
  [CONTAINERS_IMAGE_SOURCE_FILTERS.GITHUB]: "GitHub",
  [CONTAINERS_IMAGE_SOURCE_FILTERS.GITLAB]: "GitLab",
  [CONTAINERS_IMAGE_SOURCE_FILTERS.GOOGLE]: "Google",
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

// Portainer container detection — refers to the actual Portainer Docker image
export const PORTAINER_CONTAINER_MESSAGE =
  "Portainer cannot be upgraded automatically. It must be upgraded manually.";

// Blocklisted container message
export const BLOCKLISTED_CONTAINER_MESSAGE =
  "This container is on the upgrade blocklist and cannot be upgraded. Manage the blocklist in Settings.";

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
