/**
 * Domain Error Classes
 * Typed error hierarchy for better error handling and debugging
 */

/**
 * Base application error
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Operational errors - expected errors that can be handled gracefully
 * Examples: validation errors, authentication failures, not found
 */
class OperationalError extends AppError {
  constructor(message, statusCode = 400) {
    super(message, statusCode, true);
  }
}

/**
 * Programmer errors - unexpected errors indicating bugs
 * Examples: null reference, type errors, logic errors
 */
class ProgrammerError extends AppError {
  constructor(message, statusCode = 500) {
    super(message, statusCode, false);
  }
}

/**
 * Validation error - input validation failures
 */
class ValidationError extends OperationalError {
  constructor(message, field = null, value = null) {
    super(message, 400);
    this.field = field;
    this.value = value;
  }
}

/**
 * Authentication error
 */
class AuthenticationError extends OperationalError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

/**
 * Authorization error
 */
class AuthorizationError extends OperationalError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
  }
}

/**
 * Not found error
 */
class NotFoundError extends OperationalError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.resource = resource;
  }
}

/**
 * Conflict error - resource already exists or state conflict
 */
class ConflictError extends OperationalError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

/**
 * Rate limit error
 */
class RateLimitError extends OperationalError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * External service error - errors from external APIs
 */
class ExternalServiceError extends OperationalError {
  constructor(service, message, statusCode = 502) {
    super(`External service error (${service}): ${message}`, statusCode);
    this.service = service;
  }
}

/**
 * Database error
 */
class DatabaseError extends ProgrammerError {
  constructor(message, originalError = null) {
    super(`Database error: ${message}`, 500);
    this.originalError = originalError;
  }
}

/**
 * Configuration error
 */
class ConfigurationError extends ProgrammerError {
  constructor(message) {
    super(`Configuration error: ${message}`, 500);
  }
}

/**
 * Payload too large error
 */
class PayloadTooLargeError extends OperationalError {
  constructor(message = 'Request payload too large') {
    super(message, 413);
  }
}

/**
 * Forbidden error (alias for AuthorizationError, but more specific)
 */
class ForbiddenError extends OperationalError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

module.exports = {
  AppError,
  OperationalError,
  ProgrammerError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  DatabaseError,
  ConfigurationError,
  PayloadTooLargeError,
  ForbiddenError,
};

