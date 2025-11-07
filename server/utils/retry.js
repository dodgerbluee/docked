/**
 * Retry utility with exponential backoff
 */

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
      return await fn();
    } catch (error) {
      // If it's a 429 (rate limit) and we have retries left, wait and retry
      if (error.response?.status === 429 && attempt < maxRetries - 1) {
        // For 429 errors, use longer delays: 5s, 10s, 20s
        const delay = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
        console.log(
          `⚠️  Rate limited (429) by Docker Hub, waiting ${delay / 1000}s before retry (attempt ${
            attempt + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
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
};

