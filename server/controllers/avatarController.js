/**
 * Avatar Controller
 * Handles avatar upload, retrieval, and management
 */

const fs = require("fs");
const path = require("path");
// const { validateRequiredFields } = require("../utils/validation"); // Unused
const logger = require("../utils/logger");

// Use DATA_DIR environment variable or default to /data
const DATA_DIR = process.env.DATA_DIR || "/data";
const AVATARS_DIR = path.join(DATA_DIR, "avatars");

// Ensure avatars directory exists
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  logger.info(`Created avatars directory: ${AVATARS_DIR}`);
}

/**
 * Get user's avatar
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getAvatar(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const avatarPath = path.join(AVATARS_DIR, userId.toString(), "avatar.jpg");

    // If avatar doesn't exist in user ID directory, try migrating from username directory
    if (!fs.existsSync(avatarPath)) {
      await migrateAvatarFromUsername(userId, req.user.username);
    }
    if (fs.existsSync(avatarPath)) {
      // Return the avatar file
      return res.sendFile(avatarPath);
    }
    // Return default avatar instead of 404
    // This prevents frontend errors when avatar doesn't exist
    // Try multiple possible locations for default avatar
    const possibleDefaultPaths = [
      path.join(__dirname, "../../client/public/img/default-avatar.jpg"),
      path.join(__dirname, "../../public/img/default-avatar.jpg"),
      path.join(process.cwd(), "client/public/img/default-avatar.jpg"),
      path.join(process.cwd(), "public/img/default-avatar.jpg"),
    ];

    for (const defaultPath of possibleDefaultPaths) {
      if (fs.existsSync(defaultPath)) {
        return res.sendFile(defaultPath);
      }
    }

    // If no default avatar found, return 204 No Content
    // Frontend will handle this and use its own default
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * Get user's recent avatars
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getRecentAvatars(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const recentAvatarsDir = path.join(AVATARS_DIR, userId.toString(), "recent");

    // If directory doesn't exist, try migrating from username directory
    if (!fs.existsSync(recentAvatarsDir)) {
      await migrateAvatarFromUsername(userId, req.user.username);
    }
    if (!fs.existsSync(recentAvatarsDir)) {
      return res.json({
        success: true,
        avatars: [],
      });
    }

    // Get all avatar files, sorted by modification time (newest first)
    const files = fs
      .readdirSync(recentAvatarsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => {
        const filePath = path.join(recentAvatarsDir, file);
        return {
          filename: file,
          path: filePath,
          mtime: fs.statSync(filePath).mtime,
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3) // Keep only 3 most recent
      .map((file) => `/api/avatars/recent/${file.filename}`);

    return res.json({
      success: true,
      avatars: files,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get a recent avatar file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getRecentAvatar(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const { filename } = req.params;

    // Security: ensure filename is safe (only alphanumeric, dash, underscore)
    if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      return res.status(400).json({
        success: false,
        error: "Invalid filename",
      });
    }

    // Security: Validate userId is a valid number
    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum) || userIdNum <= 0 || userIdNum.toString() !== userId.toString()) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID",
      });
    }

    // Security: Construct path and verify it's within AVATARS_DIR to prevent path traversal
    const userDir = path.join(AVATARS_DIR, userIdNum.toString());
    const avatarPath = path.join(userDir, "recent", filename);

    // Resolve to absolute path and verify it's within AVATARS_DIR
    const resolvedPath = path.resolve(avatarPath);
    const resolvedAvatarsDir = path.resolve(AVATARS_DIR);

    // Ensure the resolved path is within AVATARS_DIR (prevents ../ attacks)
    if (
      !resolvedPath.startsWith(resolvedAvatarsDir + path.sep) &&
      resolvedPath !== resolvedAvatarsDir
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid path",
      });
    }

    // Use resolvedPath (validated and safe) instead of avatarPath for file operations
    // If avatar doesn't exist, try migrating from username directory
    if (!fs.existsSync(resolvedPath)) {
      await migrateAvatarFromUsername(userId, req.user.username);
      // Re-check after migration
      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({
          success: false,
          error: "Avatar not found",
        });
      }
    }
    if (fs.existsSync(resolvedPath)) {
      return res.sendFile(resolvedPath);
    }
    return res.status(404).json({
      success: false,
      error: "Avatar not found",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Upload avatar
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function -- Complex avatar upload logic with validation
function uploadAvatar(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const { avatar } = req.body; // Base64 encoded image

    if (!avatar) {
      return res.status(400).json({
        success: false,
        error: "Avatar data is required",
      });
    }

    // Validate base64 image
    if (!avatar.startsWith("data:image/")) {
      return res.status(400).json({
        success: false,
        error: "Invalid image format",
      });
    }

    // Extract base64 data
    const base64Data = avatar.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Ensure user's avatar directory exists (using user ID)
    const userAvatarDir = path.join(AVATARS_DIR, userId.toString());
    const recentAvatarsDir = path.join(userAvatarDir, "recent");
    if (!fs.existsSync(userAvatarDir)) {
      fs.mkdirSync(userAvatarDir, { recursive: true });
    }
    if (!fs.existsSync(recentAvatarsDir)) {
      fs.mkdirSync(recentAvatarsDir, { recursive: true });
    }

    // Save main avatar
    const avatarPath = path.join(userAvatarDir, "avatar.jpg");
    fs.writeFileSync(avatarPath, buffer);

    // Save to recent avatars with timestamp
    const timestamp = Date.now();
    const recentAvatarPath = path.join(recentAvatarsDir, `${timestamp}.jpg`);
    fs.writeFileSync(recentAvatarPath, buffer);

    // Clean up old recent avatars (keep only 3 most recent)
    const recentFiles = fs
      .readdirSync(recentAvatarsDir)
      .filter((file) => file.endsWith(".jpg"))
      .map((file) => {
        const filePath = path.join(recentAvatarsDir, file);
        return {
          filename: file,
          path: filePath,
          mtime: fs.statSync(filePath).mtime,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // Delete files beyond the 3 most recent
    if (recentFiles.length > 3) {
      recentFiles.slice(3).forEach((file) => {
        fs.unlinkSync(file.path);
      });
    }

    return res.json({
      success: true,
      message: "Avatar uploaded successfully",
      avatarUrl: `/api/avatars`,
      recentAvatars: recentFiles.slice(0, 3).map((file) => `/api/avatars/recent/${file.filename}`),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Set a recent avatar as current
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function setCurrentAvatar(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Filename is required",
      });
    }

    // Security: ensure filename is safe
    if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      return res.status(400).json({
        success: false,
        error: "Invalid filename",
      });
    }

    const recentAvatarPath = path.join(AVATARS_DIR, userId.toString(), "recent", filename);
    const currentAvatarPath = path.join(AVATARS_DIR, userId.toString(), "avatar.jpg");
    if (!fs.existsSync(recentAvatarPath)) {
      return res.status(404).json({
        success: false,
        error: "Avatar not found",
      });
    }

    // Copy recent avatar to current avatar
    fs.copyFileSync(recentAvatarPath, currentAvatarPath);

    return res.json({
      success: true,
      message: "Avatar set as current",
      avatarUrl: `/api/avatars`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete avatar
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function deleteAvatar(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID not found",
      });
    }

    const avatarPath = path.join(AVATARS_DIR, userId.toString(), "avatar.jpg");
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    return res.json({
      success: true,
      message: "Avatar deleted successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get another user's avatar (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function getAvatarByUserId(req, res, next) {
  try {
    // Only instance admins can view other users' avatars
    if (!req.user?.instanceAdmin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
      });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Security: Validate userId is a valid number and doesn't contain path traversal
    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum) || userIdNum <= 0 || userIdNum.toString() !== userId) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID",
      });
    }

    // Security: Construct path and verify it's within AVATARS_DIR to prevent path traversal
    const userDir = path.join(AVATARS_DIR, userIdNum.toString());
    const avatarPath = path.join(userDir, "avatar.jpg");

    // Resolve to absolute path and verify it's within AVATARS_DIR
    const resolvedPath = path.resolve(avatarPath);
    const resolvedAvatarsDir = path.resolve(AVATARS_DIR);

    // Ensure the resolved path is within AVATARS_DIR (prevents ../ attacks)
    if (
      !resolvedPath.startsWith(resolvedAvatarsDir + path.sep) &&
      resolvedPath !== resolvedAvatarsDir
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid path",
      });
    }

    if (fs.existsSync(avatarPath)) {
      return res.sendFile(avatarPath);
    }
    // Return default avatar instead of 404
    const possibleDefaultPaths = [
      path.join(__dirname, "../../client/public/img/default-avatar.jpg"),
      path.join(__dirname, "../../public/img/default-avatar.jpg"),
      path.join(process.cwd(), "client/public/img/default-avatar.jpg"),
      path.join(process.cwd(), "public/img/default-avatar.jpg"),
    ];

    for (const defaultPath of possibleDefaultPaths) {
      if (fs.existsSync(defaultPath)) {
        return res.sendFile(defaultPath);
      }
    }

    return res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * Migrate avatar from username-based directory to user ID-based directory
 * This is a one-time migration when a user's avatar is accessed after username change
 * @param {number} userId - User ID
 * @param {string} username - Current username (for finding old directory)
 */
