/**
 * Authentication Controller
 * Handles user authentication with database
 */
/* eslint-disable max-lines -- Large controller file with comprehensive authentication logic */
const axios = require("axios");
const logger = require("../utils/logger");
const { validateRequiredFields, isValidEmail } = require("../utils/validation");
// const { sendErrorResponse, sendValidationErrorResponse } = require("../utils/responseHelpers"); // Unused
const {
  getUserByUsername,
  getUserById,
  verifyPassword,
  updateLastLogin,
  createUser,
  getAllUsers,
  updateVerificationToken,
  getAllSourceInstances,
  getAllDiscordWebhooks,
  getAllTrackedApps,
  getBatchConfig,
  getSetting,
  getSystemSetting,
  createSourceInstance,
  createDiscordWebhook,
  createTrackedApp,
  updateTrackedApp,
  updateBatchConfig,
  setSetting,
  setSystemSetting,
} = require("../db/index");
const { consumePendingToken, clearPendingToken } = require("../utils/verificationToken");
const { generateToken, generateRefreshToken, verifyToken: verifyJWT } = require("../utils/jwt");
const fs = require("fs");
const path = require("path");

/**
 * Login endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function -- Complex login logic with validation
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    // Validate input
    const validationError = validateRequiredFields({ username, password }, [
      "username",
      "password",
    ]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Get user from database
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    // Reject OAuth-only users (no password set) with a helpful message
    if (!user.password_hash && user.oauth_provider) {
      return res.status(401).json({
        success: false,
        error: `This account uses SSO. Please sign in with ${user.oauth_provider}.`,
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    // Generate refresh token
    const refreshToken = generateRefreshToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    // Update last login timestamp (non-blocking - don't fail login if this fails)
    try {
      await updateLastLogin(username);
    } catch (err) {
      // Log but don't fail login if last_login update fails
      logger.warn("Failed to update last login timestamp:", { error: err });
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
    next(error);
  }
}

/**
 * Verify token endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function -- Complex token verification logic
async function verifyToken(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided",
      });
    }

    try {
      // Try JWT verification first
      const decoded = verifyJWT(token);

      // Verify user still exists
      const { getUserById: getUserByIdLocal } = require("../db/index");
      const user = await getUserByIdLocal(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: "User not found",
        });
      }

      return res.json({
        success: true,
        username: user.username,
        role: user.role,
        instanceAdmin: user.instance_admin === 1,
      });
    } catch (_jwtError) {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
      });
    }
  } catch (error) {
    next(error);
  }
}

// Docker Hub credential management removed - crane/skopeo use system Docker credentials
// Users should run 'docker login' on the server if registry authentication is needed

/**
 * Migrate avatar from username-based directory to user ID-based directory
 * Called when username is updated to preserve avatar files
 * @param {number} userId - User ID
 * @param {string} oldUsername - Old username (for finding avatar directory)
 */
function migrateAvatarFromUsername(userId, oldUsername) {
  try {
    const DATA_DIR = process.env.DATA_DIR || "/data";
    const AVATARS_DIR = path.join(DATA_DIR, "avatars");
    const oldAvatarDir = path.join(AVATARS_DIR, oldUsername);
    const newAvatarDir = path.join(AVATARS_DIR, userId.toString());

    // If old directory doesn't exist, nothing to migrate
    if (!fs.existsSync(oldAvatarDir)) {
      return;
    }

    // If new directory already exists, don't overwrite
    if (fs.existsSync(newAvatarDir)) {
      return;
    }

    // Create new directory
    fs.mkdirSync(newAvatarDir, { recursive: true });

    // Copy main avatar if it exists
    const oldAvatarPath = path.join(oldAvatarDir, "avatar.jpg");
    if (fs.existsSync(oldAvatarPath)) {
      const newAvatarPath = path.join(newAvatarDir, "avatar.jpg");
      fs.copyFileSync(oldAvatarPath, newAvatarPath);
    }

    // Copy recent avatars directory if it exists
    const oldRecentDir = path.join(oldAvatarDir, "recent");
    if (fs.existsSync(oldRecentDir)) {
      const newRecentDir = path.join(newAvatarDir, "recent");
      fs.mkdirSync(newRecentDir, { recursive: true });

      // Copy all recent avatar files
      const recentFiles = fs.readdirSync(oldRecentDir);
      recentFiles.forEach((file) => {
        const oldFilePath = path.join(oldRecentDir, file);
        const newFilePath = path.join(newRecentDir, file);
        if (fs.statSync(oldFilePath).isFile() && file.endsWith(".jpg")) {
          fs.copyFileSync(oldFilePath, newFilePath);
        }
      });
    }

    logger.info(
      `Migrated avatar from username directory (${oldUsername}) to user ID directory (${userId})`
    );
  } catch (err) {
    logger.error("Error migrating avatar during username update:", err);
    // Don't throw - migration failure shouldn't break username update
  }
}

