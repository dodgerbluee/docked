/**
 * Validation Utilities
 * Reusable validation functions for forms
 */

/**
 * Validates a username
 * @param {string} username - Username to validate
 * @returns {string|null} - Error message or null if valid
 */
export function validateUsername(username) {
  if (!username || username.trim().length < 3) {
    return "Username must be at least 3 characters long";
  }
  return null;
}

/**
 * Validates a password
 * @param {string} password - Password to validate
 * @param {number} minLength - Minimum password length (default: 8)
 * @returns {string|null} - Error message or null if valid
 */
export function validatePassword(password, minLength = 8) {
  if (!password || password.length < minLength) {
    return `Password must be at least ${minLength} characters long`;
  }
  return null;
}

/**
 * Validates password confirmation matches password
 * @param {string} password - Original password
 * @param {string} confirmPassword - Confirmation password
 * @returns {string|null} - Error message or null if valid
 */
export function validatePasswordMatch(password, confirmPassword) {
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}

/**
 * Validates an email address
 * @param {string} email - Email to validate
 * @param {boolean} required - Whether email is required (default: false)
 * @returns {string|null} - Error message or null if valid
 */
export function validateEmail(email, required = false) {
  if (!email || email.trim() === "") {
    if (required) {
      return "Email is required";
    }
    return null; // Email is optional
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "Invalid email format";
  }
  return null;
}

/**
 * Validates a required field
 * @param {string} value - Value to validate
 * @param {string} fieldName - Name of the field (for error message)
 * @returns {string|null} - Error message or null if valid
 */
export function validateRequired(value, fieldName = "Field") {
  if (!value || value.trim() === "") {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Validates a Discord webhook URL
 * @param {string} url - Webhook URL to validate
 * @returns {string|null} - Error message or null if valid
 */
export function validateDiscordWebhookUrl(url) {
  if (!url || url.trim() === "") {
    return "Webhook URL is required";
  }

  const webhookPattern = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
  if (!webhookPattern.test(url.trim())) {
    return "Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}";
  }
  return null;
}

/**
 * Validates a registration code format
 * @param {string} code - Registration code to validate
 * @returns {string|null} - Error message or null if valid
 */
export function validateRegistrationCode(code) {
  if (!code || code.trim() === "") {
    return "Registration code is required";
  }

  // Remove dashes for validation
  const codeWithoutDashes = code.replace(/-/g, "").trim();
  
  // Check length without dashes (should be 12 characters)
  if (codeWithoutDashes.length !== 12) {
    return "Registration code must be 12 characters";
  }

  // Only check format pattern if code is complete (14 characters with dashes)
  // This prevents validation errors while user is still typing
  // Pattern allows: A-Z, 0-9, and special characters: !@#$%&*+=?
  // Excludes dashes (-) as they are formatting only
  if (code.includes("-") && code.trim().length === 14) {
    const codePattern = /^[A-Z0-9!@#$%&*+=?]{4}-[A-Z0-9!@#$%&*+=?]{4}-[A-Z0-9!@#$%&*+=?]{4}$/;
    if (!codePattern.test(code.trim())) {
      return "Invalid registration code format";
    }
  } else if (!code.includes("-")) {
    // If no dashes, check that it's valid characters and 12 characters
    // Allows same characters as generation: A-Z, 0-9, !@#$%&*+=?
    const validPattern = /^[A-Z0-9!@#$%&*+=?]{12}$/;
    if (!validPattern.test(codeWithoutDashes)) {
      return "Registration code contains invalid characters";
    }
  }
  // If code has dashes but isn't complete (14 chars), don't validate format yet
  // This allows partial input like "ABCD-EFGH" without showing errors
  
  return null;
}
