/**
 * Error handling middleware
 * Handles all errors with proper typing and logging
 */

const logger = require('../utils/logger');
const { AppError, ProgrammerError } = require('../domain/errors');
const { ApiResponse } = require('../domain/dtos');

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {
  // Determine if this is an operational error or programmer error
  const isOperational = err instanceof AppError ? err.isOperational : false;
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  // Log error with appropriate level and context
  const logContext = {
    module: 'errorHandler',
    error: {
      name: err.name,
      message: err.message,
      ...(err.field && { field: err.field }),
      ...(err.service && { service: err.service }),
      ...(err.originalError && { originalError: err.originalError.message }),
    },
    method: req.method,
    url: req.url,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id,
    requestId: req.requestId,
    statusCode,
    isOperational,
  };

  // Log programmer errors at error level, operational errors at warn level
  if (err instanceof ProgrammerError || !isOperational) {
    logger.error('Programmer error occurred', {
      ...logContext,
      stack: err.stack,
    });
  } else {
    logger.warn('Operational error occurred', logContext);
  }

  // Build error response
  const errorResponse = ApiResponse.error(message);

  // Add additional context in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.metadata = {
      ...errorResponse.metadata,
      name: err.name,
      stack: err.stack,
      ...(err.field && { field: err.field }),
      ...(err.details && { details: err.details }),
    };
  }

  // Add retry-after header for rate limit errors
  if (statusCode === 429 && err.retryAfter) {
    res.setHeader('Retry-After', err.retryAfter);
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * Normalizes errors to AppError types before passing to error handler
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Wrapped function
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next))
      .catch((err) => {
        // Normalize error before passing to error handler
        const normalizedError = normalizeError(err);
        next(normalizedError);
      });
  };
}

/**
 * Convert unhandled errors to operational errors
 * Wraps non-AppError exceptions in ProgrammerError
 * @param {Error} err - Error to convert
 * @returns {AppError} - Converted error
 */
function normalizeError(err) {
  if (err instanceof AppError) {
    return err;
  }

  // Convert known error types
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    const { ValidationError } = require('../domain/errors');
    return new ValidationError(err.message);
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    const { AuthenticationError } = require('../domain/errors');
    return new AuthenticationError('Invalid or expired token');
  }

  // Default to programmer error for unknown errors
  return new ProgrammerError(err.message || 'An unexpected error occurred');
}

module.exports = {
  errorHandler,
  asyncHandler,
  normalizeError,
};
