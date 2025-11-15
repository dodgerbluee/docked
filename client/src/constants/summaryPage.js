/**
 * Constants for Summary Page functionality
 */

// Content tab types
export const CONTENT_TABS = {
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
};

// Stat card variants
export const STAT_CARD_VARIANTS = {
  DEFAULT: "",
  UPDATE_AVAILABLE: "update-available",
  CURRENT: "current",
  UNUSED_IMAGES: "unused-images",
};

// Stat type mappings for PortainerInstanceCard
export const STAT_TYPES = {
  TOTAL: "total",
  UPDATES: "updates",
  CURRENT: "current",
  UNUSED: "unused",
};

// Mapping from stat type to content tab
export const STAT_TYPE_TO_CONTENT_TAB = {
  [STAT_TYPES.TOTAL]: CONTENT_TABS.UPDATES,
  [STAT_TYPES.UPDATES]: CONTENT_TABS.UPDATES,
  [STAT_TYPES.CURRENT]: CONTENT_TABS.CURRENT,
  [STAT_TYPES.UNUSED]: CONTENT_TABS.UNUSED,
};

// Variant mapping for CSS Modules (kebab-case to camelCase)
export const VARIANT_MAP = {
  [STAT_CARD_VARIANTS.UPDATE_AVAILABLE]: "updateAvailable",
  [STAT_CARD_VARIANTS.UNUSED_IMAGES]: "unusedImages",
  [STAT_CARD_VARIANTS.CURRENT]: "current",
};
