/**
 * Logs Controller
 * Handles HTTP requests for application logs
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// Use the same logs directory path as logger.js
const logsDir = process.env.LOGS_DIR || path.join(__dirname, "../../logs");

const TAIL_CHUNK_SIZE = 64 * 1024; // 64 KB chunks for tail reading

/**
 * Read the last N lines from a file without loading the whole file into memory.
 * Works by reading 64KB chunks backwards from the end until enough lines are found.
 *
 * @param {string} filePath - Absolute path to the log file
 * @param {number} maxLines - Maximum number of lines to return
 * @returns {{ lines: string[], fileSize: number }}
 */
function tailFile(filePath, maxLines) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) {
    return { lines: [], fileSize: 0 };
  }

  const fd = fs.openSync(filePath, "r");
  try {
    let lines = [];
    let position = fileSize;
    let leftover = "";

    while (lines.length < maxLines + 1 && position > 0) {
      const readSize = Math.min(TAIL_CHUNK_SIZE, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, position);
      // Prepend chunk to leftover so we handle lines split across chunk boundaries
      const combined = buf.toString("utf8") + leftover;
      const parts = combined.split("\n");
      // parts[0] may be an incomplete line — save for next iteration
      leftover = parts.shift();
      lines = [...parts, ...lines];
    }

    // Prepend whatever remains at the very start of the file
    if (leftover) lines.unshift(leftover);

    return { lines: lines.slice(-maxLines), fileSize };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read new content from a file starting at a given byte offset.
 * Used for incremental log streaming — only reads bytes added since last fetch.
 *
 * @param {string} filePath - Absolute path to the log file
 * @param {number} offset - Byte offset to start reading from
 * @returns {{ content: string, fileSize: number }}
 */
function readFromOffset(filePath, offset) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (offset >= fileSize) {
    return { content: "", fileSize };
  }

  const readSize = fileSize - offset;
  const buf = Buffer.alloc(readSize);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buf, 0, readSize, offset);
  } finally {
    fs.closeSync(fd);
  }

  return { content: buf.toString("utf8"), fileSize };
}

/**
 * Get application logs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function getLogsHandler(req, res, _next) {
  try {
    const lines = parseInt(req.query.lines, 10) || 500;
    const offset = req.query.offset !== undefined ? parseInt(req.query.offset, 10) : null;
    const logFile = req.query.file || "combined.log";

    // Security: validate log file path to prevent path traversal
    const resolvedLogsDir = path.resolve(logsDir);
    const logFilePath = path.resolve(logsDir, logFile);
    if (!logFilePath.startsWith(resolvedLogsDir + path.sep) && logFilePath !== resolvedLogsDir) {
      logger.warn(`[logs] Path traversal attempt blocked: ${logFile}`);
      return res.status(400).json({ success: false, error: "Invalid log file path" });
    }

    if (!fs.existsSync(logsDir)) {
      return res.json({
        success: true,
        logs: `Logs directory not found: ${logsDir}\n\nLogs will appear here once the application starts generating log entries.`,
        fileSize: 0,
        returnedLines: 0,
      });
    }

    if (!fs.existsSync(logFilePath)) {
      return res.json({
        success: true,
        logs: `Log file ${logFile} not found in ${logsDir}.\n\nLogs will appear here once the application starts generating log entries.`,
        fileSize: 0,
        returnedLines: 0,
      });
    }

    // Incremental fetch: only return new bytes since `offset`
    if (offset !== null && !isNaN(offset) && offset >= 0) {
      const stat = fs.statSync(logFilePath);
      const currentSize = stat.size;

      // Log was rotated (file is smaller than our offset) — signal client to reload
      if (offset > currentSize) {
        return res.json({
          success: true,
          logs: "",
          fileSize: currentSize,
          returnedLines: 0,
          rotated: true,
        });
      }

      const { content, fileSize } = readFromOffset(logFilePath, offset);
      const newLines = content ? content.split("\n").filter((l) => l.trim()).length : 0;

      return res.json({
        success: true,
        logs: content,
        fileSize,
        returnedLines: newLines,
      });
    }

    // Full tail fetch: efficiently read last N lines without loading the whole file
    const { lines: tailedLines, fileSize } = tailFile(logFilePath, lines);
    const logsText = tailedLines.join("\n");

    return res.json({
      success: true,
      logs: logsText,
      fileSize,
      returnedLines: tailedLines.length,
    });
  } catch (error) {
    logger.error("Error fetching logs:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch logs",
    });
  }
}

module.exports = {
  getLogsHandler,
};
