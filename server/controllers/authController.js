/**
 * Authentication Controller
 * Handles user authentication with database
 */

const axios = require('axios');
const { validateRequiredFields } = require('../utils/validation');
const {
  getUserByUsername,
  verifyPassword,
  updatePassword,
  updateUsername,
  getDockerHubCredentials,
  updateDockerHubCredentials,
  deleteDockerHubCredentials,
} = require('../db/database');
const { clearCache } = require('../utils/dockerHubCreds');
const { generateToken, generateRefreshToken, verifyToken: verifyJWT } = require('../utils/jwt');
const fs = require('fs');
const path = require('path');

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
    const validationError = validateRequiredFields(
      { username, password },
      ['username', 'password']
    );
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Get user from database
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
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
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    try {
      // Try JWT verification first
      const decoded = verifyJWT(token);
      
      // Verify user still exists
      const { getUserById } = require('../db/database');
      const user = await getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
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
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parts = decoded.split(':');
        const userId = parseInt(parts[0]);
        const username = parts[1];

        const { getUserById } = require('../db/database');
        const user = await getUserById(userId);
        if (!user) {
          const userByUsername = await getUserByUsername(username);
          if (!userByUsername) {
            return res.status(401).json({
              success: false,
              error: 'Invalid token',
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
          error: 'Invalid token',
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
        error: 'Authentication required',
      });
    }

    // Validate input
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password is required',
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long',
      });
    }

    // Get user
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // If password hasn't been changed (first login), currentPassword is required
    // Otherwise, verify current password
    if (user.password_changed === 1) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is required',
        });
      }
      const passwordValid = await verifyPassword(currentPassword, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
        });
      }
    } else {
      // First login - still require current password for security
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is required',
        });
      }
      const passwordValid = await verifyPassword(currentPassword, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
        });
      }
    }

    // Update password and mark as changed
    await updatePassword(username, newPassword, true);

    res.json({
      success: true,
      message: 'Password updated successfully',
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
        error: 'Authentication required',
      });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
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
        error: 'Authentication required',
      });
    }

    // Validate input
    if (!newUsername || newUsername.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'New username is required',
      });
    }

    if (newUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long',
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to change username',
      });
    }

    // Get user and verify password
    const user = await getUserByUsername(oldUsername);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Password is incorrect',
      });
    }

    // Check if new username already exists
    const existingUser = await getUserByUsername(newUsername.trim());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Username already exists',
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
    const { generateToken, generateRefreshToken } = require('../utils/jwt');
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
      message: 'Username updated successfully',
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
        error: 'Docker Hub username is required',
      });
    }

    if (!token || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Docker Hub personal access token is required',
      });
    }

    // Test authentication by making a request to Docker Hub auth API
    try {
      const authUrl = 'https://auth.docker.io/token';
      const params = {
        service: 'registry.docker.io',
        scope: 'repository:library/alpine:pull', // Use a public repo for validation
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
        message: 'Docker Hub credentials validated successfully',
      });
    } catch (authError) {
      // Authentication failed
      if (authError.response?.status === 401) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed. Please check your username and token.',
        });
      }
      // Other errors (network, timeout, etc.)
      return res.status(500).json({
        success: false,
        error: authError.message || 'Failed to validate Docker Hub credentials. Please try again.',
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
        error: 'Docker Hub username is required',
      });
    }

    // Get existing credentials if token is not provided
    let tokenToUse = token && token.trim().length > 0 ? token.trim() : null;
    
    if (!tokenToUse) {
      const existingCreds = await getDockerHubCredentials();
      if (!existingCreds || !existingCreds.token) {
        return res.status(400).json({
          success: false,
          error: 'Docker Hub personal access token is required',
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
      message: 'Docker Hub credentials updated successfully',
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
      message: 'Docker Hub credentials deleted successfully',
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
    const DATA_DIR = process.env.DATA_DIR || '/data';
    const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
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
    const oldAvatarPath = path.join(oldAvatarDir, 'avatar.jpg');
    if (fs.existsSync(oldAvatarPath)) {
      const newAvatarPath = path.join(newAvatarDir, 'avatar.jpg');
      fs.copyFileSync(oldAvatarPath, newAvatarPath);
    }
    
    // Copy recent avatars directory if it exists
    const oldRecentDir = path.join(oldAvatarDir, 'recent');
    if (fs.existsSync(oldRecentDir)) {
      const newRecentDir = path.join(newAvatarDir, 'recent');
      fs.mkdirSync(newRecentDir, { recursive: true });
      
      // Copy all recent avatar files
      const recentFiles = fs.readdirSync(oldRecentDir);
      recentFiles.forEach(file => {
        const oldFilePath = path.join(oldRecentDir, file);
        const newFilePath = path.join(newRecentDir, file);
        if (fs.statSync(oldFilePath).isFile() && file.endsWith('.jpg')) {
          fs.copyFileSync(oldFilePath, newFilePath);
        }
      });
    }
    
    console.log(`Migrated avatar from username directory (${oldUsername}) to user ID directory (${userId})`);
  } catch (err) {
    console.error('Error migrating avatar during username update:', err);
    // Don't throw - migration failure shouldn't break username update
  }
}

module.exports = {
  login,
  verifyToken,
  updateUserPassword,
  updateUserUsername,
  getCurrentUser,
  getDockerHubCreds,
  validateDockerHubCreds,
  updateDockerHubCreds,
  deleteDockerHubCreds,
};
