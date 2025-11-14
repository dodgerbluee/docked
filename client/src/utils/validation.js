/**
 * Input Validation Utilities
 * Provides consistent validation functions for form inputs
 */

import config from '../config';

/**
 * Validate username
 */
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  
  const trimmed = username.trim();
  
  if (trimmed.length < config.validation.minUsernameLength) {
    return { 
      valid: false, 
      error: `Username must be at least ${config.validation.minUsernameLength} characters` 
    };
  }
  
  if (trimmed.length > config.validation.maxUsernameLength) {
    return { 
      valid: false, 
      error: `Username must be no more than ${config.validation.maxUsernameLength} characters` 
    };
  }
  
  // Allow alphanumeric, underscore, hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Username can only contain letters, numbers, underscores, and hyphens' 
    };
  }
  
  return { valid: true };
}

/**
 * Validate password
 */
export function validatePassword(password, options = {}) {
  const { minLength = config.validation.minPasswordLength, requireStrong = false } = options;
  
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < minLength) {
    return { 
      valid: false, 
      error: `Password must be at least ${minLength} characters` 
    };
  }
  
  if (requireStrong) {
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      return { 
        valid: false, 
        error: 'Password must contain uppercase, lowercase, number, and special character' 
      };
    }
  }
  
  return { valid: true };
}

/**
 * Validate email (if needed in future)
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  return { valid: true };
}

/**
 * Validate URL
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }
  
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http or https protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Sanitize string input (basic XSS prevention)
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove < and >
    .trim();
}

/**
 * Sanitize HTML (if needed for rich text)
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string') {
    return '';
  }
  
  // Basic HTML sanitization - in production, use a library like DOMPurify
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

