/**
 * Avatar Controller
 * Handles avatar upload, retrieval, and management
 */

const fs = require('fs');
const path = require('path');
const { validateRequiredFields } = require('../utils/validation');

// Use DATA_DIR environment variable or default to /data
const DATA_DIR = process.env.DATA_DIR || '/data';
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

// Ensure avatars directory exists
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  console.log(`Created avatars directory: ${AVATARS_DIR}`);
}

/**
 * Get user's avatar
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getAvatar(req, res, next) {
  try {
    const username = req.user.username;
    const avatarPath = path.join(AVATARS_DIR, username, 'avatar.jpg');
    
    if (fs.existsSync(avatarPath)) {
      // Return the avatar file
      res.sendFile(avatarPath);
    } else {
      // Return 404 if no avatar exists
      res.status(404).json({
        success: false,
        error: 'Avatar not found'
      });
    }
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
    const username = req.user.username;
    const recentAvatarsDir = path.join(AVATARS_DIR, username, 'recent');
    
    if (!fs.existsSync(recentAvatarsDir)) {
      return res.json({
        success: true,
        avatars: []
      });
    }
    
    // Get all avatar files, sorted by modification time (newest first)
    const files = fs.readdirSync(recentAvatarsDir)
      .filter(file => file.endsWith('.jpg'))
      .map(file => {
        const filePath = path.join(recentAvatarsDir, file);
        return {
          filename: file,
          path: filePath,
          mtime: fs.statSync(filePath).mtime
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3) // Keep only 3 most recent
      .map(file => `/api/avatars/recent/${file.filename}`);
    
    res.json({
      success: true,
      avatars: files
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
    const username = req.user.username;
    const filename = req.params.filename;
    
    // Security: ensure filename is safe (only alphanumeric, dash, underscore)
    if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }
    
    const avatarPath = path.join(AVATARS_DIR, username, 'recent', filename);
    
    if (fs.existsSync(avatarPath)) {
      res.sendFile(avatarPath);
    } else {
      res.status(404).json({
        success: false,
        error: 'Avatar not found'
      });
    }
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
async function uploadAvatar(req, res, next) {
  try {
    const username = req.user.username;
    const { avatar } = req.body; // Base64 encoded image
    
    if (!avatar) {
      return res.status(400).json({
        success: false,
        error: 'Avatar data is required'
      });
    }
    
    // Validate base64 image
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid image format'
      });
    }
    
    // Extract base64 data
    const base64Data = avatar.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Ensure user's avatar directory exists
    const userAvatarDir = path.join(AVATARS_DIR, username);
    const recentAvatarsDir = path.join(userAvatarDir, 'recent');
    
    if (!fs.existsSync(userAvatarDir)) {
      fs.mkdirSync(userAvatarDir, { recursive: true });
    }
    if (!fs.existsSync(recentAvatarsDir)) {
      fs.mkdirSync(recentAvatarsDir, { recursive: true });
    }
    
    // Save main avatar
    const avatarPath = path.join(userAvatarDir, 'avatar.jpg');
    fs.writeFileSync(avatarPath, buffer);
    
    // Save to recent avatars with timestamp
    const timestamp = Date.now();
    const recentAvatarPath = path.join(recentAvatarsDir, `${timestamp}.jpg`);
    fs.writeFileSync(recentAvatarPath, buffer);
    
    // Clean up old recent avatars (keep only 3 most recent)
    const recentFiles = fs.readdirSync(recentAvatarsDir)
      .filter(file => file.endsWith('.jpg'))
      .map(file => {
        const filePath = path.join(recentAvatarsDir, file);
        return {
          filename: file,
          path: filePath,
          mtime: fs.statSync(filePath).mtime
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    
    // Delete files beyond the 3 most recent
    if (recentFiles.length > 3) {
      recentFiles.slice(3).forEach(file => {
        fs.unlinkSync(file.path);
      });
    }
    
    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl: `/api/avatars`,
      recentAvatars: recentFiles.slice(0, 3).map(file => 
        `/api/avatars/recent/${file.filename}`
      )
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
async function setCurrentAvatar(req, res, next) {
  try {
    const username = req.user.username;
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Filename is required'
      });
    }
    
    // Security: ensure filename is safe
    if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }
    
    const recentAvatarPath = path.join(AVATARS_DIR, username, 'recent', filename);
    const currentAvatarPath = path.join(AVATARS_DIR, username, 'avatar.jpg');
    
    if (!fs.existsSync(recentAvatarPath)) {
      return res.status(404).json({
        success: false,
        error: 'Avatar not found'
      });
    }
    
    // Copy recent avatar to current avatar
    fs.copyFileSync(recentAvatarPath, currentAvatarPath);
    
    res.json({
      success: true,
      message: 'Avatar set as current',
      avatarUrl: `/api/avatars`
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
async function deleteAvatar(req, res, next) {
  try {
    const username = req.user.username;
    const avatarPath = path.join(AVATARS_DIR, username, 'avatar.jpg');
    
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }
    
    res.json({
      success: true,
      message: 'Avatar deleted successfully'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAvatar,
  getRecentAvatars,
  getRecentAvatar,
  uploadAvatar,
  setCurrentAvatar,
  deleteAvatar
};

