/**
 * Authentication Middleware
 * Verifies JWT tokens and protects routes
 * Supports backward compatibility with legacy base64 tokens
 */

const { getUserByUsername, getUserById } = require("../db/index");
const { verifyToken } = require("../utils/jwt");

/**
 * Middleware to verify authentication token
 * Supports both JWT tokens (new) and base64 tokens (legacy)
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
      // Try JWT verification first (new tokens)
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

        // Store user info in request
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          instanceAdmin: user.instance_admin === 1,
        };

        return next();
      } catch (jwtError) {
        // If JWT verification fails, try legacy base64 token format
        // This provides backward compatibility during migration
        if (jwtError.message === "Token expired" || jwtError.message === "Invalid token") {
          // Try legacy token format
          try {
            const decoded = Buffer.from(token, "base64").toString("utf-8");
            const parts = decoded.split(":");

            if (parts.length >= 2) {
              const userId = parseInt(parts[0]);
              const username = parts[1];

              // Look up user by ID (more resilient to username changes)
              const user = await getUserById(userId);
              if (!user) {
                // Fallback to username lookup for old tokens
                const userByUsername = await getUserByUsername(username);
                if (!userByUsername) {
                  return res.status(401).json({
                    success: false,
                    error: "Invalid token",
                  });
                }
                req.user = {
                  id: userByUsername.id,
                  username: userByUsername.username,
                  role: userByUsername.role,
                  instanceAdmin: userByUsername.instance_admin === 1,
                };
                return next();
              }

              req.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                instanceAdmin: user.instance_admin === 1,
              };
              return next();
            }
          } catch (legacyError) {
            // Both JWT and legacy token failed
            return res.status(401).json({
              success: false,
              error: "Invalid token",
            });
          }
        }

        // Re-throw JWT errors that aren't about invalid/expired tokens
        throw jwtError;
      }
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: err.message || "Invalid token",
      });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticate,
};
