/**
 * SSO Admin Controller
 *
 * Admin-only CRUD endpoints for managing OAuth/SSO providers at runtime.
 * All handlers require instanceAdmin privileges.
 *
 *   GET    /api/admin/sso/providers       - List all providers (secrets masked)
 *   POST   /api/admin/sso/providers       - Create a new provider
 *   PUT    /api/admin/sso/providers/:id   - Update a provider
 *   DELETE /api/admin/sso/providers/:id   - Delete a provider
 *   POST   /api/admin/sso/providers/test  - Test OIDC discovery for a URL
 *   GET    /api/admin/sso/settings        - Get global SSO settings
 *   PUT    /api/admin/sso/settings        - Update global SSO settings
 */

const axios = require("axios");
const logger = require("../utils/logger");
const {
  getAllOAuthProviders,
  getOAuthProviderById,
  getOAuthProviderByName,
  createOAuthProvider,
  updateOAuthProvider,
  deleteOAuthProvider,
} = require("../db/oauthProviders");
const { getSystemSetting, setSystemSetting } = require("../db/settings");
const { reloadProviders } = require("../services/oauth");

/**
 * Mask a secret string, showing only the last 4 characters
 * @param {string} secret
 * @returns {string}
 */
function maskSecret(secret) {
  if (!secret || secret.length <= 4) {
    return "****";
  }
  return "****" + secret.slice(-4);
}

/**
 * Validate provider name (slug format)
 * @param {string} name
 * @returns {boolean}
 */
function isValidSlug(name) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(name) && name.length >= 2 && name.length <= 50;
}

/**
 * Ensure the requester is an instance admin
 */
function requireAdmin(req, res) {
  if (!req.user?.instanceAdmin) {
    res.status(403).json({ success: false, error: "Instance admin access required" });
    return false;
  }
  return true;
}

/**
 * GET /api/admin/sso/providers
 */
async function listProviders(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const rows = await getAllOAuthProviders();
    const providers = rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      providerType: row.provider_type,
      clientId: row.client_id,
      clientSecret: maskSecret(row.client_secret),
      issuerUrl: row.issuer_url,
      scopes: row.scopes,
      autoRegister: row.auto_register === 1,
      defaultRole: row.default_role,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.json({ success: true, providers });
  } catch (error) {
    logger.error("Error listing SSO providers:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to list providers" });
  }
}

/**
 * POST /api/admin/sso/providers
 */
async function createProviderHandler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const {
      name,
      displayName,
      providerType,
      clientId,
      clientSecret,
      issuerUrl,
      scopes,
      autoRegister,
      defaultRole,
      enabled,
    } = req.body;

    // Validate required fields
    if (!name || !displayName || !providerType || !clientId || !clientSecret || !issuerUrl) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: name, displayName, providerType, clientId, clientSecret, issuerUrl",
      });
    }

    if (!isValidSlug(name)) {
      return res.status(400).json({
        success: false,
        error:
          "Provider name must be a lowercase slug (letters, numbers, hyphens, underscores), 2-50 characters",
      });
    }

    if (!["authentik", "generic_oidc"].includes(providerType)) {
      return res.status(400).json({
        success: false,
        error: "providerType must be 'authentik' or 'generic_oidc'",
      });
    }

    // Check for duplicate name
    const existing = await getOAuthProviderByName(name);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `A provider with the name '${name}' already exists`,
      });
    }

    const id = await createOAuthProvider({
      name,
      displayName,
      providerType,
      clientId,
      clientSecret,
      issuerUrl,
      scopes: scopes || "openid,profile,email",
      autoRegister: autoRegister !== false,
      defaultRole: defaultRole || "Administrator",
      enabled: enabled !== false,
    });

    await reloadProviders();

    return res.status(201).json({ success: true, id });
  } catch (error) {
    logger.error("Error creating SSO provider:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to create provider" });
  }
}

/**
 * PUT /api/admin/sso/providers/:id
 */
