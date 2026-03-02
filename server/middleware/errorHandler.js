/**
 * Error handling middleware
 * Handles all application errors with consistent response format
 */

const logger = require("../utils/logger");
const { sendErrorResponse } = require("../utils/responseHelpers");
const {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitExceededError,
  AppError,
} = require("../utils/errors");

/**
 * Global error handler middleware
 * Recognizes custom error classes and formats responses accordingly
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Error handler requires comprehensive error processing logic
function errorHandler(err, req, res, _next) {
  // Log error with context
  logger.error("Request error", {
    module: "errorHandler",
    error: err,
    method: req.method,
    url: req.url,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id,
    requestId: req.requestId,
    statusCode: err.statusCode || err.status || 500,
    errorCode: err.errorCode,
  });

  // Handle custom error classes
  if (err instanceof ValidationError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      missingFields: err.missingFields,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof NotFoundError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      resource: err.resource,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof UnauthorizedError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof ForbiddenError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof ConflictError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof RateLimitExceededError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  if (err instanceof AppError) {
    return sendErrorResponse(res, err.message, err.statusCode, {
      errorCode: err.errorCode,
      details: process.env.NODE_ENV === "development" ? err.details : undefined,
    });
  }

  // Axios errors from upstream services (e.g. dockhand runner).
  // Never forward a 401/403 from an upstream service as a 401 to the browser
  // — that would trigger the client's global logout interceptor for what is
  // really just a misconfigured runner API key or an offline service.
  if (err.isAxiosError) {
    const upstreamStatus = err.response?.status;
    const outboundStatus =
      upstreamStatus === 401 || upstreamStatus === 403 ? 502 : upstreamStatus || 502;
    return sendErrorResponse(res, `Runner connection error: ${err.message}`, outboundStatus, {
      errorCode: "RUNNER_CONNECTION_ERROR",
    });
  }

  // Handle unknown errors
  const status = err.statusCode || err.status || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  return sendErrorResponse(res, message, status, {
    errorCode: "INTERNAL_ERROR",
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      details: err.details,
    }),
  });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Wrapped function
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  asyncHandler,
};
