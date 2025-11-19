/**
 * Utility functions for formatting batch run data
 */

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 30m 15s")
 */
export const formatDuration = (ms) => {
  if (!ms && ms !== 0) return "N/A";
  // Handle negative durations (shouldn't happen with fix, but handle gracefully)
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  let result = "";
  if (hours > 0) {
    result = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    result = `${minutes}m ${seconds % 60}s`;
  } else {
    result = `${seconds}s`;
  }

  // Add negative sign if duration is negative (indicates calculation error)
  return ms < 0 ? `-${result}` : result;
};

/**
 * Format date string to America/Chicago timezone
 * @param {string} dateString - Date string from database
 * @returns {string} Formatted date string
 */
export const formatDate = (dateString) => {
  if (!dateString) return "N/A";
  // SQLite DATETIME returns strings in format "YYYY-MM-DD HH:MM:SS" (no timezone
  // Since the database uses CURRENT_TIMESTAMP which is UTC, we need to parse it as UTC
  let date;
  if (typeof dateString === "string") {
    // Check if it's a SQLite datetime format (YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS)
    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(dateString)) {
      // SQLite datetime without timezone - assume UTC and add 'Z'
      date = new Date(dateString.replace(" ", "T") + "Z");
    } else if (
      dateString.includes("T") &&
      !dateString.includes("Z") &&
      !dateString.match(/[+-]\d{2}:\d{2}$/)
    ) {
      // ISO string without timezone - assume UTC
      date = new Date(dateString + "Z");
    } else {
      // Already has timezone info or is in a different format
      date = new Date(dateString);
    }
  } else {
    date = new Date(dateString);
  }

  // Format in America/Chicago timezone
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  });
};

/**
 * Format next run date to America/Chicago timezone
 * @param {Date} nextRunDate - Date object for next run
 * @returns {string} Formatted date string
 */
export const formatNextRun = (nextRunDate) => {
  if (!nextRunDate) return "N/A";
  return nextRunDate.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  });
};

/**
 * Format interval minutes to human-readable string
 * @param {number} intervalMinutes - Interval in minutes
 * @returns {string} Formatted interval (e.g., "1 hour", "30 minutes", "2.5 hours")
 */
export const formatInterval = (intervalMinutes) => {
  if (!intervalMinutes) return "N/A";
  if (intervalMinutes === 60) {
    return "1 hour";
  } else if (intervalMinutes < 60) {
    return `${intervalMinutes} minutes`;
  } else {
    const hours = intervalMinutes / 60;
    return hours % 1 === 0 ? `${hours} hours` : `${hours.toFixed(1)} hours`;
  }
};
