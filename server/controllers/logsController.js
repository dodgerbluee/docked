/**
 * Logs Controller
 * Handles HTTP requests for application logs
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// Use the same logs directory path as logger.js
const logsDir = process.env.LOGS_DIR || path.join(__dirname, "../../logs");

/**
 * Get application logs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getLogsHandler(req, res, next) {
  try {
    const lines = parseInt(req.query.lines) || 500; // Default to last 500 lines
    const since = parseInt(req.query.since); // Line count to fetch after (for incremental updates)
    const logFile = req.query.file || "combined.log"; // Default to combined.log (Winston's combined log)

    const logFilePath = path.join(logsDir, logFile);

    // Check if logs directory exists
    if (!fs.existsSync(logsDir)) {
      return res.json({
        success: true,
        logs: `Logs directory not found: ${logsDir}\n\nLogs will appear here once the application starts generating log entries.`,
        totalLines: 0,
        returnedLines: 0,
        newLines: 0,
      });
    }

    // Check if log file exists
    if (!fs.existsSync(logFilePath)) {
      return res.json({
        success: true,
        logs: `Log file ${logFile} not found in ${logsDir}.\n\nLogs will appear here once the application starts generating log entries.`,
        totalLines: 0,
        returnedLines: 0,
        newLines: 0,
      });
    }

    // Read the log file
    let fileContent;
    try {
      fileContent = fs.readFileSync(logFilePath, "utf8");
    } catch (readError) {
      logger.error("Error reading log file:", readError);
      return res.status(500).json({
        success: false,
        error: `Failed to read log file: ${readError.message}`,
      });
    }

    const allLines = fileContent.split("\n");
    const totalLines = allLines.length;

    let recentLines;
    let returnedLines;
    let newLines = 0;

    if (since !== undefined && since >= 0) {
      // Incremental fetch: only get lines after the 'since' count
      if (since >= totalLines) {
        // No new lines
        recentLines = "";
        returnedLines = 0;
        newLines = 0;
      } else {
        // Get lines after 'since'
        const newLinesArray = allLines.slice(since);
        recentLines = newLinesArray.join("\n");
        returnedLines = newLinesArray.length;
        newLines = returnedLines;
      }
    } else {
      // Full fetch: get the last N lines
      recentLines = allLines.slice(-lines).join("\n");
      returnedLines = recentLines.split("\n").length;
      newLines = returnedLines;
    }

    res.json({
      success: true,
      logs: recentLines,
      totalLines: totalLines,
      returnedLines: returnedLines,
      newLines: newLines,
    });
  } catch (error) {
    logger.error("Error fetching logs:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch logs",
    });
  }
}

module.exports = {
  getLogsHandler,
};
