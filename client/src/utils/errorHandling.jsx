/**
 * Error Handling Utilities
 * Standardized error handling patterns for the application
 */

/**
 * Extracts a user-friendly error message from an error object
 * @param {Error|Object} error - Error object from API or exception
 * @param {string} defaultMessage - Default message if error cannot be extracted
 * @returns {string} - User-friendly error message
 */
export function getErrorMessage(error, defaultMessage = "An error occurred") {
  if (!error) {
    return defaultMessage;
  }

  // Handle axios error responses
  if (error.response?.data?.error) {
    return error.response.data.error;
  }

  // Handle axios error messages
  if (error.response?.data?.message) {
    return error.response.data.message;
  }

  // Handle standard Error objects
  if (error.message) {
    return error.message;
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  return defaultMessage;
}

/**
 * Creates a standardized error result object
 * @param {Error|Object|string} error - Error object or message
 * @param {string} defaultMessage - Default message if error cannot be extracted
 * @returns {Object} - Standardized error result { success: false, error: string }
 */
export function createErrorResult(error, defaultMessage = "An error occurred") {
  return {
    success: false,
    error: getErrorMessage(error, defaultMessage),
  };
}

/**
 * Creates a standardized success result object
 * @param {any} data - Optional data to include
 * @returns {Object} - Standardized success result { success: true, data?: any }
 */
export function createSuccessResult(data = null) {
  return data !== null ? { success: true, data } : { success: true };
}

/**
 * Wraps an async function with standardized error handling
 * @param {Function} asyncFn - Async function to wrap
 * @param {string} defaultErrorMessage - Default error message
 * @returns {Promise<Object>} - Promise resolving to { success: boolean, error?: string, data?: any }
 */
export async function withErrorHandling(asyncFn, defaultErrorMessage = "An error occurred") {
  try {
    const result = await asyncFn();
    return createSuccessResult(result);
  } catch (error) {
    console.error("Error in async operation:", error);
    return createErrorResult(error, defaultErrorMessage);
  }
}

/**
 * Handles API errors consistently
 * @param {Error} error - Axios error object
 * @param {string} operation - Name of the operation (for logging)
 * @returns {Object} - Standardized error result
 */
export function handleApiError(error, operation = "API request") {
  console.error(`Error in ${operation}:`, error);

  // Network errors
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ERR_NETWORK") {
    return createErrorResult("Network error. Please check your connection and try again.");
  }

  // Rate limiting
  if (error.response?.status === 429) {
    return createErrorResult("Rate limit exceeded. Please try again later.");
  }

  // Server errors
  if (error.response?.status >= 500) {
    return createErrorResult("Server error. Please try again later.");
  }

  // Client errors (400-499)
  if (error.response?.status >= 400) {
    return createErrorResult(
      error.response?.data?.error ||
        `Request failed: ${error.response?.statusText || "Bad request"}`
    );
  }

  // Default
  return createErrorResult(error, `Failed to complete ${operation}`);
}
