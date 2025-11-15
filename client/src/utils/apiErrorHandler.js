/**
 * Shared API error handling utilities
 * Provides consistent error handling patterns across the application
 */

/**
 * Checks if an error is a Docker Hub rate limit error
 * @param {Error} err - The error object to check
 * @returns {boolean} True if the error is a rate limit error
 */
export const isRateLimitError = (err) => {
  return (
    err.response?.status === 429 ||
    err.response?.data?.rateLimitExceeded === true ||
    err.message?.toLowerCase().includes("rate limit") ||
    err.isRateLimitExceeded === true
  );
};

/**
 * Gets an appropriate error message for Docker Hub rate limit errors
 * @param {Error} err - The error object
 * @param {boolean} hasCredentials - Whether Docker Hub credentials are configured
 * @returns {string} The error message
 */
export const getRateLimitErrorMessage = (err, hasCredentials = false) => {
  if (hasCredentials) {
    return "Docker Hub rate limit exceeded. Please wait a few minutes before trying again.";
  }
  return "Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.";
};

/**
 * Extracts a user-friendly error message from an error object
 * @param {Error} err - The error object
 * @param {string} defaultMessage - Default message if no specific error is found
 * @returns {string} The error message
 */
export const extractErrorMessage = (err, defaultMessage = "An error occurred") => {
  return err.response?.data?.error || err.response?.data?.message || err.message || defaultMessage;
};

/**
 * Handles Docker Hub API errors with consistent messaging
 * @param {Error} err - The error object
 * @param {Function} fetchDockerHubCredentials - Function to fetch Docker Hub credentials
 * @param {Object} dockerHubCredentials - Current Docker Hub credentials (if available)
 * @param {Function} setError - Function to set the error state
 * @returns {string} The error message that was set
 */
export const handleDockerHubError = async (
  err,
  fetchDockerHubCredentials,
  dockerHubCredentials,
  setError
) => {
  let errorMessage = "Failed to pull container data";

  if (isRateLimitError(err)) {
    // Try to fetch current credentials to determine the message
    const currentCreds = fetchDockerHubCredentials
      ? await fetchDockerHubCredentials().catch(() => null)
      : null;
    const hasCredentials = currentCreds || dockerHubCredentials;
    errorMessage = getRateLimitErrorMessage(err, hasCredentials);
  } else {
    errorMessage = extractErrorMessage(err, "Failed to pull container data");
  }

  if (setError) {
    setError(errorMessage);
  }

  return errorMessage;
};
