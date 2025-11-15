/**
 * Centralized Structured Logging System
 * 
 * Provides production-grade, structured logging with:
 * - Structured JSON output
 * - Contextual metadata (requestId, userId, jobId, batchId, etc.)
 * - Automatic sensitive data redaction
 * - Performance-safe DEBUG logging (lazy evaluation)
 * - Dynamic log level control
 * - Module/service identification
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Lazy load logLevel to avoid circular dependency
let logLevelModule = null;
function getLogLevelModule() {
  if (!logLevelModule) {
    try {
      logLevelModule = require('./logLevel');
    } catch (err) {
      // If logLevel not available yet, return a fallback
      return {
        getCachedLogLevel: () => process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      };
    }
  }
  return logLevelModule;
}

// Create logs directory if it doesn't exist
const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Sensitive field patterns to redact
const SENSITIVE_PATTERNS = [
  /password/gi,
  /token/gi,
  /secret/gi,
  /api[_-]?key/gi,
  /auth[_-]?token/gi,
  /authorization/gi,
  /credential/gi,
  /private[_-]?key/gi,
  /access[_-]?token/gi,
  /refresh[_-]?token/gi,
];

// Redact sensitive information from objects
function redactSensitive(obj, depth = 0) {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if string contains sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(obj)) {
        return '[REDACTED]';
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if key matches sensitive patterns
      let isSensitive = false;
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(key)) {
          isSensitive = true;
          break;
        }
      }

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitive(value, depth + 1);
      }
    }
    return redacted;
  }

  return obj;
}

// Context storage using AsyncLocalStorage for request context
const { AsyncLocalStorage } = require('async_hooks');
const contextStorage = new AsyncLocalStorage();

/**
 * Get current context from AsyncLocalStorage
 * @returns {Object} - Current context
 */
function getContext() {
  const store = contextStorage.getStore();
  return store || {};
}

/**
 * Set context for current execution
 * @param {Object} context - Context object
 * @param {Function} fn - Function to run with context
 */
function runWithContext(context, fn) {
  return contextStorage.run(context, fn);
}

/**
 * Create a child logger with additional context
 * @param {Object} additionalContext - Additional context to merge
 * @returns {Object} - Child logger instance
 */
function createChildLogger(additionalContext = {}) {
  const baseContext = getContext();
  const mergedContext = { ...baseContext, ...additionalContext };

  return {
    info: (message, metadata = {}) => {
      return logger.info(message, { ...mergedContext, ...metadata });
    },
    debug: (message, metadata = {}) => {
      return logger.debug(message, { ...mergedContext, ...metadata });
    },
    warn: (message, metadata = {}) => {
      return logger.warn(message, { ...mergedContext, ...metadata });
    },
    error: (message, metadata = {}) => {
      return logger.error(message, { ...mergedContext, ...metadata });
    },
    critical: (message, metadata = {}) => {
      return logger.critical(message, { ...mergedContext, ...metadata });
    },
    child: (moreContext) => createChildLogger({ ...mergedContext, ...moreContext }),
  };
}

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // Extract context from metadata
    const context = getContext();
    
    // Merge context into log entry
    info.requestId = info.requestId || context.requestId;
    info.userId = info.userId || context.userId;
    info.jobId = info.jobId || context.jobId;
    info.batchId = info.batchId || context.batchId;
    info.module = info.module || context.module || 'unknown';
    info.service = info.service || context.service;

    // Redact sensitive information
    if (info.metadata) {
      info.metadata = redactSensitive(info.metadata);
    }
    if (info.error) {
      info.error = redactSensitive(info.error);
    }

    // Ensure standard fields
    info.timestamp = info.timestamp;
    info.level = info.level;
    info.message = info.message;

    return info;
  })(),
  winston.format.json()
);

// Console format for development (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, module, requestId, userId, jobId, batchId, ...meta }) => {
    const contextParts = [];
    if (module) contextParts.push(`[${module}]`);
    if (requestId) contextParts.push(`[req:${requestId.substring(0, 8)}]`);
    if (userId) contextParts.push(`[user:${userId}]`);
    if (jobId) contextParts.push(`[job:${jobId}]`);
    if (batchId) contextParts.push(`[batch:${batchId}]`);
    
    const contextStr = contextParts.length > 0 ? contextParts.join(' ') + ' ' : '';
    let msg = `${timestamp} [${level}] ${contextStr}${message}`;
    
    // Add metadata if present (excluding standard fields)
    const metaKeys = Object.keys(meta).filter(key => 
      !['timestamp', 'level', 'message', 'module', 'requestId', 'userId', 'jobId', 'batchId', 'service', 'stack'].includes(key)
    );
    
    if (metaKeys.length > 0) {
      const metaObj = {};
      metaKeys.forEach(key => {
        metaObj[key] = meta[key];
      });
      msg += ` ${JSON.stringify(redactSensitive(metaObj))}`;
    }
    
    // Add stack trace for errors
    if (meta.stack) {
      msg += `\n${meta.stack}`;
    }
    
    return msg;
  })
);

// Determine log level from environment or database
function getEffectiveLogLevel() {
  // Check environment variable first
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL.toLowerCase();
  }
  
  // Fall back to cached database log level (lazy load to avoid circular dependency)
  try {
    const logLevel = getLogLevelModule();
    return logLevel.getCachedLogLevel();
  } catch (err) {
    // Default to info if database not ready
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  }
}

