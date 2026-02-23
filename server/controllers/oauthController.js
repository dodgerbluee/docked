/**
 * OAuth Controller
 *
 * Handles OAuth2/OpenID Connect authentication flow:
 *   GET  /api/auth/oauth/providers  - List available SSO providers
 *   GET  /api/auth/oauth/login      - Initiate OAuth flow (redirect to provider)
 *   GET  /api/auth/oauth/callback   - Handle provider callback, issue JWT
 *   POST /api/auth/oauth/link       - Complete account linking (password confirmation)
 */

const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");
const config = require("../config");
const { generateToken, generateRefreshToken, JWT_SECRET } = require("../utils/jwt");
const {
  createOAuthState,
  consumeOAuthState,
  getUserByOAuthId,
  getUserByEmail,
  createOAuthUser,
  linkOAuthToUser,
  hasAnyUsers,
  updateLastLogin,
  getUserByUsername,
  verifyPassword,
} = require("../db/index");
const {
  getProvider,
  getConfiguredProviders,
  isOAuthEnabled,
  getProviderSettings,
} = require("../services/oauth");
const BaseProvider = require("../services/oauth/providers/BaseProvider");

/** Sentinel error code used when account linking requires password confirmation */
const LINK_REQUIRED = "LINK_REQUIRED";

/**
 * GET /api/auth/oauth/providers
 * Returns the list of configured OAuth providers for the login page.
 * Public endpoint - no auth required.
 */
async function getProviders(req, res) {
  if (!isOAuthEnabled()) {
    return res.json({
      success: true,
      providers: [],
      allowLocalLogin: true,
    });
  }

  const providers = getConfiguredProviders().map((p) => ({
    name: p.name,
    displayName: p.displayName,
  }));

  // Check DB system setting first, fall back to env var
  let allowLocalLogin = config.oauth.allowLocalLogin;
  try {
    const { getSystemSetting } = require("../db/index");
    const dbValue = await getSystemSetting("oauth_allow_local_login");
    if (dbValue !== null) {
      allowLocalLogin = dbValue !== "false";
    }
  } catch {
    // Fall through to env-var value
  }

  return res.json({
    success: true,
    providers,
    allowLocalLogin,
  });
}

/**
 * GET /api/auth/oauth/login
 * Initiates the OAuth flow by generating state/PKCE, storing them,
 * and returning the authorization URL.
 *
 * Query params:
 *   provider - (optional) provider name, defaults to configured provider
 */
// eslint-disable-next-line max-lines-per-function -- OAuth initiation requires multiple steps
async function initiateLogin(req, res, next) {
  try {
    if (!isOAuthEnabled()) {
      return res.status(400).json({
        success: false,
        error: "No OAuth providers are configured",
      });
    }

    const providerName = req.query.provider || config.oauth.provider;

    if (!providerName) {
      return res.status(400).json({
        success: false,
        error: "No OAuth provider specified",
      });
    }

    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(400).json({
        success: false,
        error: `OAuth provider '${providerName}' is not configured`,
      });
    }

    // Generate PKCE, state, and nonce
    const { codeVerifier, codeChallenge } = BaseProvider.generatePKCE();
    const state = BaseProvider.generateState();
    const nonce = BaseProvider.generateNonce();

    // Build callback URL from current request
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const callbackUrl = `${protocol}://${host}/api/auth/oauth/callback`;

    // Store state + PKCE in database for verification on callback (include providerName for multi-provider routing)
    await createOAuthState(state, codeVerifier, nonce, callbackUrl, providerName);

    // Build authorization URL
    const authorizationUrl = await provider.getAuthorizationUrl({
      state,
      codeChallenge,
      nonce,
      redirectUri: callbackUrl,
    });

    logger.info(`OAuth login initiated for provider: ${providerName}`);

    // Redirect the user's browser to the provider
    return res.redirect(authorizationUrl);
  } catch (error) {
    logger.error("Failed to initiate OAuth login:", { error: error.message });
    next(error);
  }
}

