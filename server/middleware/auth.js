/**
 * Authentication Middleware
 * Verifies tokens and protects routes
 */

const { getUserByUsername, getUserById } = require('../db/database');

/**
 * Middleware to verify authentication token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Simple token verification (in production, use JWT)
    // Token format: userId:username:timestamp (base64 encoded)
    // Use user ID for authentication to allow username changes
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      const userId = parseInt(parts[0]);
      const username = parts[1]; // Keep for backwards compatibility, but use ID for lookup

      // Look up user by ID (more resilient to username changes)
      const user = await getUserById(userId);
      if (!user) {
        // Fallback to username lookup for old tokens
        const userByUsername = await getUserByUsername(username);
        if (!userByUsername) {
          return res.status(401).json({
            success: false,
            error: 'Invalid token',
          });
        }
        // Store user info in request for use in controllers
        req.user = { id: userByUsername.id, username: userByUsername.username, role: userByUsername.role };
        next();
        return;
      }

      // Store user info in request for use in controllers
      req.user = { id: user.id, username: user.username, role: user.role };

      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticate,
};
