/**
 * Custom Error Classes
 * Provides structured error handling with consistent error types
 */

const { HTTP_STATUS, ERROR_CODES } = require("../constants");

/**
 * Base application error class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = null, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode || ERROR_CODES.INTERNAL_ERROR;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error - for input validation failures
 */
class ValidationError extends AppError {
  constructor(message, missingFields = [], details = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, details);
    this.missingFields = missingFields;
  }
}

/**
 * Not found error - for resource not found
 */
class NotFoundError extends AppError {
  constructor(resource, details = null) {
    const message = resource ? `${resource} not found` : "Resource not found";
    super(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, details);
    this.resource = resource;
  }
}

/**
 * Unauthorized error - for authentication failures
 */
class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details = null) {
    super(message, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, details);
  }
}

/**
 * Forbidden error - for authorization failures
 */
class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details = null) {
    super(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN, details);
  }
}

/**
 * Conflict error - for resource conflicts (e.g., duplicate entries)
 */
class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, HTTP_STATUS.CONFLICT, ERROR_CODES.CONFLICT, details);
  }
}

/**
 * Rate limit exceeded error
 */
class RateLimitExceededError extends AppError {
  constructor(message = "Rate limit exceeded", details = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RATE_LIMIT_EXCEEDED, details);
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitExceededError,
};
