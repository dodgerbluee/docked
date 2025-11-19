/**
 * Error handling utilities for container operations
 */

/**
 * Format error message from API response
 * @param {Error} err - Error object
 * @returns {string} Formatted error message
 */
export const formatContainerError = (err) => {
  return err.response?.data?.error || err.message || "Unknown error occurred";
};

/**
 * Show error alert for container operation
 * @param {string} operation - Operation name (e.g., "upgrade", "delete")
 * @param {string} containerName - Container name
 * @param {Error} err - Error object
 */
export const showContainerError = (operation, containerName, err) => {
  const errorMessage = formatContainerError(err);
  alert(`Failed to ${operation} ${containerName}: ${errorMessage}`);
  console.error(`Error ${operation} container:`, err);
};

/**
 * Show success alert for container upgrade
 * @param {string} containerName - Container name
 * @param {string} oldImage - Old image name
 * @param {string} newImage - New image name
 */
export const showUpgradeSuccess = (containerName, oldImage, newImage) => {
  alert(
    `Container ${containerName} upgraded successfully!\n` +
      `From: ${oldImage}\n` +
      `To: ${newImage}`
  );
};

/**
 * Format batch upgrade message
 * @param {number} successCount - Number of successful upgrades
 * @param {number} errorCount - Number of failed upgrades
 * @param {Array} errors - Array of error objects
 * @returns {string} Formatted message
 */
export const formatBatchUpgradeMessage = (successCount, errorCount, errors) => {
  let message = `Batch upgrade completed!\n`;
  message += `✓ Successfully upgraded: ${successCount}\n`;
  if (errorCount > 0) {
    message += `✗ Failed: ${errorCount}\n\n`;
    message += `Errors:\n`;
    errors.forEach((err) => {
      message += `- ${err.containerName}: ${err.error}\n`;
    });
  }
  return message;
};

