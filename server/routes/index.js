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
const containerController = require("../controllers/containerController");
const imageController = require("../controllers/imageController");
const authController = require("../controllers/authController");
const portainerController = require("../controllers/portainerController");
const avatarController = require("../controllers/avatarController");
const batchController = require("../controllers/batchController");
const trackedImageController = require("../controllers/trackedImageController");
const discordController = require("../controllers/discordController");
const settingsController = require("../controllers/settingsController");
const versionController = require("../controllers/versionController");
const logsController = require("../controllers/logsController");
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");
const { validateBody, validateQuery, validateParams } = require("../utils/validationSchemas");
const { schemas } = require("../utils/validationSchemas");
const Joi = require('joi');

const router = express.Router();

// Health check routes (no authentication required)
const healthRouter = require('./health');
router.use('/health', healthRouter);

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
// Apply validation middleware before controller
router.post("/auth/login", validateBody(schemas.login), asyncHandler(authController.login));

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

// Protected routes - require authentication
// All routes below this line require authentication
router.use(authenticate);

// User management routes (protected)
router.get("/auth/me", asyncHandler(authController.getCurrentUser));
router.post(
  "/auth/update-password",
  validateBody(schemas.updatePassword),
  asyncHandler(authController.updateUserPassword)
);
router.post(
  "/auth/update-username",
  validateBody(schemas.updateUsername),
  asyncHandler(authController.updateUserUsername)
);

// Docker Hub credentials routes (protected)
router.get("/docker-hub/credentials", asyncHandler(authController.getDockerHubCreds));
router.post(
  "/docker-hub/credentials/validate",
  validateBody(schemas.dockerHubCredentials),
  asyncHandler(authController.validateDockerHubCreds)
);
router.post(
  "/docker-hub/credentials",
  validateBody(schemas.dockerHubCredentials),
  asyncHandler(authController.updateDockerHubCreds)
);
router.delete(
  "/docker-hub/credentials",
  asyncHandler(authController.deleteDockerHubCreds)
);

// Container routes
router.get("/containers", asyncHandler(containerController.getContainers));
// IMPORTANT: Specific routes must come before parameterized routes
// Otherwise /containers/pull would match /containers/:containerId/upgrade
router.post(
  "/containers/pull",
  validateBody(schemas.pullContainers),
  asyncHandler(containerController.pullContainers)
);
router.delete(
  "/containers/cache",
  asyncHandler(containerController.clearCache)
);
router.post(
  "/containers/batch-upgrade",
  validateBody(schemas.batchUpgrade),
  asyncHandler(containerController.batchUpgradeContainers)
);
router.post(
  "/containers/:containerId/upgrade",
  validateParams(schemas.containerIdParam),
  validateBody(schemas.upgradeContainer),
  asyncHandler(containerController.upgradeContainer)
);

// Image routes
router.get("/images/unused", asyncHandler(imageController.getUnusedImages));
router.post(
  "/images/delete",
  validateBody(schemas.deleteImages),
  asyncHandler(imageController.deleteImages)
);

// Portainer instance routes
router.post(
  "/portainer/instances/validate",
  validateBody(schemas.portainerInstanceValidate),
  asyncHandler(portainerController.validateInstance)
);
router.get(
  "/portainer/instances",
  asyncHandler(portainerController.getInstances)
);
router.get(
  "/portainer/instances/:id",
  validateParams(schemas.idParam),
  asyncHandler(portainerController.getInstance)
);
router.post(
  "/portainer/instances",
  validateBody(schemas.portainerInstance),
  asyncHandler(portainerController.createInstance)
);
router.put(
  "/portainer/instances/:id",
  validateParams(schemas.idParam),
  validateBody(schemas.portainerInstanceUpdate),
  asyncHandler(portainerController.updateInstance)
);
router.post(
  "/portainer/instances/reorder",
  validateBody(Joi.object({
    orders: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().required(),
        display_order: Joi.number().integer().min(0).required(),
      })
    ).min(1).required(),
  })),
  asyncHandler(portainerController.updateInstanceOrder)
);
router.delete(
  "/portainer/instances/:id",
  validateParams(schemas.idParam),
  asyncHandler(portainerController.deleteInstance)
);

// Avatar routes
router.get("/avatars", asyncHandler(avatarController.getAvatar));
router.get("/avatars/recent", asyncHandler(avatarController.getRecentAvatars));
router.get("/avatars/recent/:filename", asyncHandler(avatarController.getRecentAvatar));
router.post("/avatars", asyncHandler(avatarController.uploadAvatar));
router.post("/avatars/set-current", asyncHandler(avatarController.setCurrentAvatar));
router.delete("/avatars", asyncHandler(avatarController.deleteAvatar));