async function updateProviderHandler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid provider ID" });
    }

    const existing = await getOAuthProviderById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Provider not found" });
    }

    const {
      displayName,
      providerType,
      clientId,
      clientSecret,
      issuerUrl,
      scopes,
      autoRegister,
      defaultRole,
      enabled,
    } = req.body;

    if (providerType && !["authentik", "generic_oidc"].includes(providerType)) {
      return res.status(400).json({
        success: false,
        error: "providerType must be 'authentik' or 'generic_oidc'",
      });
    }

    const changes = await updateOAuthProvider(id, {
      displayName,
      providerType,
      clientId,
      clientSecret, // empty/falsy will be skipped by the DB module
      issuerUrl,
      scopes,
      autoRegister,
      defaultRole,
      enabled,
    });

    await reloadProviders();

    return res.json({ success: true, changes });
  } catch (error) {
    logger.error("Error updating SSO provider:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to update provider" });
  }
}

/**
 * DELETE /api/admin/sso/providers/:id
 */
async function deleteProviderHandler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid provider ID" });
    }

    const changes = await deleteOAuthProvider(id);
    if (changes === 0) {
      return res.status(404).json({ success: false, error: "Provider not found" });
    }

    await reloadProviders();

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting SSO provider:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to delete provider" });
  }
}

/**
 * POST /api/admin/sso/providers/test
 * Tests OIDC discovery for a given issuer URL
 */
async function testProvider(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const { issuerUrl } = req.body;
    if (!issuerUrl) {
      return res.status(400).json({ success: false, error: "issuerUrl is required" });
    }

    // Validate issuerUrl is a proper http/https URL before making any request (prevents SSRF via
    // arbitrary schemes and ensures safe URL construction without regex on uncontrolled input)
    let parsedUrl;
    try {
      parsedUrl = new URL(issuerUrl);
    } catch {
      return res.status(400).json({ success: false, error: "issuerUrl is not a valid URL" });
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ success: false, error: "issuerUrl must use http or https" });
    }

    // Build the discovery URL using URL resolution to handle trailing slashes safely
    const safeBase = parsedUrl.href.endsWith("/") ? parsedUrl.href : `${parsedUrl.href}/`;
    const discoveryUrl = new URL(".well-known/openid-configuration", safeBase).href;

    const response = await axios.get(discoveryUrl, { timeout: 10000 });
    const doc = response.data;

    // Validate required fields
    const required = ["authorization_endpoint", "token_endpoint", "issuer"];
    const missing = required.filter((f) => !doc[f]);

    if (missing.length > 0) {
      return res.json({
        success: true,
        valid: false,
        error: `Discovery document missing fields: ${missing.join(", ")}`,
        discovery: {
          issuer: doc.issuer,
          endpoints: {
            authorization: doc.authorization_endpoint || null,
            token: doc.token_endpoint || null,
            userinfo: doc.userinfo_endpoint || null,
          },
        },
      });
    }

    return res.json({
      success: true,
      valid: true,
      discovery: {
        issuer: doc.issuer,
        endpoints: {
          authorization: doc.authorization_endpoint,
          token: doc.token_endpoint,
          userinfo: doc.userinfo_endpoint || null,
          jwks: doc.jwks_uri || null,
        },
        scopesSupported: doc.scopes_supported || [],
      },
    });
  } catch (error) {
    const detail = error.response?.status ? `HTTP ${error.response.status}` : error.message;
    return res.json({
      success: true,
      valid: false,
      error: `Failed to fetch discovery document: ${detail}`,
    });
  }
}

/**
 * GET /api/admin/sso/settings
 */
async function getSettings(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const allowLocalLogin = await getSystemSetting("oauth_allow_local_login");
    return res.json({
      success: true,
      settings: {
        allowLocalLogin: allowLocalLogin === null ? true : allowLocalLogin !== "false",
      },
    });
  } catch (error) {
    logger.error("Error fetching SSO settings:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to fetch settings" });
  }
}

/**
 * PUT /api/admin/sso/settings
 */
async function updateSettings(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const { allowLocalLogin } = req.body;
    if (allowLocalLogin !== undefined) {
      await setSystemSetting("oauth_allow_local_login", String(allowLocalLogin));
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error updating SSO settings:", { error: error.message });
    return res.status(500).json({ success: false, error: "Failed to update settings" });
  }
}

module.exports = {
  listProviders,
  createProvider: createProviderHandler,
  updateProvider: updateProviderHandler,
  deleteProvider: deleteProviderHandler,
  testProvider,
  getSettings,
  updateSettings,
};
