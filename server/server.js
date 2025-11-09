/**
 * Main server file
 * Sets up Express app and middleware
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
const config = require("./config");
const routes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const swaggerSpec = require("./config/swagger");

const app = express();

// Trust proxy - required when running behind a reverse proxy (Docker, nginx, etc.)
// This allows Express to correctly identify the client IP from X-Forwarded-For headers
app.set('trust proxy', true);

// Security middleware configuration - must be defined before middleware
// Note: CSP disabled on localhost and in development for Safari compatibility
// In production with HTTPS, CSP allows blob: URLs for images to support avatar functionality
// Disable CSP entirely when:
// 1. Running in development mode, OR
// 2. Explicitly disabled via DISABLE_CSP env var, OR
// 3. Running on any localhost port without HTTPS (for Safari compatibility)
const isHTTPS =
  process.env.HTTPS === "true" || process.env.PROTOCOL === "https";
// Consider any port < 10000 as localhost development (3001, 3002, 3000, etc.)
const isLocalhost = config.port < 10000 && !isHTTPS;
const shouldDisableCSP =
  process.env.NODE_ENV !== "production" ||
  process.env.DISABLE_CSP === "true" ||
  isLocalhost;

// Explicitly remove HSTS header for localhost to fix Safari caching issues
// This must come BEFORE helmet to ensure HSTS is not set
app.use((req, res, next) => {
  if (!isHTTPS) {
    // Remove any HSTS headers that might be set
    res.removeHeader("Strict-Transport-Security");
    // Prevent caching of security headers
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: shouldDisableCSP
      ? false // Disable CSP on localhost/development for Safari compatibility
      : {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:", "blob:"], // Allow blob URLs for avatar images
            connectSrc: ["'self'"], // Safari doesn't support blob: in connectSrc
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            // Only upgrade to HTTPS if we're actually serving over HTTPS
            ...(isHTTPS ? { upgradeInsecureRequests: [] } : {}),
          },
        },
    // Disable HSTS (HTTP Strict Transport Security) when not using HTTPS
    // HSTS forces browsers to always use HTTPS, which breaks localhost development
    strictTransportSecurity: isHTTPS
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false,
        }
      : false,
    crossOriginEmbedderPolicy: false, // Allow embedding for development
    crossOriginResourcePolicy: shouldDisableCSP
      ? false
      : process.env.NODE_ENV === "production"
      ? { policy: "same-origin" }
      : false,
    crossOriginOpenerPolicy: shouldDisableCSP
      ? false
      : process.env.NODE_ENV === "production"
      ? { policy: "same-origin" }
      : false,
  })
);

// Double-check: Remove HSTS header AFTER helmet (in case helmet sets it anyway)
app.use((req, res, next) => {
  if (!isHTTPS) {
    res.removeHeader("Strict-Transport-Security");
  }
  next();
});

// CORS configuration
app.use(cors(config.cors));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting - only apply in production
// In development, skip rate limiting to avoid blocking legitimate requests
if (process.env.NODE_ENV === "production") {
  // Rate limiting - stricter for auth endpoints (must come first to exclude from general limiter)
  const authLimiter = rateLimit(config.rateLimit.auth);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/update-password", authLimiter);

  // Rate limiting - general API rate limiter (excludes auth endpoints)
  const apiLimiter = rateLimit({
    ...config.rateLimit.api,
    skip: (req) => {
      // Skip auth endpoints - they have their own rate limiter
      if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/update-password')) {
        return true;
      }
      // Use the original skip logic for other endpoints
      return config.rateLimit.api.skip ? config.rateLimit.api.skip(req) : false;
    },
  });
  app.use("/api/", apiLimiter);
} else {
  // In development, use very lenient rate limiting or skip entirely
  // This prevents accidental rate limit issues during development
  logger.info("Rate limiting disabled in development mode");
}

// API Documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Dockaverger API Documentation",
  })
);

// Serve static files from React app (in production)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "public")));
}

// Routes
app.use("/api", routes);

// Serve React app for all non-API routes (in production)
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`, {
    environment: process.env.NODE_ENV || "development",
    port: config.port,
  });

  if (process.env.NODE_ENV === "development") {
    logger.info(`Portainer URLs: ${config.portainer.urls.join(", ")}`);
    logger.info(`Portainer Username: ${config.portainer.username}`);
    logger.info(
      `Docker Hub authentication: Configure via Settings UI for higher rate limits`
    );
    logger.info(`Cache TTL: 24 hours`);
  }
});

module.exports = app;