/**
 * GET /api/auth/oauth/callback
 * Handles the OAuth provider callback after user authentication.
 *
 * Query params (from provider):
 *   code  - Authorization code
 *   state - CSRF state parameter
 *   error - Error code (if user denied or provider errored)
 *   error_description - Human-readable error message
 */
// eslint-disable-next-line max-lines-per-function, complexity -- OAuth callback requires comprehensive validation and account resolution
async function handleCallback(req, res, next) {
  try {
    const { code, state, error: oauthError, error_description: errorDescription } = req.query;

    // Build frontend base URL for redirects
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const frontendBase = `${protocol}://${host}`;

    // Handle provider errors (user denied, etc.)
    if (oauthError) {
      let message = errorDescription || oauthError;
      if (oauthError === "access_denied") {
        message = "Sign-in was cancelled.";
      } else if (oauthError === "invalid_request") {
        message = "Invalid sign-in request. Please try again.";
      } else if (oauthError === "unauthorized_client") {
        message = "Sign-in service configuration error. Please contact your administrator.";
      } else if (oauthError === "server_error" || oauthError === "temporarily_unavailable") {
        message = "Sign-in service is temporarily unavailable. Please try again later.";
      } else {
        message = "Sign-in failed. Please try again or contact your administrator.";
      }
      logger.warn(`OAuth callback error: ${oauthError} - ${message}`);
      return res.redirect(
        `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent(message)}`
      );
    }

    // Validate required params
    if (!code || !state) {
      return res.redirect(
        `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent("Missing authorization code or state parameter")}`
      );
    }

    // Consume state (single-use, validates CSRF + returns PKCE verifier)
    const storedState = await consumeOAuthState(state);
    if (!storedState) {
      return res.redirect(
        `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent("Invalid or expired login session. Please try again.")}`
      );
    }

    const { codeVerifier, nonce, redirectUri } = storedState;

    // Determine which provider to use (from stored state, fallback to env var for in-flight upgrade safety)
    const providerName = storedState.providerName || config.oauth.provider;
    const provider = getProvider(providerName);
    if (!provider) {
      return res.redirect(
        `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent("OAuth provider not available")}`
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await provider.exchangeCode({
      code,
      codeVerifier,
      redirectUri,
    });

    if (!tokenResponse.access_token) {
      return res.redirect(
        `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent("Failed to obtain access token from provider")}`
      );
    }

    // Validate ID token if present
    let idTokenClaims = {};
    if (tokenResponse.id_token) {
      idTokenClaims = await provider.validateIdToken(tokenResponse.id_token, nonce);
    }

    // Fetch user info from provider
    const rawUserInfo = await provider.getUserInfo(tokenResponse.access_token);

    // Normalize user info
    const normalizedUser = provider.normalizeUserInfo(rawUserInfo, idTokenClaims);
    logger.info(
      `OAuth user info normalized: ${normalizedUser.username} (${providerName}:${normalizedUser.id})`
    );

    // Account resolution
    const result = await resolveOAuthUser(providerName, normalizedUser);

    // Handle "link required" — username collision with a password-based account
    if (result.linkRequired) {
      // Issue a short-lived, single-purpose JWT containing the OAuth identity
      const linkToken = jwt.sign(
        {
          purpose: "oauth_link",
          providerName,
          oauthId: normalizedUser.id,
          oauthUsername: normalizedUser.username,
          oauthEmail: normalizedUser.email,
          targetUserId: result.existingUser.id,
          targetUsername: result.existingUser.username,
        },
        JWT_SECRET,
        { expiresIn: "5m", issuer: "docked", audience: "docked-oauth-link" }
      );

      const params = new URLSearchParams({
        linkRequired: "true",
        linkToken,
        username: result.existingUser.username,
      });

      return res.redirect(`${frontendBase}/auth/oauth/complete?${params.toString()}`);
    }

    // Normal success path
    const resolvedUser = result;

    // Generate Docked JWT
    const token = generateToken({
      userId: resolvedUser.id,
      username: resolvedUser.username,
      role: resolvedUser.role,
    });

    const refreshToken = generateRefreshToken({
      userId: resolvedUser.id,
      username: resolvedUser.username,
      role: resolvedUser.role,
    });

    // Update last login (non-blocking)
    try {
      await updateLastLogin(resolvedUser.username);
    } catch (err) {
      logger.warn("Failed to update last login for OAuth user:", { error: err });
    }

    // Set tokens and user data in cookies for secure transmission
    res.cookie("authToken", token, { httpOnly: false, secure: req.secure, sameSite: "lax" });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: false,
      secure: req.secure,
      sameSite: "lax",
    });
    res.cookie("username", resolvedUser.username, {
      httpOnly: false,
      secure: req.secure,
      sameSite: "lax",
    });
    res.cookie("userRole", resolvedUser.role, {
      httpOnly: false,
      secure: req.secure,
      sameSite: "lax",
    });
    res.cookie("instanceAdmin", resolvedUser.instanceAdmin ? "true" : "false", {
      httpOnly: false,
      secure: req.secure,
      sameSite: "lax",
    });

    return res.redirect(`${frontendBase}/auth/oauth/complete`);
  } catch (error) {
    logger.error("OAuth callback failed:", { error: error.message });

    // Build frontend URL for error redirect
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const frontendBase = `${protocol}://${host}`;

    let userMessage = error.message || "Authentication failed";
    if (userMessage.includes("Token exchange failed")) {
      userMessage =
        "Unable to complete sign-in. The sign-in service may be experiencing issues. Please try again.";
    } else if (userMessage.includes("ID token validation failed")) {
      userMessage = "Sign-in verification failed. Please try again or contact your administrator.";
    } else if (userMessage.includes("SSO provider unavailable")) {
      userMessage = "Sign-in service is currently unavailable. Please try again later.";
    } else {
      userMessage = "Authentication failed. Please try again or contact your administrator.";
    }

    return res.redirect(
      `${frontendBase}/auth/oauth/complete?error=${encodeURIComponent(userMessage)}`
    );
  }
}

