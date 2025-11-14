/**
 * Security Utilities
 * Input sanitization, XSS prevention, and security helpers
 */

/**
 * Sanitize string input to prevent XSS
 * Removes potentially dangerous characters and HTML tags
 * @param {string} input - Input string to sanitize
 * @param {Object} options - Sanitization options
 * @returns {string} - Sanitized string
 */
function sanitizeString(input, options = {}) {
  if (typeof input !== 'string') {
    return input;
  }

  const {
    allowHtml = false,
    maxLength = null,
    trim = true,
  } = options;

  let sanitized = input;

  // Trim whitespace
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Remove HTML tags if not allowed
  if (!allowHtml) {
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }

  // Remove potentially dangerous characters
  sanitized = sanitized
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers

  // Enforce max length
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize object recursively
 * @param {Object} obj - Object to sanitize
 * @param {Object} options - Sanitization options
 * @returns {Object} - Sanitized object
 */
function sanitizeObject(obj, options = {}) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj, options);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip sanitization for known safe fields (passwords, tokens, etc. are handled separately)
      if (key.includes('password') || key.includes('token') || key.includes('secret')) {
        sanitized[key] = value;
      } else {
        sanitized[key] = sanitizeObject(value, options);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Validate and sanitize URL
 * @param {string} url - URL to validate
 * @returns {string} - Validated URL or throws error
 */
function validateUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('URL must be a string');
  }

  try {
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must use http or https protocol');
    }

    return parsed.toString();
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      throw new Error('Invalid URL format');
    }
    throw error;
  }
}

/**
 * Validate email format (basic)
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Generate secure random string
 * @param {number} length - Length of string
 * @returns {string} - Random string
 */
function generateSecureRandomString(length = 32) {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Mask sensitive data in logs
 * @param {string} value - Value to mask
 * @param {number} visibleChars - Number of characters to show at start
 * @returns {string} - Masked value
 */
function maskSensitiveData(value, visibleChars = 4) {
  if (!value || typeof value !== 'string') {
    return '***';
  }

  if (value.length <= visibleChars) {
    return '***';
  }

  return value.substring(0, visibleChars) + '*'.repeat(Math.min(value.length - visibleChars, 20));
}

/**
 * Check if string contains potentially dangerous patterns
 * @param {string} input - Input to check
 * @returns {boolean} - True if potentially dangerous
 */
function containsDangerousPatterns(input) {
  if (typeof input !== 'string') {
    return false;
  }

  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /eval\s*\(/i,
    /expression\s*\(/i,
  ];

  return dangerousPatterns.some(pattern => pattern.test(input));
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  validateUrl,
  isValidEmail,
  generateSecureRandomString,
  maskSensitiveData,
  containsDangerousPatterns,
};

