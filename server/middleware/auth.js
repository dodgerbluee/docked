/**
 * Authentication Middleware
 * Verifies JWT tokens and protects routes
 */

const { getUserById } = require("../db/index");
const { verifyToken } = require("../utils/jwt");

/**
 * Middleware to verify authentication token (JWT only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    try {
      const decoded = verifyToken(token);

      // Verify user still exists
      const user = await getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: "User not found",
        });
      }

      // eslint-disable-next-line require-atomic-updates -- Express middleware pattern requires setting req.user
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        instanceAdmin: user.instance_admin === 1,
      };

      return next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: err.message === "Token expired" ? "Token expired" : "Invalid token",
      });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticate,
};
