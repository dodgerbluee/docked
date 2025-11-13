/**
 * API Configuration and Utilities
 */

// In production, API is served from same origin, so use relative URLs
export const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

