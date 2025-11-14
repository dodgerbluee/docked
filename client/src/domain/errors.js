/**
 * Typed Error Classes
 * Provides consistent error handling with typed error instances
 * Mirrors backend error structure for consistency
 */

/**
 * Base API Error class
 */
export class ApiError extends Error {
  constructor(message, originalError = null, statusCode = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
    this.isOperational = true;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
    };
  }
}

/**
 * Network Error - No response from server
 */
export class NetworkError extends ApiError {
  constructor(message = 'Network error', originalError = null) {
    super(message, originalError);
    this.name = 'NetworkError';
  }
}

/**
 * Authentication Error - 401, 403
 */
export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required', originalError = null) {
    super(message, originalError, 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Validation Error - 400, 422
 */
export class ValidationError extends ApiError {
  constructor(message = 'Validation failed', originalError = null, errors = null) {
    super(message, originalError, 422);
    this.name = 'ValidationError';
    this.errors = errors; // Field-level validation errors
  }
  
  toJSON() {
    return {
      ...super.toJSON(),
      errors: this.errors,
    };
  }
}

/**
 * Not Found Error - 404
 */
export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', originalError = null) {
    super(message, originalError, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Rate Limit Error - 429
 */
export class RateLimitError extends ApiError {
  constructor(message = 'Rate limit exceeded', originalError = null) {
    super(message, originalError, 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Server Error - 500, 502, 503, 504
 */
export class ServerError extends ApiError {
  constructor(message = 'Server error', originalError = null, statusCode = 500) {
    super(message, originalError, statusCode);
    this.name = 'ServerError';
  }
}

/**
 * Configuration Error - Invalid configuration
 */
export class ConfigurationError extends ApiError {
  constructor(message = 'Configuration error', originalError = null) {
    super(message, originalError);
    this.name = 'ConfigurationError';
  }
}

/**
 * Helper to check if error is a specific type
 */
export function isApiError(error) {
  return error instanceof ApiError;
}

export function isNetworkError(error) {
  return error instanceof NetworkError;
}

export function isAuthenticationError(error) {
  return error instanceof AuthenticationError;
}

export function isValidationError(error) {
  return error instanceof ValidationError;
}

export function isNotFoundError(error) {
  return error instanceof NotFoundError;
}

export function isRateLimitError(error) {
  return error instanceof RateLimitError;
}

export function isServerError(error) {
  return error instanceof ServerError;
}

/**
 * Extract user-friendly error message from any error
 */
export function getErrorMessage(error, defaultMessage = 'An error occurred') {
  if (!error) {
    return defaultMessage;
  }
  
  if (error instanceof ApiError) {
    return error.message;
  }
  
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return defaultMessage;
}

/**
 * Extract field-level validation errors
 */
export function getValidationErrors(error) {
  if (error instanceof ValidationError && error.errors) {
    return error.errors;
  }
  
  if (error.response?.data?.errors) {
    return error.response.data.errors;
  }
  
  return null;
}

