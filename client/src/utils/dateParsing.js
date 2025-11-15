/**
 * Date parsing utilities
 * Handles various date string formats from the API
 */

/**
 * SQLite datetime format regex pattern
 */
const SQLITE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/;

/**
 * Parse a date string from SQLite or API format
 * SQLite returns dates in format "YYYY-MM-DD HH:MM:SS" (no timezone)
 * Since the database uses CURRENT_TIMESTAMP which is UTC, we parse as UTC
 * @param {string|Date} dateString - Date string from API or Date object
 * @returns {Date} Parsed Date object
 */
export function parseSQLiteDate(dateString) {
  if (!dateString) return null;

  if (dateString instanceof Date) {
    return dateString;
  }

  if (typeof dateString === "string") {
    // Check if it's a SQLite datetime format (YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS)
    if (SQLITE_DATETIME_PATTERN.test(dateString)) {
      // SQLite datetime without timezone - assume UTC and add 'Z'
      return new Date(dateString.replace(" ", "T") + "Z");
    }

    // ISO string without timezone - assume UTC
    if (
      dateString.includes("T") &&
      !dateString.includes("Z") &&
      !dateString.match(/[+-]\d{2}:\d{2}$/)
    ) {
      return new Date(dateString + "Z");
    }

    // Already has timezone info or is in a different format
    return new Date(dateString);
  }

  return new Date(dateString);
}
