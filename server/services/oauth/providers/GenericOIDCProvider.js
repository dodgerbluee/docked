/**
 * Generic OIDC Provider
 *
 * Extends BaseProvider with standard OpenID Connect claim normalization.
 * Works with any OIDC-compliant provider (Keycloak, Okta, Azure AD, etc.)
 *
 * Standard OIDC claims used:
 *   sub               - Unique user identifier
 *   preferred_username - Username
 *   email             - Email address
 *   name              - Full display name
 *   groups            - Array of group names (if available)
 */

const BaseProvider = require("./BaseProvider");

class GenericOIDCProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config) {
    super({
      ...config,
      name: config.name || "generic_oidc",
      displayName: config.displayName || "SSO",
      scopes: config.scopes || ["openid", "profile", "email"],
    });
  }

  /**
   * Normalize standard OIDC claims into the standard shape.
   *
   * Merges claims from both the userinfo endpoint and the ID token,
   * preferring userinfo values when available.
   *
   * @param {Object} userInfo - Raw userinfo endpoint response
   * @param {Object} idTokenClaims - Decoded ID token payload
   * @returns {{ id: string, username: string, email: string|null, displayName: string|null, groups: string[] }}
   */
  normalizeUserInfo(userInfo, idTokenClaims) {
    const claims = { ...idTokenClaims, ...userInfo };

    const id = claims.sub;
    if (!id) {
      throw new Error("OIDC response missing 'sub' claim");
    }

    // Username: prefer preferred_username, fall back to email prefix, then sub
    let username = claims.preferred_username;
    if (!username && claims.email) {
      username = claims.email.split("@")[0];
    }
    if (!username) {
      username = `oidc_${String(id).substring(0, 8)}`;
    }

    return {
      id: String(id),
      username: sanitizeUsername(username),
      email: claims.email || null,
      displayName: claims.name || null,
      groups: Array.isArray(claims.groups) ? claims.groups : [],
    };
  }
}

/**
 * Sanitize a username for use in Docked.
 * @param {string} raw - Raw username from provider
 * @returns {string} Sanitized username
 */
function sanitizeUsername(raw) {
  let sanitized = raw.replace(/[^a-zA-Z0-9_.\-]/g, "_");
  sanitized = sanitized.replace(/_+/g, "_");
  sanitized = sanitized.replace(/^_+|_+$/g, "");
  if (sanitized.length < 3) {
    sanitized = sanitized.padEnd(3, "_");
  }
  return sanitized;
}

module.exports = GenericOIDCProvider;
