/**
 * Enrollment Tokens Database Module
 *
 * Handles runner enrollment token operations:
 * - Create short-lived tokens for automated runner setup
 * - Validate and consume tokens during registration
 * - Clean up expired tokens
 */

const crypto = require("crypto");
const { getDatabase } = require("./connection");

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Create a new enrollment token for a user.
 * @param {number} userId
 * @returns {Promise<{token: string, expiresAt: string}>}
 */
function createEnrollmentToken(userId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

      db.run(
        "INSERT INTO runner_enrollment_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        [userId, token, expiresAt],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve({ token, expiresAt });
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Validate and consume an enrollment token.
 * Returns the associated user_id if the token is valid (not expired, not used).
 * Marks the token as used atomically.
 *
 * @param {string} token
 * @returns {Promise<{userId: number} | null>} null if token is invalid/expired/used
 */
function consumeEnrollmentToken(token) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const now = new Date().toISOString();

      // Find valid token
      db.get(
        "SELECT id, user_id FROM runner_enrollment_tokens WHERE token = ? AND used = 0 AND expires_at > ?",
        [token, now],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);

          // Mark as used
          db.run(
            "UPDATE runner_enrollment_tokens SET used = 1 WHERE id = ?",
            [row.id],
            (updateErr) => {
              if (updateErr) return reject(updateErr);
              resolve({ userId: row.user_id });
            }
          );
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete expired or used tokens older than 1 hour.
 * @returns {Promise<number>} number of rows deleted
 */
function cleanupExpiredTokens() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      db.run(
        "DELETE FROM runner_enrollment_tokens WHERE expires_at < ? OR (used = 1 AND created_at < ?)",
        [cutoff, cutoff],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  createEnrollmentToken,
  consumeEnrollmentToken,
  cleanupExpiredTokens,
};
