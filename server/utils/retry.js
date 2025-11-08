/**
 * Retry utility with exponential backoff
 */

const { recordRateLimitError, recordSuccess } = require('./rateLimiter');

/**
 * Custom error for rate limit threshold exceeded
 */
class RateLimitExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.isRateLimitExceeded = true;
  }
}

/**
 * Retries a function with exponential backoff
 * @param {Function} fn - Function to retry (should return a Promise)
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fn();
      // Record success to reset rate limit counter
      recordSuccess();
      return result;
    } catch (error) {
      // If it's a 429 (rate limit)
      if (error.response?.status === 429) {
        // Record the rate limit error
        const thresholdExceeded = recordRateLimitError();
        
        if (thresholdExceeded) {
          // Threshold exceeded - stop retrying and throw special error
          throw new RateLimitExceededError(
            'Docker Hub rate limit exceeded. Too many consecutive rate limit errors. ' +
            'Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.'
          );
        }
        
        // If we have retries left, wait and retry
        if (attempt < maxRetries - 1) {
          // For 429 errors, use longer delays: 5s, 10s, 20s
          const delay = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
          // Only log first few errors to avoid spam
          if (attempt < 2) {
            console.warn(
              `⚠️  Rate limited (429) by Docker Hub, waiting ${delay / 1000}s before retry (attempt ${
                attempt + 1
              }/${maxRetries})`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // For other errors, use standard exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

module.exports = {
  retryWithBackoff,
  RateLimitExceededError,
};

