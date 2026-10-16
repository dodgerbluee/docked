/**
 * OAuth Providers Database Module
 *
 * Read access for database-backed OAuth/SSO provider configuration used by the
 * OAuth login flow. Admin CRUD now lives in the GraphQL backend.
 * Providers stored here take precedence over environment variable configuration.
 */

const { getDatabase } = require("./connection");
const logger = require("../utils/logger");

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

module.exports = {
  getEnabledOAuthProviders,
};
