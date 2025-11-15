/**
 * Utility functions for formatting batch-related data
 */

import { parseSQLiteDate } from "./dateParsing";
import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  DEFAULT_INTERVAL_MINUTES,
} from "../constants/numbers";

const TIMEZONE = "America/Chicago";
const DATE_FORMAT_OPTIONS = {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hour12: true,
};

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export const formatDuration = (ms) => {
  if (!ms && ms !== 0) return "N/A";

  // Handle negative durations (shouldn't happen with fix, but handle gracefully)
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);

  let result = "";
  if (hours > 0) {
    result = `${hours}h ${minutes % MINUTES_PER_HOUR}m ${seconds % SECONDS_PER_MINUTE}s`;
  } else if (minutes > 0) {
    result = `${minutes}m ${seconds % SECONDS_PER_MINUTE}s`;
  } else {
    result = `${seconds}s`;
  }

  // Add negative sign if duration is negative (indicates calculation error)
  return ms < 0 ? `-${result}` : result;
};

/**
 * Format date string to localized string
 * @param {string} dateString - Date string from API
 * @returns {string} Formatted date string
 */
export const formatDate = (dateString) => {
  if (!dateString) return "N/A";

  const date = parseSQLiteDate(dateString);
  if (!date) return "N/A";

  return date.toLocaleString("en-US", DATE_FORMAT_OPTIONS);
};

/**
 * Format next scheduled run date
 * @param {Date} nextRunDate - Next scheduled run date
 * @returns {string} Formatted date string
 */
export const formatNextRun = (nextRunDate) => {
  if (!nextRunDate) return "N/A";

  if (nextRunDate instanceof Date) {
    return nextRunDate.toLocaleString("en-US", DATE_FORMAT_OPTIONS);
  }

  // Handle string dates
  const date = parseSQLiteDate(nextRunDate);
  if (!date) return "N/A";

  return date.toLocaleString("en-US", DATE_FORMAT_OPTIONS);
};

/**
 * Format interval minutes to human-readable string
 * @param {number} intervalMinutes - Interval in minutes
 * @returns {string} Formatted interval string
 */
export const formatInterval = (intervalMinutes) => {
  if (!intervalMinutes) return "N/A";

  if (intervalMinutes === DEFAULT_INTERVAL_MINUTES) {
    return "1 hour";
  } else if (intervalMinutes < MINUTES_PER_HOUR) {
    return `${intervalMinutes} minutes`;
  } else {
    const hours = intervalMinutes / MINUTES_PER_HOUR;
    return hours % 1 === 0 ? `${hours} hours` : `${hours.toFixed(1)} hours`;
  }
};
