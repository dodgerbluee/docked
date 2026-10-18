const { customAlphabet } = require("nanoid");
const logger = require("./logger");
const { getDatabase } = require("../db/connection");

// Pending instance-admin verification tokens live in the shared
// pending_auth_tokens SQLite table: the graph (Go) generates and verifies
// them, while Node's create-user-with-config consumes them, so process
// memory is not an option.

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
 * Log the verification token for the operator (import flow)
 * @param {string} username
 * @param {string} token
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

/**
 * Remove any pending (graph-generated) verification token for a username.
 * Called after create-user-with-config persists the user, since the token
 * now lives on the users row instead.
 * @param {string} username
 * @returns {Promise<void>}
 */
function clearPendingToken(username) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "DELETE FROM pending_auth_tokens WHERE kind = 'instance_admin' AND username = ?",
        [username],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Atomically consume a pending (graph-generated) verification token.
 * Returns true only when a matching (kind='instance_admin', username, token)
 * row existed and was deleted. This is the only legitimate way to grant the
 * instance-admin privilege through create-user-with-config: the graph
 * (generateInstanceAdminToken) mints the token, the operator echoes it back
 * through the import wizard, and this call burns it in the same statement
 * that authorizes the grant, so replays and races lose.
 * @param {string} username
 * @param {string} token
 * @returns {Promise<boolean>} true if the token was consumed by this call
 */
function consumePendingToken(username, token) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "DELETE FROM pending_auth_tokens WHERE kind = 'instance_admin' AND username = ? AND token = ?",
        [username, token],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateVerificationToken,
  logVerificationToken,
  clearPendingToken,
  consumePendingToken,
};
