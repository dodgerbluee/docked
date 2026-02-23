/**
 * BaseProvider - Abstract OAuth2/OpenID Connect Provider
 *
 * Provides the generic OIDC flow:
 *   1. Discovery (auto-fetch endpoints from .well-known)
 *   2. Authorization URL construction with PKCE + state + nonce
 *   3. Authorization code exchange for tokens
 *   4. ID token validation (signature, iss, aud, exp, nonce)
 *   5. User info fetching
 *
 * Concrete providers (Authentik, Google, Keycloak, etc.) extend this class
 * and override normalizeUserInfo() to map provider-specific claims.
 */

const crypto = require("crypto");
const axios = require("axios");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const logger = require("../../../utils/logger");

class BaseProvider {
  /**
   * @param {Object} config
   * @param {string} config.name - Provider identifier (e.g., "authentik")
   * @param {string} config.displayName - Human-readable name (e.g., "Authentik")
   * @param {string} config.clientId - OAuth client ID
   * @param {string} config.clientSecret - OAuth client secret
   * @param {string} config.issuerUrl - OIDC issuer URL
   * @param {string[]} config.scopes - OAuth scopes
   */
  constructor(config) {
    if (new.target === BaseProvider) {
      throw new Error("BaseProvider is abstract and cannot be instantiated directly");
    }

    this.name = config.name;
    this.displayName = config.displayName || config.name;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.issuerUrl = config.issuerUrl;
    this.scopes = config.scopes || ["openid", "profile", "email"];

    this._discoveryDoc = null;
    this._discoveryFetchedAt = null;
    this._jwks = null;
  }

  /**
   * Fetch the OpenID Connect discovery document
   * Cached for 1 hour to avoid excessive requests
   * @returns {Promise<Object>} Discovery document
   */
  async discover() {
    const cacheMaxAge = 60 * 60 * 1000; // 1 hour
    if (this._discoveryDoc && this._discoveryFetchedAt) {
      const age = Date.now() - this._discoveryFetchedAt;
      if (age < cacheMaxAge) {
        return this._discoveryDoc;
      }
    }

    const discoveryUrl = this._buildDiscoveryUrl();
    logger.debug(`Fetching OIDC discovery from: ${discoveryUrl}`);

    try {
      const response = await axios.get(discoveryUrl, { timeout: 10000 });
      this._discoveryDoc = response.data;
      this._discoveryFetchedAt = Date.now();

      // Validate required fields
      const required = ["authorization_endpoint", "token_endpoint", "issuer"];
      for (const field of required) {
        if (!this._discoveryDoc[field]) {
          throw new Error(`Discovery document missing required field: ${field}`);
        }
      }

      // Build JWKS function for ID token verification
      if (this._discoveryDoc.jwks_uri) {
        this._jwks = createRemoteJWKSet(new URL(this._discoveryDoc.jwks_uri));
      }

      return this._discoveryDoc;
    } catch (error) {
      logger.error(`Failed to fetch OIDC discovery from ${discoveryUrl}:`, {
        error: error.message,
      });
      throw new Error(`SSO provider unavailable: ${error.message}`);
    }
  }

  /**
   * Build the discovery URL from the issuer URL
   * Appends /.well-known/openid-configuration if not already present
   * @returns {string}
   */
  _buildDiscoveryUrl() {
    const url = this.issuerUrl.replace(/\/+$/, "");
    if (url.endsWith("/.well-known/openid-configuration")) {
      return url;
    }
    return `${url}/.well-known/openid-configuration`;
  }

  /**
   * Generate PKCE code verifier and challenge
   * @returns {{ codeVerifier: string, codeChallenge: string }}
   */
  static generatePKCE() {
    // code_verifier: 43-128 character URL-safe random string
    const codeVerifier = crypto.randomBytes(32).toString("base64url");

    // code_challenge: base64url(sha256(code_verifier))
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate cryptographically random state parameter
   * @returns {string} 32-byte hex string
   */
  static generateState() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Generate cryptographically random nonce
   * @returns {string} 32-byte hex string
   */
  static generateNonce() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Build the authorization URL
   * @param {Object} params
   * @param {string} params.state - CSRF state parameter
   * @param {string} params.codeChallenge - PKCE code challenge
   * @param {string} params.nonce - OpenID Connect nonce
   * @param {string} params.redirectUri - Callback URL
   * @returns {Promise<string>} Authorization URL
   */
  async getAuthorizationUrl({ state, codeChallenge, nonce, redirectUri }) {
    const discovery = await this.discover();

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: this.scopes.join(" "),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return `${discovery.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * @param {Object} params
   * @param {string} params.code - Authorization code from callback
   * @param {string} params.codeVerifier - PKCE code verifier
   * @param {string} params.redirectUri - Callback URL (must match authorize request)
   * @returns {Promise<Object>} Token response { access_token, id_token, refresh_token, ... }
   */
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const discovery = await this.discover();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: codeVerifier,
    });

    try {
      const response = await axios.post(discovery.token_endpoint, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
      });

      return response.data;
    } catch (error) {
      const detail = error.response?.data?.error_description || error.response?.data?.error || error.message;
      logger.error("OAuth code exchange failed:", { error: detail });
      throw new Error(`Token exchange failed: ${detail}`);
    }
  }

  /**
   * Validate an ID token's signature, issuer, audience, expiry, and nonce
   * @param {string} idToken - Raw JWT ID token
   * @param {string} nonce - Expected nonce value
   * @returns {Promise<Object>} Decoded ID token payload (claims)
   */
  async validateIdToken(idToken, nonce) {
    const discovery = await this.discover();

    if (!this._jwks) {
      throw new Error("JWKS not available - discovery may have failed");
    }

    try {
      const { payload } = await jwtVerify(idToken, this._jwks, {
        issuer: discovery.issuer,
        audience: this.clientId,
      });

      // Verify nonce to prevent replay attacks
      if (payload.nonce !== nonce) {
        throw new Error("ID token nonce mismatch");
      }

      return payload;
    } catch (error) {
      logger.error("ID token validation failed:", { error: error.message });
      throw new Error(`ID token validation failed: ${error.message}`);
    }
  }

  /**
   * Fetch user info from the provider's userinfo endpoint
   * @param {string} accessToken - OAuth access token
   * @returns {Promise<Object>} Raw user info from provider
   */
  async getUserInfo(accessToken) {
    const discovery = await this.discover();

    if (!discovery.userinfo_endpoint) {
      logger.debug("No userinfo_endpoint in discovery, skipping user info fetch");
      return {};
    }

    try {
      const response = await axios.get(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      logger.warn("Failed to fetch user info:", { error: error.message });
      // Non-fatal: we can still use ID token claims
      return {};
    }
  }

  /**
   * Normalize provider-specific user info into a standard shape.
   * MUST be overridden by concrete providers.
   *
   * @param {Object} userInfo - Raw response from userinfo endpoint
   * @param {Object} idTokenClaims - Decoded ID token payload
   * @returns {{ id: string, username: string, email: string|null, displayName: string|null, groups: string[] }}
   */
  // eslint-disable-next-line no-unused-vars
  normalizeUserInfo(userInfo, idTokenClaims) {
    throw new Error("normalizeUserInfo() must be implemented by the provider subclass");
  }
}

module.exports = BaseProvider;