/**
 * POST /api/auth/oauth/link
 * Completes account linking: user provides their password to confirm linking
 * their existing account to the OAuth identity.
 *
 * Body: { linkToken, password }
 */
async function completeAccountLink(req, res) {
  try {
    const { linkToken, password } = req.body;

    if (!linkToken || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Link token and password are required" });
    }

    // Verify the link token
    let payload;
    try {
      payload = jwt.verify(linkToken, JWT_SECRET, {
        issuer: "docked",
        audience: "docked-oauth-link",
      });
    } catch (err) {
      const msg =
        err.name === "TokenExpiredError"
          ? "This linking session has expired. Please try signing in with SSO again."
          : "Invalid linking session. Please try signing in with SSO again.";
      return res.status(400).json({ success: false, error: msg });
    }

    if (payload.purpose !== "oauth_link") {
      return res.status(400).json({ success: false, error: "Invalid link token" });
    }

    // Look up the target user
    const user = await getUserByUsername(payload.targetUsername);
    if (!user || user.id !== payload.targetUserId) {
      return res.status(400).json({ success: false, error: "User account not found" });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, error: "Incorrect password" });
    }

    // Link OAuth identity to the existing account
    await linkOAuthToUser(user.id, payload.providerName, payload.oauthId);
    logger.info(
      `Linked OAuth ${payload.providerName} to existing user: ${user.username} (confirmed with password)`
    );

    // Issue auth tokens
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    // Update last login
    try {
      await updateLastLogin(user.username);
    } catch (err) {
      logger.warn("Failed to update last login:", { error: err });
    }

    return res.json({
      success: true,
      token,
      refreshToken,
      username: user.username,
      role: user.role,
      instanceAdmin: user.instance_admin === 1,
    });
  } catch (error) {
    logger.error("Account linking failed:", { error: error.message });
    return res.status(500).json({ success: false, error: "Account linking failed" });
  }
}

