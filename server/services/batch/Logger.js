/**
 * Structured Logger for Batch System
 * Provides consistent, structured logging with timestamps, batch type, and log levels
 */

// Get log level from environment or default to 'info'
// This can be overridden by setting LOG_LEVEL env var or via API
function getLogLevel() {
  // Check environment variable first
  if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'info') {
    return process.env.LOG_LEVEL;
  }
  // Default to 'info' for production-like behavior
  return 'info';
}

// Cache log level (can be updated via API)
let cachedLogLevel = getLogLevel();

/**
 * Set log level (called from API)
 * @param {string} level - 'info' or 'debug'
 */
function setLogLevel(level) {
  if (level === 'info' || level === 'debug') {
    cachedLogLevel = level;
  }
}

/**
 * Get current log level
 * @returns {string} - 'info' or 'debug'
 */
function getCurrentLogLevel() {
  return cachedLogLevel;
}

class BatchLogger {
  constructor(jobType = 'system') {
    this.jobType = jobType;
    this.logs = [];
  }

  /**
   * Check if a log level should be output
   * @param {string} level - Log level to check
   * @returns {boolean} - True if should output
   */
  shouldLog(level) {
    const currentLevel = getCurrentLogLevel();
    
    // Always log errors and warnings
    if (level === 'error' || level === 'warn') {
      return true;
    }
    
    // In debug mode, log everything
    if (currentLevel === 'debug') {
      return true;
    }
    
    // In info mode, only log info and above (not debug)
    return level === 'info';
  }

  /**
   * Log a message with a specific level
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata to include
   */
  log(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      jobType: this.jobType,
      message,
      ...metadata,
    };

    // Store in memory for batch run logs
    this.logs.push(logEntry);

    // Only output to console if log level allows
    if (!this.shouldLog(level)) {
      return logEntry;
    }

    // Output to console with structured format
    const consoleMessage = `[${timestamp}] [${level.toUpperCase()}] [${this.jobType}] ${message}`;
    
    switch (level) {
      case 'error':
        console.error(consoleMessage, metadata);
        break;
      case 'warn':
        console.warn(consoleMessage, metadata);
        break;
      case 'debug':
        console.debug(consoleMessage, metadata);
        break;
      default:
        console.log(consoleMessage, metadata);
    }

    return logEntry;
  }

  /**
   * Log info message
   */
  info(message, metadata) {
    return this.log('info', message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message, metadata) {
    return this.log('warn', message, metadata);
  }

  /**
   * Log error message
   */
  error(message, metadata) {
    return this.log('error', message, metadata);
  }

  /**
   * Log debug message (only if DEBUG env var is set)
   */
  debug(message, metadata) {
    return this.log('debug', message, metadata);
  }

  /**
   * Get all logs as formatted string
   * @returns {string} - Formatted log string
   */
  getFormattedLogs() {
    return this.logs
      .map(entry => {
        const metaStr = Object.keys(entry)
          .filter(key => !['timestamp', 'level', 'jobType', 'message'].includes(key))
          .map(key => `${key}=${JSON.stringify(entry[key])}`)
          .join(' ');
        return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.jobType}] ${entry.message}${metaStr ? ' ' + metaStr : ''}`;
      })
      .join('\n');
  }

  /**
   * Get all logs as array
   * @returns {Array<Object>} - Array of log entries
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clear() {
    this.logs = [];
  }
}

module.exports = BatchLogger;
module.exports.setLogLevel = setLogLevel;
module.exports.getLogLevel = getCurrentLogLevel;

