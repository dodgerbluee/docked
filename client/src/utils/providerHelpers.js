/**
 * Provider Helper Utilities
 * Shared utilities for working with repository providers (GitHub, GitLab)
 */

import GitHubIcon from "../components/icons/GitHubIcon";
import GitLabIcon from "../components/icons/GitLabIcon";

/**
 * Get the icon component for a provider
 * @param {string} provider - Provider name ('github' or 'gitlab')
 * @returns {React.ComponentType} Icon component
 */
export function getProviderIcon(provider) {
  return provider === "github" ? GitHubIcon : GitLabIcon;
}

/**
 * Get the display label for a provider
 * @param {string} provider - Provider name ('github' or 'gitlab')
 * @returns {string} Display label
 */
export function getProviderLabel(provider) {
  return provider === "github" ? "GitHub" : "GitLab";
}

/**
 * Check if a provider is valid
 * @param {string} provider - Provider name to validate
 * @returns {boolean} True if valid
 */
export function isValidProvider(provider) {
  return provider === "github" || provider === "gitlab";
}
