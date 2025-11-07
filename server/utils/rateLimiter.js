/**
 * Rate limiting utilities for external API calls
 */

let lastDockerHubRequest = 0;

/**
 * Delays requests to avoid rate limiting
 * @param {number} delayMs - Minimum delay in milliseconds
 * @returns {Promise<void>}
 */
async function rateLimitDelay(delayMs = 200) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastDockerHubRequest;
  if (timeSinceLastRequest < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs - timeSinceLastRequest));
  }
  lastDockerHubRequest = Date.now();
}

module.exports = {
  rateLimitDelay,
};

