/**
 * Analytics page constants
 * View tabs and filter options for upgrade analytics
 */

export const ANALYTICS_VIEW_TABS = {
  OVERVIEW: "overview",
  CONTAINERS: "containers",
  TRACKED_APPS: "tracked-apps",
  PERFORMANCE: "performance",
  PATTERNS: "patterns",
  INSIGHTS: "insights",
};

export const ANALYTICS_VIEW_TAB_LABELS = {
  [ANALYTICS_VIEW_TABS.OVERVIEW]: "Overview",
  [ANALYTICS_VIEW_TABS.CONTAINERS]: "Containers",
  [ANALYTICS_VIEW_TABS.TRACKED_APPS]: "Apps",
  [ANALYTICS_VIEW_TABS.PERFORMANCE]: "Performance",
  [ANALYTICS_VIEW_TABS.PATTERNS]: "Patterns",
  [ANALYTICS_VIEW_TABS.INSIGHTS]: "Insights",
};

/** Data source filter: which upgrade history to include */
export const ANALYTICS_DATA_SOURCE = {
  CONTAINERS: "containers",
  TRACKED_APPS: "tracked-apps",
};

export const ANALYTICS_DATA_SOURCE_LABELS = {
  [ANALYTICS_DATA_SOURCE.CONTAINERS]: "Container upgrades",
  [ANALYTICS_DATA_SOURCE.TRACKED_APPS]: "App upgrades",
};
