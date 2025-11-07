/**
 * Error handling middleware
 */

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Default error
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Don't leak error details in production
  const errorResponse = {
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  res.status(status).json(errorResponse);
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

