/**
 * Authentication Controller
 * Handles user authentication with database
 */

const axios = require("axios");
const { validateRequiredFields, isValidEmail } = require("../utils/validation");
const {
  getUserByUsername,
  verifyPassword,
  updatePassword,
  updateUsername,
  hasAnyUsers,
  createUser,
  getDockerHubCredentials,
  updateDockerHubCredentials,
  deleteDockerHubCredentials,
  getAllPortainerInstances,
  getAllDiscordWebhooks,
  getAllTrackedImages,
  getBatchConfig,
  getSetting,
  createPortainerInstance,
  createDiscordWebhook,
  createTrackedImage,
  updateTrackedImage,
  updateBatchConfig,
  setSetting,
} = require("../db/database");
const {
  validateRegistrationCode,
  clearRegistrationCode,
  isRegistrationCodeActive,
} = require("../utils/registrationCode");
const { clearCache } = require("../utils/dockerHubCreds");
const { generateToken, generateRefreshToken, verifyToken: verifyJWT } = require("../utils/jwt");
const fs = require("fs");
const path = require("path");

/**
 * Register endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function register(req, res, next) {
  try {
    const { username, password, confirmPassword, email, registrationCode } = req.body;

    // Validate input
    const validationError = validateRequiredFields({ username, password }, [
      "username",
      "password",
    ]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Check if this is the first user
    const isFirstUser = !(await hasAnyUsers());

    // If this is the first user, require registration code
    if (isFirstUser) {
      if (!registrationCode) {
        return res.status(400).json({
          success: false,
          error: "Registration code is required for the first user",
        });
      }

      if (!validateRegistrationCode(registrationCode)) {
        return res.status(401).json({
          success: false,
          error: "Invalid registration code",
        });
      }
    }

    // Validate password confirmation
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: "Passwords do not match",
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters long",
      });
    }

    // Validate username length
    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Username must be at least 3 characters long",
      });
    }

    // Validate email format if provided
    if (email && email.trim() !== "") {
      if (!isValidEmail(email.trim())) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        });
      }
    }

    // Check if user already exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Username already exists",
      });
    }

    // Create new user - mark as instance_admin if first user
    await createUser(
      username,
      password,
      email || null,
      "Administrator",
      true,
      isFirstUser // instance_admin = true for first user
    );

    // Clear registration code after first user is created
    if (isFirstUser) {
      clearRegistrationCode();
    }

    res.json({
      success: true,
      message: "User created successfully",
    });
  } catch (error) {
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "Username already exists",
      });
    }
    next(error);
  }
}

/**
 * Check if registration code is required
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function checkRegistrationCodeRequired(req, res, next) {
  try {
    const hasUsers = await hasAnyUsers();
    const codeActive = isRegistrationCodeActive();

    res.json({
      success: true,
      requiresCode: !hasUsers && codeActive,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Login endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
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

    res.json({
      success: true,
      token,
      refreshToken,
      username: user.username,
      role: user.role,
      passwordChanged: user.password_changed === 1,
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
      const { getUserById } = require("../db/database");
      const user = await getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: "User not found",
        });
      }

      res.json({
        success: true,
        username: user.username,
        role: user.role,
      });
    } catch (jwtError) {
      // Try legacy token format for backward compatibility
      try {
        const decoded = Buffer.from(token, "base64").toString("utf-8");
        const parts = decoded.split(":");
        const userId = parseInt(parts[0]);
        const username = parts[1];

        const { getUserById } = require("../db/database");
        const user = await getUserById(userId);
        if (!user) {
          const userByUsername = await getUserByUsername(username);
          if (!userByUsername) {
            return res.status(401).json({
              success: false,
              error: "Invalid token",
            });
          }
          return res.json({
            success: true,
            username: userByUsername.username,
            role: userByUsername.role,
          });
        }

        res.json({
          success: true,
          username: user.username,
          role: user.role,
        });
      } catch (legacyError) {
        return res.status(401).json({
          success: false,
          error: "Invalid token",
        });
      }
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Update password endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateUserPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const username = req.user?.username;

    if (!username) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Validate input
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: "New password is required",
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters long",
      });
    }

    // Get user
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // If password hasn't been changed (first login), currentPassword is optional
    // The session token proves authentication, so we don't need to verify the password again
    // Otherwise, verify current password for security
    if (user.password_changed === 1) {
      // Password has been changed before - require current password verification
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: "Current password is required",
        });
      }
      const passwordValid = await verifyPassword(currentPassword, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: "Current password is incorrect",
        });
      }
    }
    // First login - currentPassword is optional since the user just authenticated
    // If provided, we'll verify it, but it's not required
    else if (currentPassword) {
      // Optional verification if current password is provided
      const passwordValid = await verifyPassword(currentPassword, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: "Current password is incorrect",
        });
      }
    }

    // Update password and mark as changed
    await updatePassword(username, newPassword, true);

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get current user info
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getCurrentUser(req, res, next) {
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

    res.json({
      success: true,
      user: {
        username: user.username,
        role: user.role,
        passwordChanged: user.password_changed === 1,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update username endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateUserUsername(req, res, next) {
  try {
    const { newUsername, password } = req.body;
    const oldUsername = req.user?.username;

    if (!oldUsername) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Validate input
    if (!newUsername || newUsername.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "New username is required",
      });
    }

    if (newUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Username must be at least 3 characters long",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: "Password is required to change username",
      });
    }

    // Get user and verify password
    const user = await getUserByUsername(oldUsername);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: "Password is incorrect",
      });
    }

    // Check if new username already exists
    const existingUser = await getUserByUsername(newUsername.trim());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Username already exists",
      });
    }

    // Get user ID before updating username
    const userId = user.id;

    // Migrate avatar from old username directory to user ID directory before username change
    await migrateAvatarFromUsername(userId, oldUsername);

    // Update username in database
    await updateUsername(oldUsername, newUsername.trim());

    // Generate new JWT token with updated username but same user ID
    // This ensures authentication continues to work after username change
    const { generateToken, generateRefreshToken } = require("../utils/jwt");
    const newToken = generateToken({
      userId: userId,
      username: newUsername.trim(),
      role: user.role,
    });
    const newRefreshToken = generateRefreshToken({
      userId: userId,
      username: newUsername.trim(),
      role: user.role,
    });

    res.json({
      success: true,
      message: "Username updated successfully",
      newUsername: newUsername.trim(),
      token: newToken, // Return new token so frontend can update it
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Docker Hub credentials endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getDockerHubCreds(req, res, next) {
  try {
    const credentials = await getDockerHubCredentials();

    if (!credentials) {
      return res.json({
        success: true,
        credentials: null,
      });
    }

    // Return username but mask token for security
    res.json({
      success: true,
      credentials: {
        username: credentials.username,
        hasToken: !!credentials.token,
        updated_at: credentials.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Validate Docker Hub credentials without saving them
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function validateDockerHubCreds(req, res, next) {
  try {
    const { username, token } = req.body;

    // Validate input
    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Docker Hub username is required",
      });
    }

    if (!token || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Docker Hub personal access token is required",
      });
    }

    // Test authentication by making a request to Docker Hub auth API
    try {
      const authUrl = "https://auth.docker.io/token";
      const params = {
        service: "registry.docker.io",
        scope: "repository:library/alpine:pull", // Use a public repo for validation
      };

      const response = await axios.get(authUrl, {
        params,
        auth: {
          username: username.trim(),
          password: token.trim(),
        },
        timeout: 10000,
      });

      // If we get here, authentication succeeded
      res.json({
        success: true,
        message: "Docker Hub credentials validated successfully",
      });
    } catch (authError) {
      // Authentication failed
      if (authError.response?.status === 401) {
        return res.status(401).json({
          success: false,
          error: "Authentication failed. Please check your username and token.",
        });
      }
      // Other errors (network, timeout, etc.)
      return res.status(500).json({
        success: false,
        error: authError.message || "Failed to validate Docker Hub credentials. Please try again.",
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Update Docker Hub credentials endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateDockerHubCreds(req, res, next) {
  try {
    const { username, token } = req.body;

    // Validate input
    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Docker Hub username is required",
      });
    }

    // Get existing credentials if token is not provided
    let tokenToUse = token && token.trim().length > 0 ? token.trim() : null;

    if (!tokenToUse) {
      const existingCreds = await getDockerHubCredentials();
      if (!existingCreds || !existingCreds.token) {
        return res.status(400).json({
          success: false,
          error: "Docker Hub personal access token is required",
        });
      }
      // Use existing token
      tokenToUse = existingCreds.token;
    }

    // Update credentials
    await updateDockerHubCredentials(username.trim(), tokenToUse);

    // Clear cache so new credentials are used immediately
    clearCache();

    res.json({
      success: true,
      message: "Docker Hub credentials updated successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete Docker Hub credentials endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteDockerHubCreds(req, res, next) {
  try {
    await deleteDockerHubCredentials();

    // Clear cache so credentials are removed immediately
    clearCache();

    res.json({
      success: true,
      message: "Docker Hub credentials deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Migrate avatar from username-based directory to user ID-based directory
 * Called when username is updated to preserve avatar files
 * @param {number} userId - User ID
 * @param {string} oldUsername - Old username (for finding avatar directory)
 */
