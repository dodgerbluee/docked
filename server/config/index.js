/**
 * Application configuration
 * Centralizes all environment variables and configuration settings
 */

require("dotenv").config({ quiet: true });

/**
 * Checks if the request is from localhost
 * @param {Object} req - Express request object
 * @returns {boolean} - True if request is from localhost
 */
function checkIsLocalhost(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  const hostname = req.hostname || req.get("host") || "";
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "::ffff:127.0.0.1" ||
    hostname.includes("localhost") ||
    hostname.includes("127.0.0.1")
  );
}

const config = {
  port: process.env.PORT || 3001,
  portainer: {
    urls: (process.env.PORTAINER_URL || process.env.PORTAINER_URLS || "http://localhost:9000")
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0),
    username: process.env.PORTAINER_USERNAME || "admin",
    password: process.env.PORTAINER_PASSWORD ? String(process.env.PORTAINER_PASSWORD) : "",
  },
  cache: {
    digestCacheTTL: 24 * 60 * 60 * 1000, // 24 hours
  },
  rateLimit: {
    // Increased delay to avoid 429 errors
    // Anonymous: 100 pulls/6hr, Authenticated: 200 pulls/6hr
    // Use longer delay if not authenticated to avoid hitting limits
    // Note: Docker Hub credentials are now managed through the Settings UI.
    // The delay is dynamically adjusted in dockerRegistryService based on actual credentials availability
    dockerHubDelay: 1000, // Default delay for anonymous (authenticated uses 500ms)
    api: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      // More lenient in development to avoid blocking legitimate requests
      max: process.env.NODE_ENV === "production" ? 100 : 1000, // Limit each IP to 100 requests per windowMs (production) or 1000 (development)
      message: "Too many requests from this IP, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for localhost (IPv4, IPv6, or hostname)
      skip: (req) => {
        const isLocalhost = checkIsLocalhost(req);
        // Skip in development OR if accessing via localhost (even in production mode)
        return process.env.NODE_ENV !== "production" || isLocalhost;
      },
    },
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      // More lenient to allow for legitimate login attempts, retries, and page refreshes
      max: process.env.NODE_ENV === "production" ? 20 : 50, // Limit each IP to 20 login attempts per windowMs (production) or 50 (development)
      message: "Too many login attempts, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for localhost (IPv4, IPv6, or hostname)
      skip: (req) => {
        const isLocalhost = checkIsLocalhost(req);
        // Skip in development OR if accessing via localhost (even in production mode)
        return process.env.NODE_ENV !== "production" || isLocalhost;
      },
      // Use a custom key generator that works better with proxies
      keyGenerator: (req) =>
        // Use the real IP from req.ip (which respects trust proxy setting)
        // Fallback to connection remoteAddress if req.ip is not set
        req.ip || req.connection?.remoteAddress || "unknown",
    },
  },
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
  },
  jwt: {
    secret: process.env.JWT_SECRET || "change-this-secret-in-production-use-strong-random-string",
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
  oauth: {
    enabled: !!process.env.OAUTH_PROVIDER,
    provider: process.env.OAUTH_PROVIDER || null,
    clientId: process.env.OAUTH_CLIENT_ID || null,
    clientSecret: process.env.OAUTH_CLIENT_SECRET || null,
    issuerUrl: process.env.OAUTH_ISSUER_URL || null,
    scopes: (process.env.OAUTH_SCOPES || "openid,profile,email")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    autoRegister: process.env.OAUTH_AUTO_REGISTER !== "false",
    defaultRole: process.env.OAUTH_DEFAULT_ROLE || "Administrator",
    allowLocalLogin: process.env.OAUTH_ALLOW_LOCAL_LOGIN !== "false",
  },
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
      : process.env.NODE_ENV === "production"
        ? false // Deny all cross-origin requests if CORS_ORIGIN is not configured
        : [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
            "http://127.0.0.1:3002",
          ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
};

module.exports = config;
