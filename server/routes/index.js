/**
 * API Routes
 * @swagger
 * tags:
 *   - name: Health
 *     description: Health check endpoints
 *   - name: Authentication
 *     description: User authentication endpoints
 *   - name: Containers
 *     description: Docker container management
 *   - name: Images
 *     description: Docker image management
 *   - name: Sources
 *     description: Source instance management
 *   - name: Tracked Apps
 *     description: Tracked application management
 *   - name: Discord
 *     description: Discord webhook management
 *   - name: Batch
 *     description: Batch job management
 *   - name: Settings
 *     description: User and application settings
 *   - name: Images
 *     description: Docker image management
 *   - name: Repository Tokens
 *     description: Repository access token management
 *   - name: Intents
 *     description: Automated upgrade intent management
 *   - name: Logs
 *     description: Application log management
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/authController");
const avatarController = require("../controllers/avatarController");

const versionController = require("../controllers/versionController");
const oauthController = require("../controllers/oauthController");
const runnerController = require("../controllers/runnerController");
const debugRouter = require("./debug");
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const logger = require("../utils/logger");

// Rate limiters for specific routes
// Avatar routes rate limiter: 100 requests per 15 minutes per IP
const avatarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Auth routes rate limiter: 20 requests per 15 minutes per IP (for sensitive auth operations)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Destructive operations limiter: 10 requests per minute per IP (upgrades, deletes, batch triggers)
const destructiveLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: "Too many destructive operations, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Write operations limiter: 30 requests per 15 minutes per IP (creates, updates, settings changes)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: "Too many write requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints limiter: strict, 20 requests per 15 minutes per IP
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// OAuth endpoints limiter: very strict, 10 requests per 15 minutes per IP
// OAuth flows involve external redirects so brute-force attempts are cheap
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: "Too many OAuth attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * @swagger
 * /version:
 *   get:
 *     summary: Get application version
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application version information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   nullable: true
 *                   example: "1.0.0"
 *                 environment:
 *                   type: string
 *                   example: "production"
 */
router.get("/version", publicLimiter, versionController.getVersion);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 username:
 *                   type: string
 *                 role:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 *       400:
 *         description: Missing required fields
 */
// Auth routes (public - no authentication required)
// check-user-exists is served by the graph (userExists query).
// First-user registration (registration code + register) is served by the graph
// (registrationCodeStatus query; generateRegistrationCode, verifyRegistrationCode,
// register mutations).
router.post("/auth/login", authLimiter, asyncHandler(authController.login));
router.post(
  "/auth/create-user-with-config",
  authLimiter,
  asyncHandler(authController.createUserWithConfig)
);

// OAuth/SSO routes (public - always registered; providers checked at runtime)
router.get("/auth/oauth/providers", publicLimiter, asyncHandler(oauthController.getProviders));
router.get("/auth/oauth/login", oauthLimiter, asyncHandler(oauthController.initiateLogin));
router.get("/auth/oauth/callback", oauthLimiter, asyncHandler(oauthController.handleCallback));
router.post("/auth/oauth/link", oauthLimiter, asyncHandler(oauthController.completeAccountLink));

/**
 * @swagger
 * /auth/verify:
 *   get:
 *     summary: Verify authentication token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *       401:
 *         description: Invalid or expired token
 */
router.get("/auth/verify", asyncHandler(authController.verifyToken));

// Runner enrollment routes (unauthenticated — called by install script and dockhand agent)
router.get(
  "/runners/install/:token",
  publicLimiter,
  asyncHandler(runnerController.serveInstallScript)
);
router.post("/runners/register", publicLimiter, asyncHandler(runnerController.registerRunner));
router.post("/runners/heartbeat", publicLimiter, asyncHandler(runnerController.heartbeatRunner));
router.post("/runners/re-enroll", publicLimiter, asyncHandler(runnerController.reEnrollRunner));

// Protected routes - require authentication
// All routes below this line require authentication
router.use(authenticate);

// Instance admin token routes are served by the graph
// (generateInstanceAdminToken, regenerateInstanceAdminToken,
// verifyInstanceAdminToken mutations).

// Admin SSO provider management is served by the graph (ssoProviders,
// ssoSettings queries; createSSOProvider, updateSSOProvider, deleteSSOProvider,
// testSSOProvider, setSSOSettings mutations).

// User management routes: served by the graph (user query, deleteUser mutation).
router.get("/auth/export-users", asyncHandler(authController.exportUsersEndpoint));
router.get("/user/export-config", asyncHandler(authController.exportUserConfig));

// Logout: revokes the presented token in the shared revoked_tokens table so it
// cannot be replayed before its exp. The graph exposes the same behavior as the
// logout mutation; both share the table.
router.post("/auth/logout", asyncHandler(authController.logout));

// Docker Hub credentials routes removed - crane/skopeo use system Docker credentials (~/.docker/config.json)
// Users should run 'docker login' on the server if authentication is needed

// Container routes
// GET /containers moved to the Go GraphQL backend (user.containers connection,
// which also live-merges runner containers client-side).

// Image routes: served by the graph (unusedImages query, deleteImages mutation).

// Upgrade history routes: served by the graph (upgradeHistoryStats,
// trackedAppUpgradeHistory, trackedAppUpgradeHistoryStats).

// Avatar routes
router.get("/avatars", avatarLimiter, asyncHandler(avatarController.getAvatar));
router.get(
  "/avatars/user/:userId",
  avatarLimiter,
  asyncHandler(avatarController.getAvatarByUserId)
);
router.get("/avatars/recent", avatarLimiter, asyncHandler(avatarController.getRecentAvatars));
router.get(
  "/avatars/recent/:filename",
  avatarLimiter,
  asyncHandler(avatarController.getRecentAvatar)
);

// Intent routes
// IMPORTANT: Specific/static routes must come before parameterized routes
// Intent preview is served by the graph (previewIntent query).

// Tracked apps routes
// IMPORTANT: More specific routes must come before parameterized routes

// Repository access token associated-images routes are served by the graph
// (repositoryTokens.associatedImages field + associateImages mutation).

// Runner routes (dockhand agent instances)
// IMPORTANT: Specific/static routes must come before parameterized routes
router.post("/runners/enrollment", writeLimiter, asyncHandler(runnerController.createEnrollment));
router.get("/runners/enrollment-status", asyncHandler(runnerController.getEnrollmentStatus));
// Runner container SSE proxy routes
router.post(
  "/runners/:runnerId/containers/:containerId/upgrade",
  destructiveLimiter,
  asyncHandler(runnerController.upgradeRunnerContainer)
);
// Runner operation routes
router.get("/runners/:runnerId/operations", asyncHandler(runnerController.getRunnerOperations));
router.post(
  "/runners/:runnerId/operations/:name/run",
  writeLimiter,
  asyncHandler(runnerController.runRunnerOperation)
);

// Runner app routes — static paths before parameterized ones
router.get("/runners/:runnerId/apps", asyncHandler(runnerController.getRunnerApps));
router.get("/runners/:runnerId/apps/history", asyncHandler(runnerController.getRunnerAppsHistory));
router.post(
  "/runners/:runnerId/apps/:appName/operations/:opName/run",
  writeLimiter,
  asyncHandler(runnerController.runRunnerAppOperation)
);

// Debug routes (admin-only introspection, mounted after authenticate middleware)
router.use("/debug", debugRouter);

module.exports = router;
