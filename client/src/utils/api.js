/**
 * API Configuration
 * Centralized API base URL configuration
 */

export const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
