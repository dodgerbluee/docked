/**
 * OAuth Database Module
 *
 * Handles all OAuth-related database operations including:
 * - CSRF state and PKCE code_verifier ephemeral storage
 * - OAuth user lookup, creation, and account linking
 */

const { getDatabase, queueDatabaseOperation } = require("./connection");
const logger = require("../utils/logger");

/**
 * Store OAuth state for CSRF protection and PKCE
 * @param {string} state - Cryptographically random state parameter
 * @param {string} codeVerifier - PKCE code verifier
 * @param {string} nonce - OpenID Connect nonce
 * @param {string|null} redirectUri - Optional redirect URI to preserve
 * @param {string|null} providerName - Provider name for multi-provider callback routing
 * @returns {Promise<void>}
 */
function createOAuthState(state, codeVerifier, nonce, redirectUri = null, providerName = null) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            "INSERT INTO oauth_states (state, code_verifier, nonce, redirect_uri, provider_name) VALUES (?, ?, ?, ?, ?)",
            [state, codeVerifier, nonce, redirectUri, providerName],
            (err) => {
              if (err) {
                logger.error("Error creating OAuth state:", { error: err });
                return reject(err);
              }
              resolve();
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Consume OAuth state (single-use: SELECT then DELETE atomically)
 * Returns null if state not found or already consumed
 * @param {string} state - State parameter from callback
 * @returns {Promise<Object|null>} - { code_verifier, nonce, redirect_uri } or null
 */
function consumeOAuthState(state) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          // Select the state record
          db.get(
            "SELECT code_verifier, nonce, redirect_uri, provider_name, created_at FROM oauth_states WHERE state = ?",
            [state],
            (err, row) => {
              if (err) {
                logger.error("Error consuming OAuth state:", { error: err });
                return reject(err);
              }

              if (!row) {
                return resolve(null);
              }

              // Check expiry (10 minutes)
              const createdAt = new Date(row.created_at + "Z");
              const now = new Date();
              const ageMs = now.getTime() - createdAt.getTime();
              const maxAgeMs = 10 * 60 * 1000; // 10 minutes

              if (ageMs > maxAgeMs) {
                // Expired - delete and return null
                db.run("DELETE FROM oauth_states WHERE state = ?", [state], () => {
                  // Ignore delete errors - state is expired either way
                });
                return resolve(null);
              }

              // Delete the state (consume it - single use)
              db.run("DELETE FROM oauth_states WHERE state = ?", [state], (deleteErr) => {
                if (deleteErr) {
                  logger.error("Error deleting consumed OAuth state:", { error: deleteErr });
                  // Still return the data - the state was valid
                }
                resolve({
                  codeVerifier: row.code_verifier,
                  nonce: row.nonce,
                  redirectUri: row.redirect_uri,
                  providerName: row.provider_name || null,
                });
              });
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Clean up expired OAuth states (older than 10 minutes)
 * @returns {Promise<number>} - Number of deleted rows
 */
function cleanExpiredOAuthStates() {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            "DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')",
            function (err) {
              if (err) {
                logger.error("Error cleaning expired OAuth states:", { error: err });
                return reject(err);
              }
              if (this.changes > 0) {
                logger.debug(`Cleaned ${this.changes} expired OAuth state(s)`);
              }
              resolve(this.changes);
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Find a user by their OAuth provider identity
 * @param {string} provider - OAuth provider name (e.g., "authentik")
 * @param {string} providerId - User's unique ID at the provider (sub claim)
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserByOAuthId(provider, providerId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get(
        "SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?",
        [provider, providerId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Find a user by email address
 * @param {string} email - Email address
 * @returns {Promise<Object|null>} - User object or null
 */
function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create a new user via OAuth (no password)
 * @param {Object} params
 * @param {string} params.username - Username
 * @param {string|null} params.email - Email address
 * @param {string} params.oauthProvider - OAuth provider name
 * @param {string} params.oauthProviderId - User's ID at the provider
 * @param {string} params.role - User role (default: 'Administrator')
 * @param {boolean} params.instanceAdmin - Whether user is instance admin
 * @returns {Promise<number>} - Created user's ID
 */
function createOAuthUser({
  username,
  email,
  oauthProvider,
  oauthProviderId,
  role = "Administrator",
  instanceAdmin = false,
}) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            `INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin, oauth_provider, oauth_provider_id)
             VALUES (?, NULL, ?, ?, 0, ?, ?, ?)`,
            [username, email || null, role, instanceAdmin ? 1 : 0, oauthProvider, oauthProviderId],
            function (err) {
              if (err) {
                logger.error("Error creating OAuth user:", { error: err });
                return reject(err);
              }
              logger.info(`Created OAuth user: ${username} (provider: ${oauthProvider})`);
              resolve(this.lastID);
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Link an OAuth identity to an existing user
 * @param {number} userId - User ID
 * @param {string} provider - OAuth provider name
 * @param {string} providerId - User's ID at the provider
 * @returns {Promise<void>}
 */
function linkOAuthToUser(userId, provider, providerId) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            "UPDATE users SET oauth_provider = ?, oauth_provider_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [provider, providerId, userId],
            function (err) {
              if (err) {
                logger.error("Error linking OAuth to user:", { error: err });
                return reject(err);
              }
              if (this.changes === 0) {
                return reject(new Error("User not found"));
              }
              logger.info(`Linked OAuth provider ${provider} to user ID ${userId}`);
              resolve();
            }
          );
        } catch (err) {
          reject(err);
        }
      })
  );
}

module.exports = {
  createOAuthState,
  consumeOAuthState,
  cleanExpiredOAuthStates,
  getUserByOAuthId,
  getUserByEmail,
  createOAuthUser,
  linkOAuthToUser,
};
