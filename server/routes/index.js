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
 *   - name: Portainer
 *     description: Portainer instance management
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const containerController = require("../controllers/containerController");
const imageController = require("../controllers/imageController");
const authController = require("../controllers/authController");
const portainerController = require("../controllers/portainerController");
const avatarController = require("../controllers/avatarController");
const batchController = require("../controllers/batchController");
const trackedAppController = require("../controllers/trackedAppController");
const discordController = require("../controllers/discordController");
const settingsController = require("../controllers/settingsController");
const versionController = require("../controllers/versionController");
const logsController = require("../controllers/logsController");
const repositoryAccessTokenController = require("../controllers/repositoryAccessTokenController");
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Rate limiters for specific routes
// Avatar routes rate limiter: 100 requests per 15 minutes per IP
const avatarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Repository access token routes rate limiter: 100 requests per 15 minutes per IP
const repositoryAssociatedImagesRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Associate images route rate limiter: 10 requests per minute per IP (more restrictive for write operations)
const associateImagesLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per minute
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
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
router.get("/version", versionController.getVersion);
router.get("/version/latest-release", versionController.getLatestRelease);

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
router.get(
  "/auth/registration-code-required",
  asyncHandler(authController.checkRegistrationCodeRequired)
);
// Auth routes (public - no authentication required)
router.get("/auth/check-user-exists", asyncHandler(authController.checkUserExists));
router.post(
  "/auth/generate-registration-code",
  asyncHandler(authController.generateRegistrationCodeEndpoint)
);
router.post("/auth/verify-registration-code", asyncHandler(authController.verifyRegistrationCode));
router.post("/auth/register", asyncHandler(authController.register));
router.post("/auth/login", asyncHandler(authController.login));
router.post("/auth/import-users", asyncHandler(authController.importUsers));
router.post("/auth/create-user-with-config", asyncHandler(authController.createUserWithConfig));
router.post(
  "/auth/generate-instance-admin-token",
  asyncHandler(authController.generateInstanceAdminToken)
);
router.post(
  "/auth/regenerate-instance-admin-token",
  asyncHandler(authController.regenerateInstanceAdminToken)
);
router.post(
  "/auth/verify-instance-admin-token",
  asyncHandler(authController.verifyInstanceAdminToken)
);

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

// Validation endpoints (public - used during import process)
router.post("/portainer/instances/validate", asyncHandler(portainerController.validateInstance));
router.post(
  "/docker-hub/credentials/validate",
  asyncHandler(authController.validateDockerHubCreds)
);
router.post("/discord/test", asyncHandler(discordController.testDiscordWebhook));

// Protected routes - require authentication
// All routes below this line require authentication
router.use(authenticate);

// User management routes (protected)
router.get("/auth/me", asyncHandler(authController.getCurrentUser));
router.get("/auth/users", asyncHandler(authController.getAllUsersEndpoint));
router.get("/auth/users/:userId/stats", asyncHandler(authController.getUserStatsEndpoint));
router.get("/auth/export-users", asyncHandler(authController.exportUsersEndpoint));
router.post("/auth/update-password", asyncHandler(authController.updateUserPassword));
router.post("/auth/update-username", asyncHandler(authController.updateUserUsername));
router.post("/auth/users/:userId/password", asyncHandler(authController.adminUpdateUserPassword));
router.put("/auth/users/:userId/role", asyncHandler(authController.adminUpdateUserRole));
router.get("/user/export-config", asyncHandler(authController.exportUserConfig));
router.post("/user/import-config", asyncHandler(authController.importUserConfig));

// Docker Hub credentials routes (protected)
router.get("/docker-hub/credentials", asyncHandler(authController.getDockerHubCreds));
router.post("/docker-hub/credentials", asyncHandler(authController.updateDockerHubCreds));
router.delete("/docker-hub/credentials", asyncHandler(authController.deleteDockerHubCreds));

// Container routes
router.get("/containers", asyncHandler(containerController.getContainers));
// IMPORTANT: Specific routes must come before parameterized routes
// Otherwise /containers/pull would match /containers/:containerId/upgrade
router.post("/containers/pull", asyncHandler(containerController.pullContainers));
router.get("/containers/data", asyncHandler(containerController.getContainerData));
router.delete("/containers/data", asyncHandler(containerController.clearContainerData));
router.post("/containers/batch-upgrade", asyncHandler(containerController.batchUpgradeContainers));
router.post("/containers/:containerId/upgrade", asyncHandler(containerController.upgradeContainer));

// Image routes
router.get("/images/unused", asyncHandler(imageController.getUnusedImages));
router.post("/images/delete", asyncHandler(imageController.deleteImages));

// Portainer instance routes
router.get("/portainer/instances", asyncHandler(portainerController.getInstances));
router.get("/portainer/instances/:id", asyncHandler(portainerController.getInstance));
router.post("/portainer/instances", asyncHandler(portainerController.createInstance));
router.put("/portainer/instances/:id", asyncHandler(portainerController.updateInstance));
router.post("/portainer/instances/reorder", asyncHandler(portainerController.updateInstanceOrder));
router.delete("/portainer/instances/:id", asyncHandler(portainerController.deleteInstance));

