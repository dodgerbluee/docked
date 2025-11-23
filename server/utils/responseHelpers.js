/**
 * Response Helper Utilities
 * Provides standardized response formats for consistent API responses
 */

/**
 * Standardized error response format
 * @param {string} message - Error message
 * @param {number} [statusCode=500] - HTTP status code
 * @param {Object} [additionalFields={}] - Additional fields to include in response
 * @returns {Object} - Standardized error response object
 */
function createErrorResponse(message, statusCode = 500, additionalFields = {}) {
  return {
    success: false,
    error: message,
    ...additionalFields,
  };
}

/**
 * Standardized success response format
 * @param {Object} [data={}] - Response data
 * @param {string} [message] - Optional success message
 * @returns {Object} - Standardized success response object
 */
function createSuccessResponse(data = {}, message = null) {
  const response = {
    success: true,
    ...data,
  };
  if (message) {
    response.message = message;
  }
  return response;
}

/**
 * Standardized validation error response
 * @param {string|Array<string>} errors - Error message(s) or array of field errors
 * @param {Array<string>} [missingFields=[]] - Array of missing field names
 * @returns {Object} - Standardized validation error response
 */
function createValidationErrorResponse(errors, missingFields = []) {
  const errorMessage = Array.isArray(errors) ? errors.join(", ") : errors;
  return {
    success: false,
    error: errorMessage,
    ...(missingFields.length > 0 && { missingFields }),
  };
}

/**
 * Send standardized error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} [statusCode=500] - HTTP status code
 * @param {Object} [additionalFields={}] - Additional fields to include
 */
function sendErrorResponse(res, message, statusCode = 500, additionalFields = {}) {
  return res.status(statusCode).json(createErrorResponse(message, statusCode, additionalFields));
}

/**
 * Send standardized success response
 * @param {Object} res - Express response object
 * @param {Object} [data={}] - Response data
 * @param {string} [message] - Optional success message
 * @param {number} [statusCode=200] - HTTP status code
 */
function sendSuccessResponse(res, data = {}, message = null, statusCode = 200) {
  return res.status(statusCode).json(createSuccessResponse(data, message));
}

/**
 * Send standardized validation error response
 * @param {Object} res - Express response object
 * @param {string|Array<string>} errors - Error message(s)
 * @param {Array<string>} [missingFields=[]] - Array of missing field names
 * @param {number} [statusCode=400] - HTTP status code
 */
function sendValidationErrorResponse(res, errors, missingFields = [], statusCode = 400) {
  return res.status(statusCode).json(createValidationErrorResponse(errors, missingFields));
}

module.exports = {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
  sendErrorResponse,
  sendSuccessResponse,
  sendValidationErrorResponse,
};
