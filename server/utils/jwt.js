/**
 * JWT Token Utilities
 * Handles token generation and verification
 */

const jwt = require("jsonwebtoken");
const config = require("../config");

const JWT_SECRET =
  process.env.JWT_SECRET || config.jwt?.secret || "change-this-secret-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || config.jwt?.expiresIn || "24h";
const JWT_REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRES_IN || config.jwt?.refreshExpiresIn || "7d";

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
  return jwt.sign(payload, JWT_SECRET, {
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
