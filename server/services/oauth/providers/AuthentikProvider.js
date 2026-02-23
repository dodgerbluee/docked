/**
 * Authentik OAuth2/OpenID Connect Provider
 *
 * Extends BaseProvider with Authentik-specific user info normalization.
 *
 * Authentik OIDC claims reference:
 *   sub               - Unique user identifier (UUID)
 *   preferred_username - Username
 *   email             - Email address
 *   email_verified    - Whether email is verified
 *   name              - Full display name
 *   given_name        - First name
 *   family_name       - Last name
 *   groups            - Array of group names (if 'groups' scope requested)
 *
 * Authentik setup:
 *   1. Create an Application in Authentik admin
 *   2. Create an OAuth2/OpenID Provider with:
 *      - Client Type: Confidential
 *      - Redirect URI: https://your-docked-instance/api/auth/oauth/callback
 *      - Scopes: openid, profile, email
 *   3. Copy Client ID and Client Secret to env vars
 */

const BaseProvider = require("./BaseProvider");

class AuthentikProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config) {
    super({
      ...config,
      name: config.name || "authentik",
      displayName: config.displayName || "Authentik",
      scopes: config.scopes || ["openid", "profile", "email"],
    });
  }

  /**
   * Normalize Authentik user info into the standard shape.
   *
   * Merges claims from both the userinfo endpoint and the ID token,
   * preferring userinfo values when available (they're typically fresher).
   *
   * @param {Object} userInfo - Raw userinfo endpoint response
   * @param {Object} idTokenClaims - Decoded ID token payload
   * @returns {{ id: string, username: string, email: string|null, displayName: string|null, groups: string[] }}
   */
  normalizeUserInfo(userInfo, idTokenClaims) {
    // Merge: userInfo takes precedence over ID token claims
    const claims = { ...idTokenClaims, ...userInfo };

    const id = claims.sub;
    if (!id) {
      throw new Error("Authentik response missing 'sub' claim");
    }

    // Username: prefer preferred_username, fall back to email prefix, then sub
    let username = claims.preferred_username;
    if (!username && claims.email) {
      username = claims.email.split("@")[0];
    }
    if (!username) {
      username = `authentik_${id.substring(0, 8)}`;
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
 * Removes characters that could cause issues, enforces minimum length.
 * @param {string} raw - Raw username from provider
 * @returns {string} Sanitized username
 */
function sanitizeUsername(raw) {
  // Allow alphanumeric, underscores, hyphens, dots
  let sanitized = raw.replace(/[^a-zA-Z0-9_.\-]/g, "_");

  // Collapse consecutive underscores
  sanitized = sanitized.replace(/_+/g, "_");

  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, "");

  // Ensure minimum length of 3
  if (sanitized.length < 3) {
    sanitized = sanitized.padEnd(3, "_");
  }

  return sanitized;
}

module.exports = AuthentikProvider;
