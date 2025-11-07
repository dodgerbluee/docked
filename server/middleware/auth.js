/**
 * Authentication Middleware
 * Verifies tokens and protects routes
 */

const { getUserByUsername } = require('../db/database');

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
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const [username] = decoded.split(':');

      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token',
        });
      }

      // Store user info in request for use in controllers
      req.user = { username: user.username, role: user.role };

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
