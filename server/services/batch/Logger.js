/**
 * Batch Logger Wrapper
 * Wraps the centralized logger for batch system with in-memory log storage
 * Provides backward compatibility with existing batch system code
 */

const logger = require("../../utils/logger");

class BatchLogger {
  constructor(jobType = "system", jobId = null) {
    this.jobType = jobType;
    this.jobId = jobId;
    this.logs = [];
    this.module = "batch";
  }

  /**
   * Create a child logger with batch context
   * @param {Object} metadata - Additional metadata
   * @returns {Object} - Logger with context
   */
  _getLoggerWithContext(metadata = {}) {
    const context = {
      module: this.module,
      service: "batch",
      jobType: this.jobType,
      jobId: this.jobId,
      ...metadata,
    };
    return logger.child(context);
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
      jobId: this.jobId,
      message,
      ...metadata,
    };

    // Store in memory for batch run logs
    this.logs.push(logEntry);

    // Use centralized logger with context
    const childLogger = this._getLoggerWithContext(metadata);
    childLogger[level](message, {
      operation: metadata.operation || "batch-job",
      ...metadata,
    });

    return logEntry;
  }

  /**
   * Log info message
   */
  info(message, metadata = {}) {
    return this.log("info", message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message, metadata = {}) {
    return this.log("warn", message, metadata);
  }

  /**
   * Log error message
   */
  error(message, metadata = {}) {
    return this.log("error", message, metadata);
  }

  /**
   * Log debug message (performance-safe, only evaluates if debug enabled)
   */
  debug(message, metadataOrFn = {}) {
    // Support lazy evaluation for performance
    if (typeof metadataOrFn === "function") {
      return this.log("debug", message, () => ({
        operation: "batch-job",
        ...metadataOrFn(),
      }));
    }
    return this.log("debug", message, metadataOrFn);
  }

  /**
   * Get all logs as formatted string
   * @returns {string} - Formatted log string
   */
  getFormattedLogs() {
    return this.logs
      .map((entry) => {
        const metaStr = Object.keys(entry)
          .filter((key) => !["timestamp", "level", "jobType", "jobId", "message"].includes(key))
          .map((key) => `${key}=${JSON.stringify(entry[key])}`)
          .join(" ");
        const jobIdStr = entry.jobId ? ` [job:${entry.jobId}]` : "";
        return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.jobType}]${jobIdStr} ${entry.message}${metaStr ? ` ${metaStr}` : ""}`;
      })
      .join("\n");
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

// Backward compatibility exports
module.exports = BatchLogger;
// Note: setLogLevel and getLogLevel are now handled by the centralized logger
// These are kept for backward compatibility but delegate to the centralized logger
module.exports.setLogLevel = (_level) => {
  logger.updateLevel();
};
module.exports.getLogLevel = () => (logger.isDebugEnabled() ? "debug" : "info");
