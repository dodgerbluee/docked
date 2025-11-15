/**
 * Standardized error messages for the application
 */

export const ERROR_MESSAGES = {
  BATCH: {
    FETCH_RUNS: "Failed to load batch run information",
    FETCH_RECENT: "Failed to load recent batch runs",
    TRIGGER: "Failed to trigger batch job",
    CONFIG_UPDATE: "Failed to update batch configuration. Please try again.",
    CONFIG_FETCH: "Failed to load batch configuration",
  },
  GENERAL: {
    NETWORK: "Network error. Please check your connection and try again.",
    UNKNOWN: "An unexpected error occurred. Please try again.",
  },
};

export const SUCCESS_MESSAGES = {
  BATCH: {
    CONFIG_UPDATE: "Batch configurations updated successfully!",
  },
};

/**
 * Get a standardized error message
 * @param {string} category - Error category (e.g., 'BATCH')
 * @param {string} key - Error key (e.g., 'FETCH_RUNS')
 * @param {string} fallback - Fallback message if not found
 * @returns {string} Error message
 */
export function getErrorMessage(category, key, fallback = ERROR_MESSAGES.GENERAL.UNKNOWN) {
  return ERROR_MESSAGES[category]?.[key] || fallback;
}
