/**
 * Authentication Middleware
 * Verifies JWT tokens and protects routes
 * Supports backward compatibility with legacy base64 tokens
 */

const container = require('../di/container');
const { verifyToken } = require('../utils/jwt');
const { AuthenticationError } = require('../domain/errors');

// Resolve user repository (lazy to avoid startup crashes)
let userRepository;

function getUserRepository() {
  if (!userRepository) {
    try {
      userRepository = container.resolve('userRepository');
    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to resolve userRepository', { error });
      throw error;
    }
  }
  return userRepository;
}

/**
 * Middleware to verify authentication token
 * Supports both JWT tokens (new) and base64 tokens (legacy)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticate(req, res, next) {
  const logger = require('../utils/logger');
  
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (!authHeader) {
      logger.info('Authentication failed: No Authorization header', {
        module: 'auth',
        path: req.path,
        headers: Object.keys(req.headers),
      });
      throw new AuthenticationError('Authentication required');
    }

    // Extract token - handle both 'Bearer token' and just 'token' formats
    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    } else {
      token = authHeader; // Assume the whole header is the token
    }

    // Validate token is not empty or undefined
    if (!token || token === 'undefined' || token.trim().length === 0) {
      logger.info('Authentication failed: Invalid token format', {
        module: 'auth',
        path: req.path,
        authHeaderLength: authHeader ? authHeader.length : 0,
        tokenLength: token ? token.length : 0,
        tokenPrefix: token ? token.substring(0, 20) : 'none',
      });
      throw new AuthenticationError('Authentication required');
    }

    try {
      // Try JWT verification first (new tokens)
      try {
        const decoded = verifyToken(token);
        
        if (!decoded || !decoded.userId) {
          logger.warn('JWT token missing userId', {
            module: 'auth',
            decoded: decoded ? Object.keys(decoded) : null,
            path: req.path,
          });
          throw new AuthenticationError('Invalid token payload');
        }
        
        // Verify user still exists
        let user;
        try {
          user = await getUserRepository().findById(decoded.userId);
        } catch (repoError) {
          logger.error('Error fetching user from repository', {
            module: 'auth',
            userId: decoded.userId,
            error: repoError.message,
            stack: repoError.stack,
            path: req.path,
          });
          throw new AuthenticationError('Authentication service error');
        }
        
        if (!user) {
          logger.warn('User not found for token', {
            module: 'auth',
            userId: decoded.userId,
            path: req.path,
          });
          throw new AuthenticationError('User not found');
        }

        // Store user info in request
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
        };

        return next();
      } catch (jwtError) {
        // Log JWT errors for debugging
        if (jwtError instanceof AuthenticationError) {
          logger.info('JWT authentication failed', {
            module: 'auth',
            error: jwtError.message,
            path: req.path,
          });
        } else {
          // Log full error details for debugging (not redacted)
          logger.info('JWT verification error', {
            module: 'auth',
            error: jwtError.message,
            name: jwtError.name,
            path: req.path,
            errorDetails: {
              message: jwtError.message,
              name: jwtError.name,
              stack: process.env.NODE_ENV === 'development' ? jwtError.stack : undefined,
            },
          });
        }
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
              const user = await getUserRepository().findById(userId);
              if (!user) {
                // Fallback to username lookup for old tokens
                const userByUsername = await getUserRepository().findByUsername(username);
                if (!userByUsername) {
                  throw new AuthenticationError('Invalid token');
                }
                req.user = {
                  id: userByUsername.id,
                  username: userByUsername.username,
                  role: userByUsername.role,
                };
                return next();
              }

              req.user = {
                id: user.id,
                username: user.username,
                role: user.role,
              };
              return next();
            }
          } catch (legacyError) {
            // Both JWT and legacy token failed
            throw new AuthenticationError('Invalid token');
          }
        }

        // Re-throw JWT errors that aren't about invalid/expired tokens
        throw jwtError;
      }
    } catch (err) {
      // Log the error for debugging
      logger.info('Authentication error', {
        module: 'auth',
        error: err.message,
        name: err.name,
        path: req.path,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
      
      // If it's already an AuthenticationError, re-throw it
      if (err instanceof AuthenticationError) {
        throw err;
      }
      // Otherwise, wrap it
      throw new AuthenticationError(err.message || 'Invalid token');
    }
  } catch (error) {
    // Log final error before passing to error handler
    logger.info('Authentication middleware error', {
      module: 'auth',
      error: error.message,
      name: error.name,
      path: req.path,
    });
    next(error);
  }
}

module.exports = {
  authenticate,
};
