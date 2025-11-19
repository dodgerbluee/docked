const { customAlphabet } = require("nanoid");
const logger = require("./logger");

// Temporary storage for tokens generated for users that don't exist yet (during import)
// Format: { username: token }
const pendingTokens = new Map();

/**
 * Generate a secure random verification token using nanoid
 * Format: XXXX-XXXX-XXXX (12 characters, 3 groups of 4)
 * Includes uppercase letters, numbers, and special characters
 * @returns {string} Verification token
 */
function generateVerificationToken() {
  // Custom alphabet: uppercase letters, numbers, and safe special characters
  // Excludes confusing characters: 0, O, I, 1, l
  // Includes special characters: !@#$%&*+-=?
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*+-=?";
  const generateId = customAlphabet(alphabet, 12);

  // Generate 12 characters and format with dashes
  const code = generateId();
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/**
 * Store a token temporarily for a username (for users that don't exist yet)
 * @param {string} username - Username
 * @param {string} token - Verification token
 */
function storePendingToken(username, token) {
  pendingTokens.set(username, token);
}

/**
 * Verify and clear a pending token (for users that don't exist yet)
 * @param {string} username - Username
 * @param {string} token - Token to verify
 * @returns {boolean} True if token matches and was cleared
 */
function verifyAndClearPendingToken(username, token) {
  const storedToken = pendingTokens.get(username);
  if (storedToken === token) {
    pendingTokens.delete(username);
    return true;
  }
  return false;
}

/**
 * Get a pending token for a username (without clearing it)
 * @param {string} username - Username
 * @returns {string|null} The token if it exists, null otherwise
 */
function getPendingToken(username) {
  return pendingTokens.get(username) || null;
}

/**
 * Clear a pending token (used when user is created)
 * @param {string} username - Username
 */
function clearPendingToken(username) {
  pendingTokens.delete(username);
}

/**
 * Log verification token to server logs (similar to registration code)
 * Logs without request context to avoid noise (like first user registration code)
 * @param {string} username - Username
 * @param {string} token - Verification token
 */
function logVerificationToken(username, token) {
  // Log without request context to match first user registration code format
  logger.withContext({}, () => {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info(`🔐 REGISTRATION CODE FOR ${username}`);
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info(`   ${token}`);
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info(`⚠️  This code is required to create ${username} as an instance admin.`);
    logger.info("⚠️  The code will be invalidated after verification.");
    logger.info("═══════════════════════════════════════════════════════════");
  });
}

module.exports = {
  generateVerificationToken,
  logVerificationToken,
  storePendingToken,
  verifyAndClearPendingToken,
  getPendingToken,
  clearPendingToken,
};
