/**
 * Validation utilities for tracked app forms
 */

/**
 * Validate GitHub repository format
 * @param {string} repo - Repository string (owner/repo or URL)
 * @returns {boolean} True if valid
 */
export const isValidGitHubRepo = (repo) => {
  if (!repo || !repo.trim()) return false;
  const trimmed = repo.trim();
  // Match owner/repo format or GitHub URL
  return (
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/]+\/[^/]+(?:\/|$)/i.test(trimmed) ||
    /^[^/]+\/[^/]+$/.test(trimmed)
  );
};

/**
 * Validate GitLab repository format
 * @param {string} repo - Repository string (owner/repo or URL)
 * @returns {boolean} True if valid
 */
export const isValidGitLabRepo = (repo) => {
  if (!repo || !repo.trim()) return false;
  const trimmed = repo.trim();
  // Match owner/repo format or GitLab URL
  return (
    /^(?:https?:\/\/)?(?:www\.)?gitlab\.com\/[^/]+\/[^/]+(?:\/|$)/i.test(trimmed) ||
    /^[^/]+\/[^/]+$/.test(trimmed)
  );
};

/**
 * Validate Docker image name format
 * @param {string} imageName - Docker image name
 * @returns {boolean} True if valid
 */
export const isValidDockerImage = (imageName) => {
  if (!imageName || !imageName.trim()) return false;
  const trimmed = imageName.trim();
  // Basic Docker image format validation
  // Matches: image, repo/image, repo/image:tag, registry.com/repo/image:tag
  return /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)*(:[a-z0-9]([a-z0-9._-]*[a-z0-9])?)?$/i.test(
    trimmed
  );
};

/**
 * Extract display name from repository/image string
 * @param {string} value - Repository or image string
 * @param {string} sourceType - Source type (github, gitlab, docker)
 * @returns {string} Extracted display name
 */
export const extractDisplayName = (value, sourceType) => {
  if (!value) return "";

  if (sourceType === "docker") {
    const imageWithoutTag = value.split(":")[0];
    const parts = imageWithoutTag.split("/");
    const name = parts.length > 1 ? parts[parts.length - 1] : imageWithoutTag;
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  } else {
    // GitHub or GitLab
    const match = value.match(/(?:github\.com|gitlab\.com)\/([^/]+\/([^/]+))(?:\/|$)/i);
    if (match) {
      const name = match[2] || match[1].split("/")[1];
      return name
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    }
    const parts = value.split("/");
    const name = parts.length > 1 ? parts[parts.length - 1] : value;
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }
};

/**
 * Validate form data for submission
 * @param {Object} formData - Form data object
 * @param {string} sourceType - Source type
 * @param {boolean} usePredefined - Whether using predefined option
 * @param {boolean} usePredefinedDocker - Whether using predefined Docker image
 * @param {Object} selectedPredefinedRepo - Selected predefined repo
 * @param {Object} selectedPredefinedImage - Selected predefined image
 * @returns {Object} Validation result with isValid and errors
 */
export const validateForm = (
  formData,
  sourceType,
  usePredefined,
  usePredefinedDocker,
  selectedPredefinedRepo,
  selectedPredefinedImage
) => {
  const errors = {};

  // Name is always required
  if (!formData.name || !formData.name.trim()) {
    errors.name = "Display name is required";
  }

  // Source-specific validation
  if (sourceType === "docker") {
    if (usePredefinedDocker && !selectedPredefinedImage) {
      errors.image = "Please select a Docker image";
    } else if (!usePredefinedDocker && !isValidDockerImage(formData.imageName)) {
      errors.image = "Please enter a valid Docker image name";
    }
  } else if (sourceType === "github") {
    if (usePredefined && !selectedPredefinedRepo) {
      errors.repo = "Please select a repository";
    } else if (!usePredefined && !isValidGitHubRepo(formData.githubRepo)) {
      errors.repo = "Please enter a valid GitHub repository";
    }
  } else if (sourceType === "gitlab") {
    if (!isValidGitLabRepo(formData.githubRepo)) {
      errors.repo = "Please enter a valid GitLab repository";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
