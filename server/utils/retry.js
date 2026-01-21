/**
 * Retry utility with exponential backoff
 */

const { recordRateLimitError, recordSuccess } = require("./rateLimiter");
const logger = require("./logger");

/**
 * Custom error for rate limit threshold exceeded
 */
class RateLimitExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitExceededError";
    this.isRateLimitExceeded = true;
  }
}

/**
 * Create a delay promise
 * @param {number} delayMs - Delay in milliseconds
 * @returns {Promise<void>}
 */
function createDelay(delayMs) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, delayMs);
  });
}

/**
 * Build rate limit error message
 * @param {number|null} userId - Optional user ID
 * @returns {Promise<string>}
 */
async function buildRateLimitMessage(userId) {
  return "Registry rate limit exceeded. Too many consecutive rate limit errors. Please wait a few minutes before trying again. Tip: Run 'docker login' on your server for higher rate limits.";
}

/**
 * Handle rate limit error (429)
 * @param {Error} error - The error object
 * @param {number} attempt - Current attempt number
 * @param {number} maxRetries - Maximum retries
 * @param {number|null} userId - Optional user ID
 * @returns {Promise<never>} - Throws RateLimitExceededError or waits and continues
 */
async function handleRateLimitError(error, attempt, maxRetries, userId) {
  const thresholdExceeded = recordRateLimitError();

  if (thresholdExceeded) {
    const message = await buildRateLimitMessage(userId);
    throw new RateLimitExceededError(message);
  }

  // If we have retries left, wait and retry
  if (attempt < maxRetries - 1) {
    const delay = 5000 * 2 ** attempt; // 5s, 10s, 20s
    if (attempt < 2) {
      logger.warn(
        `⚠️  Rate limited (429) by Docker Hub, waiting ${delay / 1000}s before retry (attempt ${
          attempt + 1
        }/${maxRetries})`
      );
    }
    await createDelay(delay);
  }
}

/**
 * Handle non-rate-limit errors
 * @param {Error} error - The error object
 * @param {number} attempt - Current attempt number
 * @param {number} maxRetries - Maximum retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<void>}
 */
async function handleOtherError(error, attempt, maxRetries, baseDelay) {
  if (attempt < maxRetries - 1) {
    const delay = baseDelay * 2 ** attempt;
    await createDelay(delay);
  } else {
    throw error;
  }
}

/**
 * Retries a function with exponential backoff
 * @param {Function} fn - Function to retry (should return a Promise)
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} userId - Optional user ID to check for Docker Hub credentials
 * @returns {Promise} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000, userId = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (error) {
      if (error.response?.status === 429) {
        await handleRateLimitError(error, attempt, maxRetries, userId);
        continue;
      }
      await handleOtherError(error, attempt, maxRetries, baseDelay);
    }
  }

  // This should never be reached, but satisfies consistent-return
  throw new Error("Retry loop completed without result or error");
}

module.exports = {
  retryWithBackoff,
  RateLimitExceededError,
};
