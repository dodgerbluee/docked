/**
 * Utility functions for filtering tracked apps
 */

/**
 * Get list of tracked GitHub repositories
 * @param {Array} trackedImages - Array of tracked images
 * @returns {Array} Array of GitHub repository strings
 */
export function getTrackedGitHubRepos(trackedImages) {
  return trackedImages
    .filter((img) => img.source_type === "github" && img.github_repo)
    .map((img) => img.github_repo);
}

/**
 * Get list of tracked Docker images (without tags)
 * @param {Array} trackedImages - Array of tracked images
 * @returns {Array} Array of Docker image names (without tags)
 */
export function getTrackedDockerImages(trackedImages) {
  return trackedImages
    .filter((img) => img.source_type === "docker" && img.image_name)
    .map((img) => img.image_name.split(":")[0]); // Remove tag for comparison
}

/**
 * Filter out already tracked items from predefined lists
 * @param {Array} predefinedList - List of predefined items
 * @param {Array} trackedItems - List of already tracked items
 * @returns {Array} Filtered list of available items
 */
export function filterTrackedItems(predefinedList, trackedItems) {
  return predefinedList.filter((item) => !trackedItems.includes(item));
}

