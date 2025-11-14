/**
 * Security Middleware
 * Additional security headers and protections
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Enhanced security headers middleware
 * Adds additional security headers beyond Helmet
 */
function securityHeaders(req, res, next) {
  // Remove server header (Helmet does this, but ensure it's gone)
  res.removeHeader('X-Powered-By');

  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Add Permissions Policy (formerly Feature Policy)
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );

  // Add Content Security Policy Report-Only in development
  if (process.env.NODE_ENV === 'development' && process.env.CSP_REPORT_ONLY === 'true') {
    res.setHeader(
      'Content-Security-Policy-Report-Only',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    );
  }

  next();
}

/**
 * Request size limiting middleware
 * Prevents excessively large request bodies
 */
function requestSizeLimiter(maxSize = '10mb') {
  return (req, res, next) => {
    const contentLength = req.get('content-length');
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength, 10);
      const maxSizeInBytes = parseSize(maxSize);

      if (sizeInBytes > maxSizeInBytes) {
        const { PayloadTooLargeError } = require('../domain/errors');
        return next(new PayloadTooLargeError(`Request body too large. Maximum size: ${maxSize}`));
      }
    }

    next();
  };
}

/**
 * Parse size string to bytes
 * @param {string} size - Size string (e.g., '10mb', '1kb')
 * @returns {number} - Size in bytes
 */
function parseSize(size) {
  const units = {
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  const match = size.toLowerCase().match(/^(\d+)(kb|mb|gb)$/);
  if (!match) {
    return 10 * 1024 * 1024; // Default 10MB
  }

  const [, value, unit] = match;
  return parseInt(value, 10) * units[unit];
}

/**
 * IP whitelist middleware (optional)
 * @param {Array<string>} allowedIPs - Array of allowed IP addresses
 */
function ipWhitelist(allowedIPs = []) {
  return (req, res, next) => {
    if (allowedIPs.length === 0) {
      return next(); // No whitelist configured
    }

    const clientIP = req.ip || req.connection?.remoteAddress || '';
    const isAllowed = allowedIPs.some(ip => {
      if (ip === clientIP) return true;
      // Support CIDR notation (basic)
      if (ip.includes('/')) {
        // Simple CIDR check (for production, use a proper CIDR library)
        return clientIP.startsWith(ip.split('/')[0].substring(0, ip.split('/')[0].lastIndexOf('.')));
      }
      return false;
    });

    if (!isAllowed) {
      const { ForbiddenError } = require('../domain/errors');
      return next(new ForbiddenError('IP address not allowed'));
    }

    next();
  };
}

/**
 * Rate limiting per user (if authenticated)
 */
function userRateLimit(options = {}) {
  const limiter = rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
    max: options.max || 100, // Limit each user to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use IP
      return req.user?.id ? `user:${req.user.id}` : req.ip;
    },
    skip: (req) => {
      // Skip for localhost in development
      if (process.env.NODE_ENV !== 'production') {
        const ip = req.ip || req.connection?.remoteAddress || '';
        return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
      }
      return false;
    },
  });

  return limiter;
}

module.exports = {
  securityHeaders,
  requestSizeLimiter,
  ipWhitelist,
  userRateLimit,
};

