/**
 * OAuth Providers Database Module
 *
 * CRUD operations for database-backed OAuth/SSO provider configuration.
 * Providers stored here take precedence over environment variable configuration.
 */

const { getDatabase, queueDatabaseOperation } = require("./connection");
const logger = require("../utils/logger");

/**
 * Get all OAuth providers
 * @returns {Promise<Array>} All provider rows
 */
function getAllOAuthProviders() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all("SELECT * FROM oauth_providers ORDER BY name ASC", [], (err, rows) => {
        if (err) {
          logger.error("Error fetching OAuth providers:", { error: err });
          return reject(err);
        }
        resolve(rows || []);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all enabled OAuth providers
 * @returns {Promise<Array>} Enabled provider rows
 */
function getEnabledOAuthProviders() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.all(
        "SELECT * FROM oauth_providers WHERE enabled = 1 ORDER BY name ASC",
        [],
        (err, rows) => {
          if (err) {
            logger.error("Error fetching enabled OAuth providers:", { error: err });
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get an OAuth provider by ID
 * @param {number} id - Provider ID
 * @returns {Promise<Object|null>}
 */
function getOAuthProviderById(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT * FROM oauth_providers WHERE id = ?", [id], (err, row) => {
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
 * Get an OAuth provider by name (slug)
 * @param {string} name - Provider name slug
 * @returns {Promise<Object|null>}
 */
function getOAuthProviderByName(name) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.get("SELECT * FROM oauth_providers WHERE name = ?", [name], (err, row) => {
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
 * Create a new OAuth provider
 * @param {Object} provider
 * @param {string} provider.name - Unique slug
 * @param {string} provider.displayName - Human-readable name
 * @param {string} provider.providerType - Provider type (authentik, generic_oidc)
 * @param {string} provider.clientId - OAuth client ID
 * @param {string} provider.clientSecret - OAuth client secret
 * @param {string} provider.issuerUrl - OIDC issuer URL
 * @param {string} [provider.scopes] - Comma-separated scopes
 * @param {boolean} [provider.autoRegister] - Auto-register new users
 * @param {string} [provider.defaultRole] - Default role for new users
 * @param {boolean} [provider.enabled] - Whether provider is enabled
 * @returns {Promise<number>} Created provider ID
 */
function createOAuthProvider({
  name,
  displayName,
  providerType,
  clientId,
  clientSecret,
  issuerUrl,
  scopes = "openid,profile,email",
  autoRegister = true,
  defaultRole = "Administrator",
  enabled = true,
}) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run(
            `INSERT INTO oauth_providers (name, display_name, provider_type, client_id, client_secret, issuer_url, scopes, auto_register, default_role, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              name,
              displayName,
              providerType,
              clientId,
              clientSecret,
              issuerUrl,
              scopes,
              autoRegister ? 1 : 0,
              defaultRole,
              enabled ? 1 : 0,
            ],
            function (err) {
              if (err) {
                logger.error("Error creating OAuth provider:", { error: err });
                return reject(err);
              }
              logger.info(`Created OAuth provider: ${name}`);
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
 * Update an OAuth provider
 * Skips client_secret if empty/undefined (preserves existing value)
 * @param {number} id - Provider ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<number>} Number of rows changed
 */
function updateOAuthProvider(id, updates) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          const fields = [];
          const values = [];

          if (updates.displayName !== undefined) {
            fields.push("display_name = ?");
            values.push(updates.displayName);
          }
          if (updates.providerType !== undefined) {
            fields.push("provider_type = ?");
            values.push(updates.providerType);
          }
          if (updates.clientId !== undefined) {
            fields.push("client_id = ?");
            values.push(updates.clientId);
          }
          // Only update secret if a non-empty value is provided
          if (updates.clientSecret) {
            fields.push("client_secret = ?");
            values.push(updates.clientSecret);
          }
          if (updates.issuerUrl !== undefined) {
            fields.push("issuer_url = ?");
            values.push(updates.issuerUrl);
          }
          if (updates.scopes !== undefined) {
            fields.push("scopes = ?");
            values.push(updates.scopes);
          }
          if (updates.autoRegister !== undefined) {
            fields.push("auto_register = ?");
            values.push(updates.autoRegister ? 1 : 0);
          }
          if (updates.defaultRole !== undefined) {
            fields.push("default_role = ?");
            values.push(updates.defaultRole);
          }
          if (updates.enabled !== undefined) {
            fields.push("enabled = ?");
            values.push(updates.enabled ? 1 : 0);
          }

          if (fields.length === 0) {
            return resolve(0);
          }

          fields.push("updated_at = CURRENT_TIMESTAMP");
          values.push(id);

          db.run(
            `UPDATE oauth_providers SET ${fields.join(", ")} WHERE id = ?`,
            values,
            function (err) {
              if (err) {
                logger.error("Error updating OAuth provider:", { error: err });
                return reject(err);
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
 * Delete an OAuth provider
 * @param {number} id - Provider ID
 * @returns {Promise<number>} Number of rows deleted
 */
function deleteOAuthProvider(id) {
  return queueDatabaseOperation(
    () =>
      new Promise((resolve, reject) => {
        try {
          const db = getDatabase();
          db.run("DELETE FROM oauth_providers WHERE id = ?", [id], function (err) {
            if (err) {
              logger.error("Error deleting OAuth provider:", { error: err });
              return reject(err);
            }
            resolve(this.changes);
          });
        } catch (err) {
          reject(err);
        }
      })
  );
}

module.exports = {
  getAllOAuthProviders,
  getEnabledOAuthProviders,
  getOAuthProviderById,
  getOAuthProviderByName,
  createOAuthProvider,
  updateOAuthProvider,
  deleteOAuthProvider,
};
