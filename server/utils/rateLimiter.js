/**
 * Rate limiting utilities for external API calls
 */

// Store last request time in a single object to avoid race conditions
let requestState = { lastDockerHubRequest: 0 };

// Track consecutive rate limit errors
let consecutiveRateLimitErrors = 0;
let lastRateLimitErrorTime = 0;
const RATE_LIMIT_ERROR_THRESHOLD = 5; // Stop after 5 consecutive 429 errors
const RATE_LIMIT_ERROR_WINDOW = 60000; // Reset counter after 1 minute of no errors

/**
 * Delays requests to avoid rate limiting
 * @param {number} delayMs - Minimum delay in milliseconds
 * @returns {Promise<void>}
 */
async function rateLimitDelay(delayMs = 200) {
  const now = Date.now();
  // Read state atomically by storing reference
  const currentState = requestState;
  const timeSinceLastRequest = now - currentState.lastDockerHubRequest;
  if (timeSinceLastRequest < delayMs) {
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, delayMs - timeSinceLastRequest);
    });
  }
  // Atomic update: assign entire state object at once
  // eslint-disable-next-line require-atomic-updates -- Rate limit state update is intentional
  requestState = { lastDockerHubRequest: Date.now() };
}

/**
 * Record a rate limit error (429)
 * @returns {boolean} - True if threshold exceeded, false otherwise
 */
function recordRateLimitError() {
  const now = Date.now();

  // Reset counter if enough time has passed since last error
  if (now - lastRateLimitErrorTime > RATE_LIMIT_ERROR_WINDOW) {
    consecutiveRateLimitErrors = 0;
  }

  consecutiveRateLimitErrors++;
  lastRateLimitErrorTime = now;

  if (consecutiveRateLimitErrors >= RATE_LIMIT_ERROR_THRESHOLD) {
    return true; // Threshold exceeded
  }

  return false;
}

/**
 * Record a successful request (resets rate limit error counter)
 */
function recordSuccess() {
  consecutiveRateLimitErrors = 0;
}

/**
 * Get current rate limit error count
 * @returns {number}
 */
function getRateLimitErrorCount() {
  const now = Date.now();
  // Reset if window expired
  if (now - lastRateLimitErrorTime > RATE_LIMIT_ERROR_WINDOW) {
    consecutiveRateLimitErrors = 0;
  }
  return consecutiveRateLimitErrors;
}

/**
 * Reset rate limit error tracking
 */
function resetRateLimitErrors() {
  consecutiveRateLimitErrors = 0;
  lastRateLimitErrorTime = 0;
}

module.exports = {
  rateLimitDelay,
  recordRateLimitError,
  recordSuccess,
  getRateLimitErrorCount,
  resetRateLimitErrors,
};