/**
 * Export all user configurations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function -- Complex export logic with multiple data sources
async function exportUserConfig(req, res, next) {
  try {
    const username = req.user?.username;

    if (!username) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Collect all user configurations
    const [
      portainerInstances,
      discordWebhooks,
      trackedApps,
      batchConfig,
      colorScheme,
      logLevel,
      refreshingTogglesEnabled,
    ] = await Promise.all([
      getAllSourceInstances(user.id),
      getAllDiscordWebhooks(user.id),
      getAllTrackedApps(user.id),
      getBatchConfig(user.id),
      getSetting("color_scheme", user.id),
      getSystemSetting("log_level"),
      getSetting("refreshing_toggles_enabled", user.id),
    ]);

    // Build export object
    const exportData = {
      exportDate: new Date().toISOString(),
      user: {
        username: user.username,
        role: user.role,
        instance_admin: user.instance_admin === 1,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      portainerInstances: portainerInstances.map((instance) => ({
        id: instance.id,
        name: instance.name,
        url: instance.url,
        auth_type: instance.auth_type,
        display_order: instance.display_order,
        ip_address: instance.ip_address,
        created_at: instance.created_at,
        updated_at: instance.updated_at,
      })),
      discordWebhooks: discordWebhooks.map((webhook) => ({
        id: webhook.id,
        server_name: webhook.server_name,
        channel_name: webhook.channel_name,
        avatar_url: webhook.avatar_url,
        guild_id: webhook.guild_id,
        channel_id: webhook.channel_id,
        enabled: webhook.enabled,
        name: webhook.name || null,
        created_at: webhook.created_at,
        updated_at: webhook.updated_at,
      })),
      trackedApps: trackedApps.map((image) => ({
        id: image.id,
        name: image.name,
        image_name: image.image_name,
        github_repo: image.github_repo,
        source_type: image.source_type,
        current_version: image.current_version,
        current_digest: image.current_digest,
        latest_version: image.latest_version,
        latest_digest: image.latest_digest,
        has_update: image.has_update === 1,
        current_version_publish_date: image.current_version_publish_date,
        last_checked: image.last_checked,
        created_at: image.created_at,
        updated_at: image.updated_at,
      })),
      generalSettings: {
        colorScheme: colorScheme || "system",
        logLevel: logLevel || "info",
        refreshingTogglesEnabled:
          refreshingTogglesEnabled === "true" || refreshingTogglesEnabled === true,
        batchConfig,
      },
    };

    return res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Build update data object from image config
 * @param {Object} image - Image configuration object
 * @returns {Object} Update data object
 */