// Avatar routes
router.get("/avatars", avatarLimiter, asyncHandler(avatarController.getAvatar));
router.get(
  "/avatars/user/:userId",
  avatarLimiter,
  asyncHandler(avatarController.getAvatarByUserId)
);
router.get("/avatars/recent", avatarLimiter, asyncHandler(avatarController.getRecentAvatars));
router.get("/avatars/recent/:filename", asyncHandler(avatarController.getRecentAvatar));
router.post("/avatars", asyncHandler(avatarController.uploadAvatar));
router.post("/avatars/set-current", asyncHandler(avatarController.setCurrentAvatar));
router.delete("/avatars", asyncHandler(avatarController.deleteAvatar));

// Batch configuration routes
router.get("/batch/config", asyncHandler(batchController.getBatchConfigHandler));
router.post("/batch/config", asyncHandler(batchController.updateBatchConfigHandler));
router.get("/batch/status", asyncHandler(batchController.getBatchStatusHandler));
router.post("/batch/trigger", asyncHandler(batchController.triggerBatchJobHandler));
router.get("/batch/log-level", asyncHandler(batchController.getLogLevelHandler));
router.post("/batch/log-level", asyncHandler(batchController.setLogLevelHandler));
router.post("/batch/runs", asyncHandler(batchController.createBatchRunHandler));
router.put("/batch/runs/:id", asyncHandler(batchController.updateBatchRunHandler));
router.get("/batch/runs/latest", asyncHandler(batchController.getLatestBatchRunHandler));
router.get("/batch/runs", asyncHandler(batchController.getRecentBatchRunsHandler));
router.get("/batch/runs/:id", asyncHandler(batchController.getBatchRunByIdHandler));

// Tracked apps routes
// IMPORTANT: More specific routes must come before parameterized routes
router.get("/tracked-apps", asyncHandler(trackedAppController.getTrackedApps));
router.post("/tracked-apps", asyncHandler(trackedAppController.createTrackedApp));
router.post(
  "/tracked-apps/check-updates",
  asyncHandler(trackedAppController.checkTrackedAppsUpdates)
);
router.delete("/tracked-apps/cache", asyncHandler(trackedAppController.clearGitHubCache));
router.get("/tracked-apps/:id", asyncHandler(trackedAppController.getTrackedApp));
router.put("/tracked-apps/:id", asyncHandler(trackedAppController.updateTrackedApp));
router.delete("/tracked-apps/:id", asyncHandler(trackedAppController.deleteTrackedApp));
router.post(
  "/tracked-apps/:id/check-update",
  asyncHandler(trackedAppController.checkTrackedAppUpdate)
);

// Discord notification routes
router.get("/discord/webhooks", asyncHandler(discordController.getDiscordWebhooks));
router.get("/discord/webhooks/:id", asyncHandler(discordController.getDiscordWebhook));
router.post("/discord/webhooks", asyncHandler(discordController.createDiscordWebhook));
router.put("/discord/webhooks/:id", asyncHandler(discordController.updateDiscordWebhook));
router.delete("/discord/webhooks/:id", asyncHandler(discordController.deleteDiscordWebhook));
router.post("/discord/webhooks/:id/test", asyncHandler(discordController.testDiscordWebhookById));
router.get("/discord/webhooks/info", asyncHandler(discordController.getWebhookInfo));
router.get("/discord/invite", asyncHandler(discordController.getDiscordBotInvite));

// Settings routes
router.get("/settings/color-scheme", asyncHandler(settingsController.getColorSchemeHandler));
router.post("/settings/color-scheme", asyncHandler(settingsController.setColorSchemeHandler));
router.get(
  "/settings/disable-portainer-page",
  asyncHandler(settingsController.getDisablePortainerPageHandler)
);
router.post(
  "/settings/disable-portainer-page",
  asyncHandler(settingsController.setDisablePortainerPageHandler)
);
router.get(
  "/settings/disable-tracked-apps-page",
  asyncHandler(settingsController.getDisableTrackedAppsPageHandler)
);
router.post(
  "/settings/disable-tracked-apps-page",
  asyncHandler(settingsController.setDisableTrackedAppsPageHandler)
);
router.get(
  "/settings/refreshing-toggles-enabled",
  asyncHandler(settingsController.getRefreshingTogglesEnabledHandler)
);
router.post(
  "/settings/refreshing-toggles-enabled",
  asyncHandler(settingsController.setRefreshingTogglesEnabledHandler)
);

// Repository access token routes
router.get("/repository-access-tokens", asyncHandler(repositoryAccessTokenController.getTokens));
router.get(
  "/repository-access-tokens/:provider",
  asyncHandler(repositoryAccessTokenController.getTokenByProvider)
);
router.post("/repository-access-tokens", asyncHandler(repositoryAccessTokenController.upsertToken));
router.delete(
  "/repository-access-tokens/:id",
  asyncHandler(repositoryAccessTokenController.deleteToken)
);

router.get(
  "/repository-access-tokens/:id/associated-images",
  repositoryAssociatedImagesRateLimiter,
  authenticate,
  asyncHandler(repositoryAccessTokenController.getAssociatedImages)
);

router.post(
  "/repository-access-tokens/:id/associate-images",
  associateImagesLimiter,
  authenticate,
  asyncHandler(repositoryAccessTokenController.associateImages)
);

// Logs routes
router.get("/logs", authenticate, asyncHandler(logsController.getLogsHandler));

module.exports = router;
