/**
 * Application Constants
 * Centralized constants to avoid magic numbers and strings
 */

module.exports = {
  CACHE: {
    DIGEST_TTL: 24 * 60 * 60 * 1000, // 24 hours
    QUERY_RESULT_TTL: 5 * 60 * 1000, // 5 minutes
    AUTH_TOKEN_TTL: 60 * 60 * 1000, // 1 hour
    IP_ADDRESS_TTL: 24 * 60 * 60 * 1000, // 24 hours
  },

  RATE_LIMITS: {
    DOCKER_HUB_DELAY: 1000, // ms - anonymous rate limit delay
    DOCKER_HUB_AUTHENTICATED_DELAY: 500, // ms - authenticated rate limit delay
    API_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    API_MAX_REQUESTS: 100,
    AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    AUTH_MAX_ATTEMPTS: 20,
  },

  DATABASE: {
    MAX_CONNECTION_ATTEMPTS: 1,
    OPERATION_QUEUE_TIMEOUT: 30000, // 30 seconds
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY: 1000, // 1 second
  },

  CONTAINER: {
    MAX_UPGRADE_CONCURRENCY: 3,
    UPGRADE_TIMEOUT: 5 * 60 * 1000, // 5 minutes
    MIN_CONTAINER_ID_LENGTH: 12,
  },

  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 100,
  },

  JWT: {
    DEFAULT_EXPIRES_IN: "24h",
    DEFAULT_REFRESH_EXPIRES_IN: "7d",
  },

  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
  },

  ERROR_CODES: {
    VALIDATION_ERROR: "VALIDATION_ERROR",
    NOT_FOUND: "NOT_FOUND",
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    CONFLICT: "CONFLICT",
    INTERNAL_ERROR: "INTERNAL_ERROR",
    RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  },
};

