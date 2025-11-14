/**
 * JWT Token Utilities
 * Handles token generation and verification
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

// Use the same secret source as config to ensure consistency
const JWT_SECRET = process.env.JWT_SECRET || config.jwt?.secret || 'change-this-secret-in-production-use-strong-random-string';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || config.jwt?.expiresIn || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || config.jwt?.refreshExpiresIn || '7d';

/**
 * Generate JWT token
 * @param {Object} payload - Token payload (userId, username, role)
 * @param {string} expiresIn - Token expiration (default: 24h)
 * @returns {string} - JWT token
 */
function generateToken(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: 'docked',
    audience: 'docked-users',
  });
}

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} - Refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: 'docked',
    audience: 'docked-users',
  });
}

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'docked',
      audience: 'docked-users',
    });
    return decoded;
  } catch (error) {
    const logger = require('./logger');
    // Log the actual JWT error for debugging - use console.log to bypass redaction
    console.log('[JWT DEBUG] Verification failed:', {
      errorName: error.name,
      errorMessage: error.message,
      secretLength: JWT_SECRET ? JWT_SECRET.length : 0,
      tokenLength: token ? token.length : 0,
      tokenPrefix: token ? token.substring(0, 30) + '...' : 'none',
    });
    
    // Also log via logger (may be redacted)
    logger.info('JWT verify error details', {
      module: 'jwt',
      errorName: error.name,
      errorMessage: error.message,
      secretLength: JWT_SECRET ? JWT_SECRET.length : 0,
      tokenLength: token ? token.length : 0,
    });
    
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      // Include the actual error message for debugging
      throw new Error(`Invalid token: ${error.message}`);
    } else {
      throw error;
    }
  }
}

/**
 * Decode token without verification (for debugging)
 * @param {string} token - JWT token
 * @returns {Object} - Decoded token
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
};