/**
 * Resolve an OAuth user to a local Docked user account.
 *
 * Resolution order:
 *   1. Existing user linked to this OAuth identity → return it
 *   2. Existing user with matching email (not already linked to another provider) → link and return
 *   3. Existing user with matching username that has a password → return linkRequired
 *   4. No match → auto-register if enabled, else reject
 *
 * @param {string} providerName - OAuth provider name
 * @param {Object} normalizedUser - Normalized user info from provider
 * @returns {Promise<Object>} - { id, username, role, instanceAdmin } OR { linkRequired, existingUser }
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Account resolution requires multiple lookup strategies
async function resolveOAuthUser(providerName, normalizedUser) {
  // 1. Check for existing linked account
  const existingOAuthUser = await getUserByOAuthId(providerName, normalizedUser.id);
  if (existingOAuthUser) {
    logger.debug(`OAuth user found by provider ID: ${existingOAuthUser.username}`);
    return {
      id: existingOAuthUser.id,
      username: existingOAuthUser.username,
      role: existingOAuthUser.role,
      instanceAdmin: existingOAuthUser.instance_admin === 1,
    };
  }

  // 2. Check for existing user with matching email (account linking)
  if (normalizedUser.email) {
    const existingEmailUser = await getUserByEmail(normalizedUser.email);
    if (existingEmailUser) {
      // Only link if user doesn't already have a different OAuth provider
      if (existingEmailUser.oauth_provider && existingEmailUser.oauth_provider !== providerName) {
        throw new Error(
          `This email is already linked to a different SSO provider (${existingEmailUser.oauth_provider}). ` +
            "Please sign in with that provider instead."
        );
      }

      // If user has a password, require confirmation before linking
      if (existingEmailUser.password_hash) {
        return {
          linkRequired: true,
          existingUser: {
            id: existingEmailUser.id,
            username: existingEmailUser.username,
          },
        };
      }

      // No password (OAuth-only) — link directly
      await linkOAuthToUser(existingEmailUser.id, providerName, normalizedUser.id);
      logger.info(
        `Linked OAuth provider ${providerName} to existing user: ${existingEmailUser.username}`
      );

      return {
        id: existingEmailUser.id,
        username: existingEmailUser.username,
        role: existingEmailUser.role,
        instanceAdmin: existingEmailUser.instance_admin === 1,
      };
    }
  }

  // 3. Check for existing user with matching username (username collision)
  const existingUserWithName = await getUserByUsername(normalizedUser.username);
  if (existingUserWithName) {
    // If user has a password, require confirmation before linking
    if (existingUserWithName.password_hash) {
      return {
        linkRequired: true,
        existingUser: {
          id: existingUserWithName.id,
          username: existingUserWithName.username,
        },
      };
    }

    // If the existing user already has a different OAuth provider, don't auto-link
    if (
      existingUserWithName.oauth_provider &&
      existingUserWithName.oauth_provider !== providerName
    ) {
      throw new Error(
        `An account with this username already exists and is linked to a different SSO provider. ` +
          "Please contact your administrator."
      );
    }

    // No password, same or no provider — link directly
    await linkOAuthToUser(existingUserWithName.id, providerName, normalizedUser.id);
    logger.info(
      `Linked OAuth provider ${providerName} to existing user by username: ${existingUserWithName.username}`
    );

    return {
      id: existingUserWithName.id,
      username: existingUserWithName.username,
      role: existingUserWithName.role,
      instanceAdmin: existingUserWithName.instance_admin === 1,
    };
  }

  // 4. Auto-register new user
  const settings = getProviderSettings(providerName);
  if (!settings.autoRegister) {
    throw new Error(
      "No account found for this identity. Please contact your administrator to create an account."
    );
  }

  // Check if this is the first user (should be instance admin)
  const isFirstUser = !(await hasAnyUsers());

  const userId = await createOAuthUser({
    username: normalizedUser.username,
    email: normalizedUser.email,
    oauthProvider: providerName,
    oauthProviderId: normalizedUser.id,
    role: settings.defaultRole,
    instanceAdmin: isFirstUser,
  });

  logger.info(
    `Created new OAuth user: ${normalizedUser.username} (provider: ${providerName}, first user: ${isFirstUser})`
  );

  return {
    id: userId,
    username: normalizedUser.username,
    role: settings.defaultRole,
    instanceAdmin: isFirstUser,
  };
}

module.exports = {
  getProviders,
  initiateLogin,
  handleCallback,
  completeAccountLink,
};
