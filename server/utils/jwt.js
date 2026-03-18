/**
 * JWT Token Utilities
 * Handles token generation and verification
 */

const jwt = require("jsonwebtoken");
const config = require("../config");

const DEFAULT_SECRET = "change-this-secret-in-production";
const JWT_SECRET = process.env.JWT_SECRET || config.jwt?.secret || DEFAULT_SECRET;
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || (JWT_SECRET !== DEFAULT_SECRET ? JWT_SECRET + "-refresh" : DEFAULT_SECRET + "-refresh");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || config.jwt?.expiresIn || "24h";
const JWT_REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRES_IN || config.jwt?.refreshExpiresIn || "7d";

// Warn at startup if using the default insecure secret
if (JWT_SECRET === DEFAULT_SECRET) {
  console.warn(
    "[SECURITY WARNING] JWT_SECRET is using the default value. " +
    "Set JWT_SECRET environment variable to a strong random string in production."
  );
}

/**
 * Generate JWT token
 * @param {Object} payload - Token payload (userId, username, role)
 * @param {string} expiresIn - Token expiration (default: 24h)
 * @returns {string} - JWT token
 */
function generateToken(payload, expiresIn = JWT_EXPIRES_IN) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: "docked",
    audience: "docked-users",
  });
}

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} - Refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: "docked",
    audience: "docked-users",
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
      issuer: "docked",
      audience: "docked-users",
    });
    return decoded;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    } else {
      throw error;
    }
  }
}

/**
 * Verify refresh token
 * @param {string} token - Refresh JWT token to verify
 * @returns {Object} - Decoded token payload
 */
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: "docked",
      audience: "docked-users",
    });
    return decoded;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
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
  verifyRefreshToken,
  decodeToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
};