// Batch configuration routes
router.get("/batch/config", asyncHandler(batchController.getBatchConfigHandler));
router.post(
  "/batch/config",
  validateBody(schemas.batchConfigUpdate),
  asyncHandler(batchController.updateBatchConfigHandler)
);
router.get("/batch/status", asyncHandler(batchController.getBatchStatusHandler));
router.post(
  "/batch/trigger",
  validateBody(schemas.batchTrigger),
  asyncHandler(batchController.triggerBatchJobHandler)
);
router.get("/batch/log-level", asyncHandler(batchController.getLogLevelHandler));
router.post(
  "/batch/log-level",
  validateBody(Joi.object({ logLevel: schemas.logLevel })),
  asyncHandler(batchController.setLogLevelHandler)
);
router.post(
  "/batch/runs",
  validateBody(schemas.batchRunCreate),
  asyncHandler(batchController.createBatchRunHandler)
);
router.put(
  "/batch/runs/:id",
  validateParams(schemas.idParam),
  validateBody(schemas.batchRunUpdate),
  asyncHandler(batchController.updateBatchRunHandler)
);
router.get(
  "/batch/runs/latest",
  validateQuery(schemas.batchRunsQuery),
  asyncHandler(batchController.getLatestBatchRunHandler)
);
router.get(
  "/batch/runs",
  validateQuery(schemas.batchRunsQuery),
  asyncHandler(batchController.getRecentBatchRunsHandler)
);
router.get(
  "/batch/runs/:id",
  validateParams(schemas.idParam),
  asyncHandler(batchController.getBatchRunByIdHandler)
);

// Tracked images routes
// IMPORTANT: More specific routes must come before parameterized routes
router.get("/tracked-images", asyncHandler(trackedImageController.getTrackedImages));
router.post(
  "/tracked-images",
  validateBody(schemas.trackedImage),
  asyncHandler(trackedImageController.createTrackedImage)
);
router.post("/tracked-images/check-updates", asyncHandler(trackedImageController.checkTrackedImagesUpdates));
router.delete("/tracked-images/cache", asyncHandler(trackedImageController.clearGitHubCache));
router.get(
  "/tracked-images/:id",
  validateParams(schemas.idParam),
  asyncHandler(trackedImageController.getTrackedImage)
);
router.put(
  "/tracked-images/:id",
  validateParams(schemas.idParam),
  validateBody(schemas.trackedImageUpdate),
  asyncHandler(trackedImageController.updateTrackedImage)
);
router.delete(
  "/tracked-images/:id",
  validateParams(schemas.idParam),
  asyncHandler(trackedImageController.deleteTrackedImage)
);
router.post(
  "/tracked-images/:id/check-update",
  validateParams(schemas.idParam),
  asyncHandler(trackedImageController.checkTrackedImageUpdate)
);

// Discord notification routes
router.get("/discord/webhooks", asyncHandler(discordController.getDiscordWebhooks));
router.get(
  "/discord/webhooks/:id",
  validateParams(schemas.idParam),
  asyncHandler(discordController.getDiscordWebhook)
);
router.post(
  "/discord/webhooks",
  validateBody(schemas.discordWebhook),
  asyncHandler(discordController.createDiscordWebhook)
);
router.put(
  "/discord/webhooks/:id",
  validateParams(schemas.idParam),
  validateBody(schemas.discordWebhookUpdate),
  asyncHandler(discordController.updateDiscordWebhook)
);
router.delete(
  "/discord/webhooks/:id",
  validateParams(schemas.idParam),
  asyncHandler(discordController.deleteDiscordWebhook)
);
router.post(
  "/discord/webhooks/:id/test",
  validateParams(schemas.idParam),
  asyncHandler(discordController.testDiscordWebhookById)
);
router.post(
  "/discord/test",
  validateBody(schemas.discordWebhookTest),
  asyncHandler(discordController.testDiscordWebhook)
);
router.get(
  "/discord/webhooks/info",
  validateQuery(Joi.object({ webhookUrl: Joi.string().uri().required() })),
  asyncHandler(discordController.getWebhookInfo)
);
router.get("/discord/invite", asyncHandler(discordController.getDiscordBotInvite));

// Settings routes
router.get("/settings/color-scheme", asyncHandler(settingsController.getColorSchemeHandler));
router.post("/settings/color-scheme", validateBody(schemas.colorScheme), asyncHandler(settingsController.setColorSchemeHandler));

// Logs routes
router.get("/logs", authenticate, asyncHandler(logsController.getLogsHandler));

module.exports = router;
