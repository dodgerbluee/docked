/**
 * Token revocation (shared with the Go backend via the revoked_tokens table).
 *
 * JWTs are stateless, so logging out cannot by itself invalidate a leaked
 * token before its exp claim. The logout path records the SHA-256 hash of the
 * presented token; every authenticated request rejects a hash found here. Rows
 * become redundant once the token would have expired on its own.
 */
const crypto = require("crypto");
const { getDatabase } = require("./connection");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Record a token so it is rejected before its natural expiry.
 * @param {string} token - Raw JWT
 * @param {number} userId - Owner of the token
 * @param {number} expiresAt - Token exp claim (unix seconds)
 * @returns {Promise<void>}
 */
function revokeToken(token, userId, expiresAt) {
  return new Promise((resolve, reject) => {
    try {
      getDatabase().run(
        "INSERT OR IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        [hashToken(token), userId, expiresAt],
        (err) => (err ? reject(err) : resolve())
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Report whether a token has been revoked and not yet pruned.
 * @param {string} token - Raw JWT
 * @returns {Promise<boolean>}
 */
function isTokenRevoked(token) {
  return new Promise((resolve, reject) => {
    try {
      getDatabase().get(
        "SELECT 1 FROM revoked_tokens WHERE token_hash = ? LIMIT 1",
        [hashToken(token)],
        (err, row) => {
          if (err) {
            if (err.message.includes("no such table")) {
              resolve(false);
            } else {
              reject(err);
            }
          } else {
            resolve(Boolean(row));
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { revokeToken, isTokenRevoked };