function buildTrackedAppUpdateData(image) {
  const updateData = {};

  if (image.current_version !== undefined) {
    updateData.current_version = image.current_version;
  }
  if (image.current_digest !== undefined) {
    updateData.current_digest = image.current_digest;
  }
  if (image.latest_version !== undefined) {
    updateData.latest_version = image.latest_version;
  }
  if (image.latest_digest !== undefined) {
    updateData.latest_digest = image.latest_digest;
  }
  if (image.has_update !== undefined) {
    updateData.has_update = image.has_update;
  }
  if (image.current_version_publish_date !== undefined) {
    updateData.current_version_publish_date = image.current_version_publish_date;
  }
  if (image.last_checked !== undefined) {
    updateData.last_checked = image.last_checked;
  }

  return updateData;
}

/**
 * Import Portainer instances from config
 * @param {Array} instances - Portainer instances to import
 * @param {Object} credentials - Credentials object
 * @param {Object} results - Results object to update
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
// eslint-disable-next-line complexity -- Portainer instance import requires multiple conditional checks
async function importPortainerInstances(instances, credentials, results, userId) {
  const { resolveUrlToIp } = require("../utils/dnsResolver");

  for (const instance of instances) {
    try {
      const instanceCreds = credentials?.portainerInstances?.find((c) => c.url === instance.url);

      if (!instanceCreds) {
        results.errors.push(
          `Portainer instance "${instance.name}" (${instance.url}): Missing credentials`
        );
        continue;
      }

      const ipAddress = await resolveUrlToIp(instance.url);
      const id = await createSourceInstance({
        userId,
        name: instance.name,
        url: instance.url,
        username: instance.auth_type === "password" ? instanceCreds.username || "" : "",
        password: instance.auth_type === "password" ? instanceCreds.password || "" : "",
        apiKey: instance.auth_type === "apikey" ? instanceCreds.apiKey || null : null,
        authType: instance.auth_type || "apikey",
        ipAddress,
      });

      results.portainerInstances.push({ id, name: instance.name });
    } catch (error) {
      results.errors.push(
        `Portainer instance "${instance.name}": ${error.message || "Failed to import"}`
      );
    }
  }
}

// Docker Hub credentials import removed - use 'docker login' on server instead

/**
 * Import Discord webhooks from config
 * @param {Array} webhooks - Discord webhooks to import
 * @param {Object} credentials - Credentials object
 * @param {Object} user - User object
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
// eslint-disable-next-line complexity -- Discord webhook import requires multiple conditional checks
async function importDiscordWebhooks(webhooks, credentials, user, results) {
  for (const webhook of webhooks) {
    try {
      const webhookCreds = credentials?.discordWebhooks?.find((c) => c.id === webhook.id);
      if (!webhookCreds || !webhookCreds.webhookUrl) {
        results.errors.push(
          `Discord webhook "${webhook.server_name || webhook.id}": Missing webhook URL`
        );
        continue;
      }

      const id = await createDiscordWebhook({
        userId: user.id,
        webhookUrl: webhookCreds.webhookUrl,
        serverName: webhook.server_name,
        channelName: webhook.channel_name,
        enabled: webhook.enabled !== undefined ? webhook.enabled : true,
        name: webhook.name || "Docked",
        avatarUrl: webhook.avatar_url,
        guildId: webhook.guild_id,
        channelId: webhook.channel_id,
      });

      results.discordWebhooks.push({ id, serverName: webhook.server_name });
    } catch (error) {
      results.errors.push(
        `Discord webhook "${webhook.server_name || webhook.id}": ${error.message || "Failed to import"}`
      );
    }
  }
}

/**
 * Import tracked apps from config
 * @param {Array} apps - Tracked apps to import
 * @param {Object} user - User object
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
async function importTrackedApps(apps, user, results) {
  for (const image of apps) {
    try {
      const id = await createTrackedApp({
        userId: user.id,
        name: image.name,
        imageName: image.image_name,
        githubRepo: image.github_repo,
        sourceType: image.source_type || "docker",
        gitlabToken: image.gitlab_token || null,
      });

      const updateData = buildTrackedAppUpdateData(image);
      if (Object.keys(updateData).length > 0) {
        await updateTrackedApp(id, user.id, updateData);
      }

      results.trackedApps.push({ id, name: image.name });
    } catch (error) {
      results.errors.push(`Tracked image "${image.name}": ${error.message || "Failed to import"}`);
    }
  }
}

/**
 * Import Portainer instances by index (for user creation)
 * @param {Array} instances - Portainer instances to import
 * @param {Array} instanceCredsArray - Credentials array matching by index
 * @param {Object} user - User object
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
// eslint-disable-next-line complexity -- Portainer instance import requires multiple conditional checks
async function importPortainerInstancesByIndex(instances, instanceCredsArray, user, results) {
  const { resolveUrlToIp } = require("../utils/dnsResolver");

  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    const instanceCreds = instanceCredsArray[i];

    if (!instanceCreds) {
      results.errors.push(`Portainer instance "${instance.name}": Missing credentials`);
      continue;
    }

    try {
      const ipAddress = await resolveUrlToIp(instance.url);

      const id = await createSourceInstance({
        userId: user.id,
        name: instance.name,
        url: instance.url,
        username: instance.auth_type === "password" ? instanceCreds.username || "" : "",
        password: instance.auth_type === "password" ? instanceCreds.password || "" : "",
        apiKey: instance.auth_type === "apikey" ? instanceCreds.apiKey || null : null,
        authType: instance.auth_type || "apikey",
        ipAddress,
      });

      results.portainerInstances.push({ id, name: instance.name });
    } catch (error) {
      results.errors.push(
        `Portainer instance "${instance.name}": ${error.message || "Failed to import"}`
      );
    }
  }
}

/**
 * Import Discord webhooks by index (for user creation)
 * @param {Array} webhooks - Discord webhooks to import
 * @param {Array} webhookCredsArray - Credentials array matching by index
 * @param {Object} user - User object
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
async function importDiscordWebhooksByIndex(webhooks, webhookCredsArray, user, results) {
  for (let i = 0; i < webhooks.length; i++) {
    const webhook = webhooks[i];
    const webhookCreds = webhookCredsArray[i];

    if (!webhookCreds || !webhookCreds.webhookUrl) {
      results.errors.push(
        `Discord webhook "${webhook.server_name || webhook.id}": Missing webhook URL`
      );
      continue;
    }

    try {
      const id = await createDiscordWebhook({
        userId: user.id,
        webhookUrl: webhookCreds.webhookUrl,
        serverName: webhook.server_name,
        channelName: webhook.channel_name,
        enabled: webhook.enabled !== undefined ? webhook.enabled : true,
        name: webhook.name || "Docked",
        avatarUrl: webhook.avatar_url,
        guildId: webhook.guild_id,
        channelId: webhook.channel_id,
      });

      results.discordWebhooks.push({ id, serverName: webhook.server_name });
    } catch (error) {
      results.errors.push(
        `Discord webhook "${webhook.server_name || webhook.id}": ${error.message || "Failed to import"}`
      );
    }
  }
}

/**
 * Import general settings from config
 * @param {Object} generalSettings - General settings object
 * @param {Object} user - User object
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
async function importGeneralSettings(generalSettings, user, results) {
  const { colorScheme, logLevel, refreshingTogglesEnabled, batchConfig } = generalSettings;

  if (colorScheme) {
    await setSetting("color_scheme", colorScheme, user.id);
  }
  if (logLevel) {
    await setSystemSetting("log_level", logLevel);
  }
  if (refreshingTogglesEnabled !== undefined) {
    await setSetting("refreshing_toggles_enabled", refreshingTogglesEnabled.toString(), user.id);
  }
  if (batchConfig) {
    for (const [jobType, config] of Object.entries(batchConfig)) {
      await updateBatchConfig(user.id, jobType, config.enabled, config.intervalMinutes);
    }
  }

  results.generalSettings = { imported: true };
}

/**
 * Import user configuration from JSON
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

/**
 * Import users from JSON file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

/**
 * Create user with configuration in one operation
 * Used for importing users one at a time with their full configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Complex user creation with config import
async function createUserWithConfig(req, res, next) {
  try {
    const { userData, configData, credentials, skippedSteps = [], verificationToken } = req.body;

    if (!userData || !userData.username || !userData.password) {
      return res.status(400).json({
        success: false,
        error: "User data with username and password is required",
      });
    }

    const { username, password, email, role, instanceAdmin } = userData;

    // Validate username length
    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        error: `Username "${username}" must be at least 3 characters long`,
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: `Password for "${username}" must be at least 8 characters long`,
      });
    }

    // Validate email format if provided
    if (email && email.trim() !== "") {
      if (!isValidEmail(email.trim())) {
        return res.status(400).json({
          success: false,
          error: `Invalid email format for "${username}"`,
        });
      }
    }

    // Check if user already exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      // Return success with skipped flag to allow import to continue with other users
      return res.json({
        success: true,
        skipped: true,
        message: `User "${username}" already exists`,
      });
    }

    // Privilege-grant gate: this endpoint is public (bootstrap/import flow),
    // so instance-admin creation is only honored when the caller presents the
    // pending verification token the graph minted via generateInstanceAdminToken
    // and the operator echoed back through the import wizard. The token is
    // consumed atomically here, in the same statement that authorizes the
    // grant, so replays and concurrent attempts lose. Without a consumed
    // token there is no instance admin, period.
    if (instanceAdmin) {
      const consumed = verificationToken
        ? await consumePendingToken(username, verificationToken)
        : false;
      if (!consumed) {
        return res.status(403).json({
          success: false,
          error: "A valid verification token is required to create an instance admin",
        });
      }
    }

    // Create user
    await createUser(
      username,
      password,
      email || null,
      role || "Administrator",
      instanceAdmin || false
    );

    // Keep the verified token on the user row (it was already logged when
    // the graph generated it upfront)

    if (instanceAdmin) {
      await updateVerificationToken(username, verificationToken);
    }

    // Get the created user for importing webhooks
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(500).json({
        success: false,
        error: "Failed to retrieve created user",
      });
    }

    // Clear any leftover pending token for this username (the grant path
    // already consumed it; this covers non-admin imports)
    await clearPendingToken(username);

    // Import configuration if provided
    const results = {
      portainerInstances: [],
      dockerHubCredentials: null,
      discordWebhooks: [],
      trackedApps: [],
      errors: [],
    };

    if (configData && credentials) {
      if (
        configData.portainerInstances &&
        Array.isArray(configData.portainerInstances) &&
        !skippedSteps.includes("portainer") &&
        credentials.portainerInstances
      ) {
        await importPortainerInstancesByIndex(
          configData.portainerInstances,
          credentials.portainerInstances,
          user,
          results
        );
      }

      if (
        configData.dockerHubCredentials &&
        credentials.dockerHub &&
        !skippedSteps.includes("dockerhub")
      ) {
        // Docker Hub credential import removed - crane/skopeo use system Docker credentials
        // Users should run 'docker login' on the server if registry authentication is needed
        results.errors.push(
          "Docker Hub credential import is no longer supported. Use 'docker login' instead."
        );
      }

      if (
        configData.discordWebhooks &&
        Array.isArray(configData.discordWebhooks) &&
        !skippedSteps.includes("discord") &&
        credentials.discordWebhooks
      ) {
        await importDiscordWebhooksByIndex(
          configData.discordWebhooks,
          credentials.discordWebhooks,
          user,
          results
        );
      }
    }

    if (configData && configData.trackedApps && Array.isArray(configData.trackedApps)) {
      await importTrackedApps(configData.trackedApps, user, results);
    }

    if (configData && configData.generalSettings) {
      try {
        await importGeneralSettings(configData.generalSettings, user, results);
      } catch (error) {
        results.errors.push(`General settings: ${error.message || "Failed to import"}`);
      }
    }

    return res.json({
      success: true,
      message: `User "${username}" created successfully`,
      results,
      // Note: Verification token is NOT returned - it's only logged to server logs
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Export all users (admin only)
 * Exports all users in the same format as exportUserConfig but in a users array
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function -- Complex export logic with multiple data sources
async function exportUsersEndpoint(req, res, next) {
  try {
    // Only instance admins can export all users
    if (!req.user?.instanceAdmin) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const registryRepository = require("../repositories/RegistryRepository");
    const allUsers = await getAllUsers();

    // For each user, export their data in the same format as exportUserConfig
    // Since data is now per-user, we need to fetch it for each user
    const usersExport = await Promise.all(
      // eslint-disable-next-line max-lines-per-function -- Complex user data export logic
      allUsers.map(async (user) => {
        // Fetch user-specific data
        const [
          portainerInstances,
          dockerHubCredentials,
          discordWebhooks,
          trackedApps,
          batchConfig,
          colorScheme,
          logLevel,
          refreshingTogglesEnabled,
        ] = await Promise.all([
          getAllSourceInstances(user.id),
          registryRepository.getDockerHubCredentials(user.id),
          getAllDiscordWebhooks(user.id),
          getAllTrackedApps(user.id),
          getBatchConfig(user.id),
          getSetting("color_scheme", user.id),
          getSystemSetting("log_level"), // Log level is system-wide
          getSetting("refreshing_toggles_enabled", user.id),
        ]);

        return {
          user: {
            username: user.username,
            email: user.email || null,
            role: user.role || "Administrator",
            instance_admin: user.instanceAdmin,
            created_at: user.createdAt,
            updated_at: user.updatedAt,
          },
          portainerInstances: portainerInstances.map((instance) => ({
            id: instance.id,
            name: instance.name,
            url: instance.url,
            auth_type: instance.auth_type,
            display_order: instance.display_order,
            ip_address: instance.ip_address,
            created_at: instance.created_at,
            updated_at: instance.updated_at,
          })),
          dockerHubCredentials: dockerHubCredentials
            ? {
                username: dockerHubCredentials.username || null,
                token: dockerHubCredentials.token ? "***configured***" : null,
              }
            : null,
          discordWebhooks: discordWebhooks.map((webhook) => ({
            id: webhook.id,
            server_name: webhook.serverName || null,
            channel_name: webhook.channelName || null,
            avatar_url: webhook.avatarUrl || null,
            guild_id: webhook.guildId || null,
            channel_id: webhook.channelId || null,
            enabled: webhook.enabled,
            name: webhook.name || null,
            created_at: webhook.createdAt,
            updated_at: webhook.updatedAt,
          })),
          trackedApps: trackedApps.map((image) => ({
            id: image.id,
            name: image.name,
            image_name: image.image_name,
            github_repo: image.github_repo || null,
            source_type: image.source_type || "docker",
            gitlab_token: image.gitlab_token || null,
            current_version: image.current_version || null,
            current_digest: image.current_digest || null,
            latest_version: image.latest_version || null,
            latest_digest: image.latest_digest || null,
            has_update: image.has_update === 1,
            current_version_publish_date: image.current_version_publish_date || null,
            last_checked: image.last_checked || null,
            created_at: image.created_at,
            updated_at: image.updated_at,
          })),
          generalSettings: {
            colorScheme: colorScheme || "system",
            logLevel: logLevel || "info",
            refreshingTogglesEnabled:
              refreshingTogglesEnabled === "true" || refreshingTogglesEnabled === true,
            batchConfig,
          },
        };
      })
    );

    const exportData = {
      exportDate: new Date().toISOString(),
      users: usersExport,
    };

    return res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    logger.error("Error exporting users:", error);
    next(error);
  }
}

module.exports = {
  login,
  verifyToken,
  exportUserConfig,
  createUserWithConfig,
  exportUsersEndpoint,
};