function migrateAvatarFromUsername(userId, username) {
  try {
    // Security: Validate username doesn't contain path traversal
    if (!username || typeof username !== "string") {
      return;
    }

    // Security: Validate username is safe (alphanumeric, dash, underscore only)
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      logger.warn(`Skipping avatar migration for unsafe username: ${username}`);
      return;
    }

    const oldAvatarDir = path.join(AVATARS_DIR, username);
    const newAvatarDir = path.join(AVATARS_DIR, userId.toString());

    // Security: Verify paths are within AVATARS_DIR
    const resolvedOldDir = path.resolve(oldAvatarDir);
    const resolvedNewDir = path.resolve(newAvatarDir);
    const resolvedAvatarsDir = path.resolve(AVATARS_DIR);

    if (
      !resolvedOldDir.startsWith(resolvedAvatarsDir + path.sep) &&
      resolvedOldDir !== resolvedAvatarsDir
    ) {
      logger.warn(`Skipping avatar migration - old path outside AVATARS_DIR: ${resolvedOldDir}`);
      return;
    }

    if (
      !resolvedNewDir.startsWith(resolvedAvatarsDir + path.sep) &&
      resolvedNewDir !== resolvedAvatarsDir
    ) {
      logger.warn(`Skipping avatar migration - new path outside AVATARS_DIR: ${resolvedNewDir}`);
      return;
    }

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
      `Migrated avatar from username directory (${username}) to user ID directory (${userId})`
    );
  } catch (err) {
    logger.error("Error migrating avatar:", err);
    // Don't throw - migration failure shouldn't break the request
  }
}

module.exports = {
  getAvatar,
  getAvatarByUserId,
  getRecentAvatars,
  getRecentAvatar,
  uploadAvatar,
  setCurrentAvatar,
  deleteAvatar,
};