// Create Winston logger instance
// Use environment variable for initial level to avoid circular dependency during init
const initialLogLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const winstonLogger = winston.createLogger({
  level: initialLogLevel,
  format: structuredFormat,
  defaultMeta: { 
    service: 'docked',
  },
  transports: [
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: structuredFormat,
    }),
    // Write errors to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: structuredFormat,
    }),
  ],
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: structuredFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: structuredFormat,
    }),
  ],
});

// Always add console transport for container/Docker visibility
// Logs need to go to stdout/stderr to be visible in docker logs
// In production, we can disable with DISABLE_CONSOLE_LOGGING=true if needed
if (process.env.DISABLE_CONSOLE_LOGGING !== 'true') {
  winstonLogger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Update log level dynamically
function updateLogLevel() {
  const newLevel = getEffectiveLogLevel();
  winstonLogger.level = newLevel;
  winstonLogger.transports.forEach(transport => {
    if (transport.level) {
      // Only update if transport has a specific level
      transport.level = newLevel;
    }
  });
}

// Initialize log level from database after module is fully loaded
// This avoids circular dependency during module initialization
// Skip in test environment to avoid teardown issues
if (process.env.NODE_ENV !== 'test' && typeof jest === 'undefined') {
  const initTimer = setTimeout(() => {
    try {
      updateLogLevel();
      // Log that logger is initialized (this helps verify logging is working)
      winstonLogger.info('Logger initialized', {
        module: 'logger',
        initialLevel: initialLogLevel,
        currentLevel: winstonLogger.level,
        transports: winstonLogger.transports.map(t => t.constructor.name),
      });
    } catch (err) {
      // Log initialization error to console as fallback
      console.error('[logger] Error initializing logger:', err.message);
    }
  }, 100);
  
  // Store timer reference for cleanup if needed
  if (typeof global !== 'undefined') {
    global.__loggerInitTimer = initTimer;
  }
}

// Check if debug logging is enabled (for performance optimization)
function isDebugEnabled() {
  return getEffectiveLogLevel() === 'debug';
}

/**
 * Main logger interface
 */
const logger = {
  /**
   * Log INFO level message
   * Use for: operations, state transitions, meaningful events
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  info: (message, metadata = {}) => {
    const context = getContext();
    winstonLogger.info(message, {
      ...context,
      ...metadata,
    });
  },

  /**
   * Log DEBUG level message
   * Use for: internal state, data structures, variables, low-level debugging
   * Performance-safe: only evaluates if debug is enabled
   * @param {string} message - Log message
   * @param {Object|Function} metadataOrFn - Metadata object or function that returns metadata (lazy evaluation)
   */
  debug: (message, metadataOrFn = {}) => {
    if (!isDebugEnabled()) {
      return; // Early return for performance
    }

    const context = getContext();
    let metadata = metadataOrFn;
    
    // Support lazy evaluation: if metadataOrFn is a function, call it only if debug is enabled
    if (typeof metadataOrFn === 'function') {
      try {
        metadata = metadataOrFn();
      } catch (err) {
        metadata = { error: 'Failed to evaluate debug metadata', errorMessage: err.message };
      }
    }

    winstonLogger.debug(message, {
      ...context,
      ...metadata,
    });
  },

  /**
   * Log WARN level message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  warn: (message, metadata = {}) => {
    const context = getContext();
    winstonLogger.warn(message, {
      ...context,
      ...metadata,
    });
  },

  /**
   * Log ERROR level message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata (error object, stack, etc.)
   */
  error: (message, metadata = {}) => {
    const context = getContext();
    
    // Extract error information if error object is provided
    let errorMetadata = { ...metadata };
    if (metadata.error && metadata.error instanceof Error) {
      errorMetadata = {
        ...errorMetadata,
        error: {
          message: metadata.error.message,
          name: metadata.error.name,
          stack: metadata.error.stack,
          ...(metadata.error.code && { code: metadata.error.code }),
        },
      };
    } else if (metadata instanceof Error) {
      errorMetadata = {
        error: {
          message: metadata.message,
          name: metadata.name,
          stack: metadata.stack,
          ...(metadata.code && { code: metadata.code }),
        },
      };
    }

    winstonLogger.error(message, {
      ...context,
      ...errorMetadata,
    });
  },

  /**
   * Log CRITICAL level message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  critical: (message, metadata = {}) => {
    const context = getContext();
    winstonLogger.error(message, {
      ...context,
      ...metadata,
      level: 'critical', // Override level for critical
    });
  },

  /**
   * Create a child logger with additional context
   * @param {Object} additionalContext - Additional context
   * @returns {Object} - Child logger
   */
  child: createChildLogger,

  /**
   * Run function with context
   * @param {Object} context - Context object
   * @param {Function} fn - Function to run
   */
  withContext: runWithContext,

  /**
   * Update log level dynamically
   */
  updateLevel: updateLogLevel,

  /**
   * Check if debug is enabled
   * @returns {boolean}
   */
  isDebugEnabled,
};

// Update log level periodically (every 5 seconds) to pick up database changes
// Skip in test environment to avoid teardown issues
if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test' && typeof jest === 'undefined') {
  const updateTimer = setInterval(() => {
    try {
      updateLogLevel();
    } catch (err) {
      // Silently fail - don't log errors about log level updates
    }
  }, 5000);
  
  // Store timer reference for cleanup if needed
  if (typeof global !== 'undefined') {
    global.__loggerUpdateTimer = updateTimer;
  }
}

module.exports = logger;
module.exports.getContext = getContext;
module.exports.runWithContext = runWithContext;
