/**
 * Main server file
 * Sets up Express app and middleware
 */

// Register error handlers IMMEDIATELY before anything else
// This ensures we catch any errors during module loading
process.on("uncaughtException", (error) => {
  process.stderr.write(`[SERVER.JS] UNCAUGHT EXCEPTION (early): ${error.message}\n`);
  process.stderr.write(`[SERVER.JS] Stack: ${error.stack}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  process.stderr.write(`[SERVER.JS] UNHANDLED REJECTION (early): ${reason}\n`);
  if (reason instanceof Error) {
    process.stderr.write(`[SERVER.JS] Stack: ${reason.stack}\n`);
  }
  process.exit(1);
});

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const routes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const requestLogger = require("./middleware/requestLogger");
const logger = require("./utils/logger");
const swaggerSpec = require("./config/swagger");
const { initializeRegistrationCode } = require("./utils/registrationCode");

logger.debug("Starting server module load", { module: "server" });

let databaseModule;
try {
  databaseModule = require("./db/database");
  logger.debug("Database module loaded", { module: "server" });
} catch (dbError) {
  process.stderr.write(`[SERVER.JS] ERROR loading database: ${dbError}\n`);
  process.stderr.write(`[SERVER.JS] Stack: ${dbError.stack}\n`);
  logger.error("Failed to load database module:", dbError);
  process.exit(1);
}
const { hasAnyUsers, waitForDatabase, waitForMigrations } = databaseModule;

const app = express();
logger.debug("Express app created", { module: "server" });

// Trust proxy - required when running behind a reverse proxy (Docker, nginx, etc.)
// This allows Express to correctly identify the client IP from X-Forwarded-For headers
app.set("trust proxy", true);

// Security middleware configuration - must be defined before middleware
// Note: CSP disabled on localhost and in development for Safari compatibility
// In production with HTTPS, CSP allows blob: URLs for images to support avatar functionality
// Disable CSP entirely when:
// 1. Running in development mode, OR
// 2. Explicitly disabled via DISABLE_CSP env var, OR
// 3. Running on any localhost port without HTTPS (for Safari compatibility)
const isHTTPS = process.env.HTTPS === "true" || process.env.PROTOCOL === "https";
// Consider any port < 10000 as localhost development (3001, 3002, 3000, etc.)
const isLocalhost = config.port < 10000 && !isHTTPS;
const shouldDisableCSP =
  process.env.NODE_ENV !== "production" || process.env.DISABLE_CSP === "true" || isLocalhost;

// Explicitly remove HSTS header for localhost to fix Safari caching issues
// This must come BEFORE helmet to ensure HSTS is not set
app.use((req, res, next) => {
  if (!isHTTPS) {
    // Remove any HSTS headers that might be set
    res.removeHeader("Strict-Transport-Security");
    // Prevent caching of security headers
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
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

// Request logging middleware (after body parsing to capture request data)
app.use(requestLogger);

// Rate limiting - DISABLED for all API endpoints
// We only rate limit Docker Hub requests, not our own API
// This prevents 429 errors when deploying to Portainer or other production environments
logger.info("API rate limiting disabled - only Docker Hub requests are rate limited", {
  module: "server",
});

// API Documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Docked API Documentation",
  })
);

// Serve static files from React app
// In production: always serve
// In development: serve if public directory exists (Docker/local build scenario)
const publicPath = path.join(__dirname, "public");
const shouldServeStatic =
  process.env.NODE_ENV === "production" ||
  (process.env.NODE_ENV === "development" && fs.existsSync(publicPath));

if (shouldServeStatic) {
  app.use(express.static(publicPath));
}

// Routes
app.use("/api", routes);

// Serve React app for all non-API routes
if (shouldServeStatic) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Import batch system
logger.debug("About to require batch system", { module: "server" });
let batchSystem;
try {
  batchSystem = require("./services/batch");
  logger.debug("Batch system loaded", { module: "server" });
} catch (batchError) {
  process.stderr.write(`[SERVER.JS] ERROR loading batch system: ${batchError}\n`);
  process.stderr.write(`[SERVER.JS] Stack: ${batchError.stack}\n`);
  logger.error("Failed to load batch system:", batchError);
  // Create a dummy batch system to prevent crashes
  batchSystem = {
    start: () => Promise.resolve(),
    stop: () => {},
    executeJob: () => Promise.resolve(),
    getStatus: () => ({ running: false }),
    getRegisteredJobTypes: () => [],
    getHandler: () => null,
  };
}

// Handle unhandled promise rejections (Express 5 compatibility)
// In Express 5, unhandled rejections can cause crashes
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", {
    module: "server",
    reason:
      reason instanceof Error
        ? {
            message: reason.message,
            stack: reason.stack,
            name: reason.name,
          }
        : reason,
    promise: promise,
  });
  // In test mode, don't exit - let Jest handle it
  // In development, log but don't exit - let nodemon handle restarts
  // In production, exit to prevent undefined behavior
  if (process.env.NODE_ENV === "production") {
    logger.critical("Exiting due to unhandled rejection in production");
    process.exit(1);
  }
  // In test mode, just log - don't exit
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.critical("Uncaught Exception", {
    module: "server",
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
  });
  // Always exit on uncaught exceptions - these are serious
  process.exit(1);
});

// Log when process is about to exit
process.on("exit", (code) => {
  logger.debug(`Process exiting with code ${code}`, { module: "server" });
});

// Log before exit
const originalExit = process.exit;
process.exit = function(code) {
  logger.debug(`process.exit(${code}) called`, { module: "server" });
  return originalExit.call(process, code);
};

// Only start the server if this file is being run directly (not required by tests)
// require.main === module means this file was executed directly (e.g., node server.js)
// We also skip if NODE_ENV is 'test' to prevent server startup during tests
const shouldStartServer = require.main === module && process.env.NODE_ENV !== "test";
logger.debug(`shouldStartServer: ${shouldStartServer}, require.main === module: ${require.main === module}, NODE_ENV: ${process.env.NODE_ENV}`, { module: "server" });

if (shouldStartServer) {
  // Start server
  logger.debug("About to start server", { module: "server" });
  try {
    logger.debug("Inside try block, about to log 'Server starting'", { module: "server" });
    logger.info("Server starting", {
      module: "server",
      environment: process.env.NODE_ENV || "development",
      port: config.port,
    });

    // Registration code is now generated on-demand when user clicks "Create User"
    // No longer generated on server startup

    const server = app.listen(config.port, () => {
      logger.info("Server started successfully", {
        module: "server",
        environment: process.env.NODE_ENV || "development",
        port: config.port,
        nodeVersion: process.version,
      });

      if (process.env.NODE_ENV === "development") {
        logger.debug("Development configuration", {
          module: "server",
          portainerUrls: config.portainer.urls,
          portainerUsername: config.portainer.username,
          dockerHubAuthConfigured: "Configure via Settings UI",
          cacheTTL: "24 hours",
        });
      }

      // Start batch system (runs jobs in background even when browser is closed)
      // Wait for migrations to complete before starting batch system
      // Use setImmediate to ensure server is fully started before starting batch system
      setImmediate(async () => {
        try {
          // Wait for migrations to complete before starting batch jobs
          await waitForMigrations();
          logger.debug("Migrations complete, starting batch system", { module: "server" });
          
          batchSystem
            .start()
            .then(() => {
              logger.info("Batch system started", {
                module: "server",
                service: "batch",
              });
            })
            .catch((err) => {
              logger.error("Failed to start batch system", {
                module: "server",
                service: "batch",
                error: err,
              });
              // Don't crash the server if batch system fails to start
            });
        } catch (migrationErr) {
          logger.error("Error waiting for migrations:", migrationErr);
          // Still try to start batch system - it might work anyway
          batchSystem
            .start()
            .then(() => {
              logger.info("Batch system started (migrations may not have completed)", {
                module: "server",
                service: "batch",
              });
            })
            .catch((err) => {
              logger.error("Failed to start batch system", {
                module: "server",
                service: "batch",
                error: err,
              });
            });
        }
      });
    });

    server.on("error", (err) => {
      logger.critical("Server listen error", {
        module: "server",
        error: err,
        port: config.port,
        code: err.code,
      });
      if (err.code === "EADDRINUSE") {
        logger.critical(`Port ${config.port} is already in use`, {
          module: "server",
          port: config.port,
        });
      }
      // Exit on listen errors
      process.exit(1);
    });
  } catch (error) {
    logger.critical("Failed to start server", {
      module: "server",
      error: error,
    });
    process.exit(1);
  }

  // Graceful shutdown handling (only register if server is starting)
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully", {
      module: "server",
    });
    batchSystem.stop();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully", {
      module: "server",
    });
    batchSystem.stop();
    process.exit(0);
  });
}

module.exports = app;
