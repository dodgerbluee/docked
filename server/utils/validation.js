/**
 * Input validation utilities
 */

/**
 * Validates that required fields are present in request body.
 * Uses strict null/undefined checks so that falsy values like 0, false,
 * and '' are accepted as valid.
 * @param {Object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @returns {Object|null} - Standardized error object if validation fails, null otherwise
 */
function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter(
    (field) => body[field] === undefined || body[field] === null
  );
  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing required fields: ${missing.join(", ")}`,
      missingFields: missing,
    };
  }
  return null;
}

/**
 * Check if string contains path traversal patterns
 * @param {string} str - String to check
 * @returns {boolean} - True if contains traversal patterns
 */
function containsPathTraversal(str) {
  return (
    str.includes("..") ||
    str.includes("/") ||
    str.includes("\\") ||
    str.includes("%2e") ||
    str.includes("%2f") ||
    str.includes("%5c")
  );
}

/**
 * Check if string is valid alphanumeric with allowed characters
 * @param {string} str - String to check
 * @returns {boolean} - True if valid
 */
function isValidAlphanumeric(str) {
  return /^[a-zA-Z0-9_-]+$/.test(str);
}

/**
 * Validates and sanitizes a path component to prevent path traversal attacks
 * @param {string|number} pathComponent - Path component to validate
 * @returns {Object} - { valid: boolean, sanitized?: string, error?: string }
 */
function validatePathComponent(pathComponent) {
  if (pathComponent === undefined || pathComponent === null) {
    return {
      valid: false,
      error: "Path component cannot be null or undefined",
    };
  }

  const str = String(pathComponent);

  if (
    containsPathTraversal(str) ||
    str.trim() !== str ||
    str.length === 0 ||
    !isValidAlphanumeric(str)
  ) {
    return {
      valid: false,
      error: "Path component contains invalid characters",
    };
  }

  return {
    valid: true,
    sanitized: str,
  };
}

/**
 * Validates email format using a ReDoS-safe regex pattern
 * Uses a more specific pattern to avoid catastrophic backtracking
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if email format is valid
 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") {
    return false;
  }

  // ReDoS-safe email validation pattern
  // Uses specific character classes instead of negated character classes with quantifiers
  // This avoids catastrophic backtracking that can occur with [^\s@]+ patterns
  // Pattern breakdown:
  // - Local part: [a-zA-Z0-9._%+-]+ (alphanumeric and common email characters)
  // - @ symbol
  // - Domain: [a-zA-Z0-9.-]+ (alphanumeric, dots, hyphens)
  // - TLD: \.[a-zA-Z]{2,} (at least 2 letters)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  // Additional length check to prevent extremely long inputs
  if (email.length > 254) {
    return false;
  }

  return emailRegex.test(email);
}

module.exports = {
  validateRequiredFields,
  validatePathComponent,
  isValidEmail,
};
