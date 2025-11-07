/**
 * Application configuration
 * Centralizes all environment variables and configuration settings
 */

require("dotenv").config();

const config = {
  port: process.env.PORT || 3001,
  portainer: {
    urls: (
      process.env.PORTAINER_URL ||
      process.env.PORTAINER_URLS ||
      "http://localhost:9000"
    )
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0),
    username: process.env.PORTAINER_USERNAME || "admin",
    password: process.env.PORTAINER_PASSWORD
      ? String(process.env.PORTAINER_PASSWORD)
      : "",
  },
  cache: {
    digestCacheTTL: 24 * 60 * 60 * 1000, // 24 hours
  },
  rateLimit: {
    // Increased delay to avoid 429 errors
    // Anonymous: 100 pulls/6hr, Authenticated: 200 pulls/6hr
    // Use longer delay if not authenticated to avoid hitting limits
    // Note: Docker Hub credentials are now managed through the Settings UI.
    // The delay is dynamically adjusted in dockerRegistryService based on actual credentials availability
    dockerHubDelay: 1000, // Default delay for anonymous (authenticated uses 500ms)
  },
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
  },
};

module.exports = config;
