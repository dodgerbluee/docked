/**
 * Request Logging Middleware
 * Adds request lifecycle logging with requestId tracking
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Generate a unique request ID
 * @returns {string} - Request ID
 */
function generateRequestId() {
  // Use crypto.randomUUID() if available (Node.js 14.17.0+), otherwise fallback
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node.js versions
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Request logging middleware
 * Logs request start, completion, and errors with requestId
 */
function requestLogger(req, res, next) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Add requestId to request object
  req.requestId = requestId;

  // Create context for this request
  const context = {
    requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    userId: req.user?.id,
  };

  // Run request handler with context
  logger.withContext(context, () => {
    // Skip verbose logging for frequent polling endpoints
    const isPollingEndpoint = req.path === '/api/batch/runs/latest' && req.method === 'GET';
    
    // Log request start (only for non-polling endpoints or in debug mode)
    if (!isPollingEndpoint) {
      logger.debug('Request started', {
        method: req.method,
        url: req.url,
        path: req.path,
        ip: context.ip,
        userAgent: context.userAgent,
        userId: context.userId,
      });
    }

    // Log request completion
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      // Always log errors and warnings
      if (res.statusCode >= 400) {
        const logLevel = res.statusCode >= 500 ? 'error' : 'warn';
        logger[logLevel]('Request completed with error', {
          method: req.method,
          url: req.url,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: context.ip,
          userId: context.userId,
        });
      } 
      // Log slow requests (>1 second) at INFO level
      else if (duration > 1000) {
        logger.info('Slow request completed', {
          method: req.method,
          url: req.url,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: context.ip,
          userId: context.userId,
        });
      }
      // Log polling endpoints at DEBUG level only
      else if (isPollingEndpoint) {
        logger.debug('Polling request completed', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
        });
      }
      // Log other requests at DEBUG level
      else {
        logger.debug('Request completed', {
          method: req.method,
          url: req.url,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
        });
      }
    });

    // Continue to next middleware
    next();
  });
}

module.exports = requestLogger;

