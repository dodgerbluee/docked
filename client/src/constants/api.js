// API configuration constants
export const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

// Repository constants
export const GITHUB_REPO = "https://github.com/dodgerbluee/docked";

