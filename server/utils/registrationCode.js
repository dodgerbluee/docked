const { customAlphabet } = require("nanoid");
const logger = require("./logger");

// Store the registration code in memory
let registrationCode = null;

/**
 * Generate a secure random registration code using nanoid
 * Format: XXXX-XXXX-XXXX (12 characters, 3 groups of 4)
 * Includes uppercase letters, numbers, and special characters
 * @returns {string} Registration code
 */
function generateRegistrationCode() {
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
 * Initialize and print the registration code
 * Should be called on server startup
 */
function initializeRegistrationCode() {
  registrationCode = generateRegistrationCode();
  logger.info("═══════════════════════════════════════════════════════════");
  logger.info("🔐 FIRST USER REGISTRATION CODE");
  logger.info("═══════════════════════════════════════════════════════════");
  logger.info(`   ${registrationCode}`);
  logger.info("═══════════════════════════════════════════════════════════");
  logger.info("⚠️  This code is required to create the first user account.");
  logger.info("⚠️  The code will be invalidated after the first user is created.");
  logger.info("═══════════════════════════════════════════════════════════");
}

/**
 * Get the current registration code
 * @returns {string|null} Registration code or null if not set
 */
function getRegistrationCode() {
  return registrationCode;
}

/**
 * Validate the registration code
 * @param {string} code - Code to validate (may include or exclude dashes)
 * @returns {boolean} True if code is valid
 */
function validateRegistrationCode(code) {
  if (!registrationCode || !code) {
    return false;
  }
  // Normalize both codes by removing dashes and converting to uppercase
  const normalizedInput = code.replace(/-/g, "").toUpperCase();
  const normalizedStored = registrationCode.replace(/-/g, "").toUpperCase();
  return normalizedInput === normalizedStored;
}

/**
 * Clear the registration code (after first user is created)
 */
function clearRegistrationCode() {
  registrationCode = null;
}

/**
 * Check if registration code is active
 * @returns {boolean} True if code is active
 */
function isRegistrationCodeActive() {
  return registrationCode !== null;
}

module.exports = {
  initializeRegistrationCode,
  getRegistrationCode,
  validateRegistrationCode,
  clearRegistrationCode,
  isRegistrationCodeActive,
};
