/**
 * OAuth Provider Registry
 *
 * Central registry for OAuth/OIDC providers. Providers are loaded from the
 * database first (admin-configured), with environment variables as fallback.
 *
 *   isOAuthEnabled()       - true if any provider is configured
 *   getProvider(name)      - get a provider instance by name
 *   getConfiguredProviders() - list all configured providers
 *   initializeProviders()  - called once at startup (async — DB then env fallback)
 *   reloadProviders()      - hot-reload after admin CRUD
 *   getProviderSettings(name) - per-provider autoRegister/defaultRole
 */

const config = require("../../config");
const logger = require("../../utils/logger");

/** @type {Map<string, import('./providers/BaseProvider')>} */
const providers = new Map();

/** @type {Map<string, { autoRegister: boolean, defaultRole: string }>} */
const providerSettings = new Map();

/**
 * Resolve a provider class from a provider type string
 * @param {string} providerType - "authentik" or "generic_oidc"
 * @returns {typeof import('./providers/BaseProvider')|null}
 */
function resolveProviderClass(providerType) {
  switch ((providerType || "").toLowerCase()) {
    case "authentik":
      return require("./providers/AuthentikProvider");
    case "generic_oidc":
      return require("./providers/GenericOIDCProvider");
    default:
      return null;
  }
}

/**
 * Register a provider instance
 * @param {string} name - Provider identifier
 * @param {import('./providers/BaseProvider')} provider - Provider instance
 */
function registerProvider(name, provider) {
  if (providers.has(name)) {
    logger.warn(`OAuth provider '${name}' is already registered, overwriting`);
  }
  providers.set(name, provider);
  logger.info(`Registered OAuth provider: ${name} (${provider.displayName})`);
}

/**
 * Get a registered provider by name
 * @param {string} name - Provider identifier
 * @returns {import('./providers/BaseProvider')|null}
 */
function getProvider(name) {
  return providers.get(name) || null;
}

/**
 * Get all configured/registered providers
 * @returns {Array<{ name: string, displayName: string }>}
 */
function getConfiguredProviders() {
  return Array.from(providers.values()).map((p) => ({
    name: p.name,
    displayName: p.displayName,
  }));
}

/**
 * Check if any OAuth provider is configured and enabled
 * @returns {boolean}
 */
function isOAuthEnabled() {
  return providers.size > 0;
}

/**
 * Get per-provider settings (autoRegister, defaultRole)
 * Falls back to config.oauth values for env-var providers
 * @param {string} name - Provider name
 * @returns {{ autoRegister: boolean, defaultRole: string }}
 */
function getProviderSettings(name) {
  if (providerSettings.has(name)) {
    return providerSettings.get(name);
  }
  // Fallback to env-var config
  return {
    autoRegister: config.oauth.autoRegister,
    defaultRole: config.oauth.defaultRole,
  };
}

/**
 * Initialize providers from DB rows
 * @param {Array} dbProviders - Rows from getEnabledOAuthProviders()
 */
function initializeFromDB(dbProviders) {
  for (const row of dbProviders) {
    try {
      const ProviderClass = resolveProviderClass(row.provider_type);
      if (!ProviderClass) {
        logger.warn(`Unknown provider type '${row.provider_type}' for '${row.name}', skipping`);
        continue;
      }

      const scopes = (row.scopes || "openid,profile,email")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const provider = new ProviderClass({
        name: row.name,
        displayName: row.display_name,
        clientId: row.client_id,
        clientSecret: row.client_secret,
        issuerUrl: row.issuer_url,
        scopes,
      });

      registerProvider(row.name, provider);
      providerSettings.set(row.name, {
        autoRegister: row.auto_register === 1,
        defaultRole: row.default_role || "Administrator",
      });
    } catch (error) {
      logger.error(`Failed to initialize DB provider '${row.name}':`, {
        error: error.message,
      });
    }
  }
}

/**
 * Initialize provider from environment variables (fallback)
 */
function initializeFromEnv() {
  const oauthConfig = config.oauth;

  if (!oauthConfig || !oauthConfig.enabled) {
    return;
  }

  const providerName = oauthConfig.provider;

  if (!oauthConfig.clientId || !oauthConfig.clientSecret || !oauthConfig.issuerUrl) {
    logger.warn(`OAuth env-var provider '${providerName}' is missing required fields, skipping`);
    return;
  }

  // Skip if a DB provider already exists with the same name
  if (providers.has(providerName)) {
    logger.debug(`DB provider '${providerName}' already registered, skipping env-var fallback`);
    return;
  }

  try {
    const ProviderClass = resolveProviderClass(providerName);
    if (!ProviderClass) {
      logger.warn(`Unknown OAuth provider: '${providerName}'. Supported: authentik, generic_oidc`);
      return;
    }

    const provider = new ProviderClass({
      name: providerName,
      clientId: oauthConfig.clientId,
      clientSecret: oauthConfig.clientSecret,
      issuerUrl: oauthConfig.issuerUrl,
      scopes: oauthConfig.scopes,
    });

    registerProvider(providerName, provider);
    providerSettings.set(providerName, {
      autoRegister: oauthConfig.autoRegister,
      defaultRole: oauthConfig.defaultRole,
    });
  } catch (error) {
    logger.error(`Failed to initialize OAuth provider '${providerName}':`, {
      error: error.message,
    });
  }
}

/**
 * Initialize providers based on DB configuration, with env-var fallback.
 * Called once during server startup.
 */
async function initializeProviders() {
  // Try DB first
  try {
    const { getEnabledOAuthProviders } = require("../../db/oauthProviders");
    const dbProviders = await getEnabledOAuthProviders();
    if (dbProviders.length > 0) {
      logger.info(`Found ${dbProviders.length} DB-configured OAuth provider(s)`);
      initializeFromDB(dbProviders);
    }
  } catch (error) {
    // DB may not be ready yet (table not created), fall through to env vars
    logger.debug("Could not load OAuth providers from DB, falling back to env vars:", {
      error: error.message,
    });
  }

  // Env-var fallback (only registers if name not already taken by DB provider)
  initializeFromEnv();

  if (providers.size === 0) {
    logger.info("No OAuth providers configured (DB or env vars)");
  }
}

/**
 * Hot-reload providers after admin CRUD operations.
 * Clears existing providers and re-initializes from DB + env.
 */
async function reloadProviders() {
  providers.clear();
  providerSettings.clear();
  await initializeProviders();
  logger.info(`OAuth providers reloaded: ${providers.size} active`);
}

module.exports = {
  registerProvider,
  getProvider,
  getConfiguredProviders,
  isOAuthEnabled,
  initializeProviders,
  reloadProviders,
  getProviderSettings,
};