async function migrateAvatarFromUsername(userId, oldUsername) {
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

    const logger = require("../utils/logger");
    logger.info(
      `Migrated avatar from username directory (${oldUsername}) to user ID directory (${userId})`
    );
  } catch (err) {
    const logger = require("../utils/logger");
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
      dockerHubCreds,
      discordWebhooks,
      trackedImages,
      batchConfig,
      colorScheme,
      logLevel,
      refreshingTogglesEnabled,
    ] = await Promise.all([
      getAllPortainerInstances(),
      getDockerHubCredentials(),
      getAllDiscordWebhooks(),
      getAllTrackedImages(),
      getBatchConfig(),
      getSetting("color_scheme"),
      getSetting("log_level"),
      getSetting("refreshing_toggles_enabled"),
    ]);

    // Build export object
    const exportData = {
      exportDate: new Date().toISOString(),
      user: {
        username: user.username,
        role: user.role,
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
      dockerHubCredentials: dockerHubCreds
        ? {
            username: dockerHubCreds.username,
            created_at: dockerHubCreds.created_at,
            updated_at: dockerHubCreds.updated_at,
          }
        : null,
      discordWebhooks: discordWebhooks.map((webhook) => ({
        id: webhook.id,
        server_name: webhook.server_name,
        channel_name: webhook.channel_name,
        avatar_url: webhook.avatar_url,
        guild_id: webhook.guild_id,
        channel_id: webhook.channel_id,
        enabled: webhook.enabled === 1,
        created_at: webhook.created_at,
        updated_at: webhook.updated_at,
      })),
      trackedImages: trackedImages.map((image) => ({
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
        batchConfig: batchConfig,
      },
    };

    res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Import user configuration from JSON
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function importUserConfig(req, res, next) {
  try {
    const username = req.user?.username;
    const { configData, credentials, skippedSteps = [] } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (!configData) {
      return res.status(400).json({
        success: false,
        error: "Configuration data is required",
      });
    }

    // Check if user already exists (from imported config)
    if (configData.user) {
      const existingUser = await getUserByUsername(configData.user.username);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: `User "${configData.user.username}" already exists. Cannot import configuration for existing user.`,
        });
      }
    }

    const results = {
      portainerInstances: [],
      dockerHubCredentials: null,
      discordWebhooks: [],
      trackedImages: [],
      generalSettings: null,
      errors: [],
    };

    // Import Portainer instances (skip if in skippedSteps)
    if (
      configData.portainerInstances &&
      Array.isArray(configData.portainerInstances) &&
      !skippedSteps.includes("portainer")
    ) {
      for (const instance of configData.portainerInstances) {
        try {
          // Get credentials for this instance from the credentials object
          const instanceCreds = credentials?.portainerInstances?.find(
            (c) => c.url === instance.url
          );

          if (!instanceCreds) {
            results.errors.push(
              `Portainer instance "${instance.name}" (${instance.url}): Missing credentials`
            );
            continue;
          }

          const { resolveUrlToIp } = require("../utils/dnsResolver");
          const ipAddress = await resolveUrlToIp(instance.url);

          const id = await createPortainerInstance(
            instance.name,
            instance.url,
            instance.auth_type === "password" ? instanceCreds.username || "" : "",
            instance.auth_type === "password" ? instanceCreds.password || "" : "",
            instance.auth_type === "apikey" ? instanceCreds.apiKey || null : null,
            instance.auth_type || "apikey",
            ipAddress
          );

          results.portainerInstances.push({ id, name: instance.name });
        } catch (error) {
          results.errors.push(
            `Portainer instance "${instance.name}": ${error.message || "Failed to import"}`
          );
        }
      }
    }

    // Import Docker Hub credentials (skip if in skippedSteps)
    if (
      configData.dockerHubCredentials &&
      credentials?.dockerHub &&
      !skippedSteps.includes("dockerhub")
    ) {
      try {
        await updateDockerHubCredentials(
          credentials.dockerHub.username,
          credentials.dockerHub.token
        );
        results.dockerHubCredentials = { username: credentials.dockerHub.username };
      } catch (error) {
        results.errors.push(`Docker Hub credentials: ${error.message || "Failed to import"}`);
      }
    }

    // Import Discord webhooks (skip if in skippedSteps)
    if (
      configData.discordWebhooks &&
      Array.isArray(configData.discordWebhooks) &&
      !skippedSteps.includes("discord")
    ) {
      for (const webhook of configData.discordWebhooks) {
        try {
          // Get webhook URL from credentials
          const webhookCreds = credentials?.discordWebhooks?.find((c) => c.id === webhook.id);

          if (!webhookCreds || !webhookCreds.webhookUrl) {
            results.errors.push(
              `Discord webhook "${webhook.server_name || webhook.id}": Missing webhook URL`
            );
            continue;
          }

          const id = await createDiscordWebhook(
            webhookCreds.webhookUrl,
            webhook.server_name,
            webhook.channel_name,
            webhook.enabled !== undefined ? webhook.enabled : true,
            webhook.avatar_url,
            webhook.guild_id,
            webhook.channel_id
          );

          results.discordWebhooks.push({ id, serverName: webhook.server_name });
        } catch (error) {
          results.errors.push(
            `Discord webhook "${webhook.server_name || webhook.id}": ${error.message || "Failed to import"}`
          );
        }
      }
    }

    // Import tracked images
    if (configData.trackedImages && Array.isArray(configData.trackedImages)) {
      for (const image of configData.trackedImages) {
        try {
          const id = await createTrackedImage(
            image.name,
            image.image_name,
            image.github_repo,
            image.source_type || "docker",
            image.gitlab_token || null
          );

          // Update with version-related fields if they exist
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

          if (Object.keys(updateData).length > 0) {
            await updateTrackedImage(id, updateData);
          }

          results.trackedImages.push({ id, name: image.name });
        } catch (error) {
          results.errors.push(
            `Tracked image "${image.name}": ${error.message || "Failed to import"}`
          );
        }
      }
    }

    // Import general settings
    if (configData.generalSettings) {
      try {
        const { colorScheme, logLevel, refreshingTogglesEnabled, batchConfig } =
          configData.generalSettings;

        if (colorScheme) {
          await setSetting("color_scheme", colorScheme);
        }

        if (logLevel) {
          await setSetting("log_level", logLevel);
        }

        if (refreshingTogglesEnabled !== undefined) {
          await setSetting("refreshing_toggles_enabled", refreshingTogglesEnabled.toString());
        }

        if (batchConfig) {
          for (const [jobType, config] of Object.entries(batchConfig)) {
            await updateBatchConfig(jobType, config.enabled, config.intervalMinutes);
          }
        }

        results.generalSettings = { imported: true };
      } catch (error) {
        results.errors.push(`General settings: ${error.message || "Failed to import"}`);
      }
    }

    res.json({
      success: true,
      message: "Configuration imported successfully",
      results,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  verifyToken,
  updateUserPassword,
  updateUserUsername,
  getCurrentUser,
  getDockerHubCreds,
  validateDockerHubCreds,
  updateDockerHubCreds,
  deleteDockerHubCreds,
  exportUserConfig,
  importUserConfig,
  checkRegistrationCodeRequired,
};
