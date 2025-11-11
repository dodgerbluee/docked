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
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

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
router.post("/auth/login", asyncHandler(authController.login));

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
  asyncHandler(authController.updateUserPassword)
);
router.post(
  "/auth/update-username",
  asyncHandler(authController.updateUserUsername)
);

// Docker Hub credentials routes (protected)
router.get(
  "/docker-hub/credentials",
  asyncHandler(authController.getDockerHubCreds)
);
router.post(
  "/docker-hub/credentials/validate",
  asyncHandler(authController.validateDockerHubCreds)
);
router.post(
  "/docker-hub/credentials",
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
  asyncHandler(containerController.pullContainers)
);
router.delete(
  "/containers/cache",
  asyncHandler(containerController.clearCache)
);
router.post(
  "/containers/batch-upgrade",
  asyncHandler(containerController.batchUpgradeContainers)
);
router.post(
  "/containers/:containerId/upgrade",
  asyncHandler(containerController.upgradeContainer)
);

// Image routes
router.get("/images/unused", asyncHandler(imageController.getUnusedImages));
router.post("/images/delete", asyncHandler(imageController.deleteImages));

// Portainer instance routes
router.post(
  "/portainer/instances/validate",
  asyncHandler(portainerController.validateInstance)
);
router.get(
  "/portainer/instances",
  asyncHandler(portainerController.getInstances)
);
router.get(
  "/portainer/instances/:id",
  asyncHandler(portainerController.getInstance)
);
router.post(
  "/portainer/instances",
  asyncHandler(portainerController.createInstance)
);
router.put(
  "/portainer/instances/:id",
  asyncHandler(portainerController.updateInstance)
);
router.post(
  "/portainer/instances/reorder",
  asyncHandler(portainerController.updateInstanceOrder)
);
router.delete(
  "/portainer/instances/:id",
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

// Tracked images routes
// IMPORTANT: More specific routes must come before parameterized routes
router.get("/tracked-images", asyncHandler(trackedImageController.getTrackedImages));
router.post("/tracked-images", asyncHandler(trackedImageController.createTrackedImage));
router.post("/tracked-images/check-updates", asyncHandler(trackedImageController.checkTrackedImagesUpdates));
router.delete("/tracked-images/cache", asyncHandler(trackedImageController.clearGitHubCache));
router.get("/tracked-images/:id", asyncHandler(trackedImageController.getTrackedImage));
router.put("/tracked-images/:id", asyncHandler(trackedImageController.updateTrackedImage));
router.delete("/tracked-images/:id", asyncHandler(trackedImageController.deleteTrackedImage));
router.post("/tracked-images/:id/check-update", asyncHandler(trackedImageController.checkTrackedImageUpdate));

// Discord notification routes
router.get("/discord/webhooks", asyncHandler(discordController.getDiscordWebhooks));
router.get("/discord/webhooks/:id", asyncHandler(discordController.getDiscordWebhook));
router.post("/discord/webhooks", asyncHandler(discordController.createDiscordWebhook));
router.put("/discord/webhooks/:id", asyncHandler(discordController.updateDiscordWebhook));
router.delete("/discord/webhooks/:id", asyncHandler(discordController.deleteDiscordWebhook));
router.post("/discord/webhooks/:id/test", asyncHandler(discordController.testDiscordWebhookById));
router.post("/discord/test", asyncHandler(discordController.testDiscordWebhook));
router.get("/discord/webhooks/info", asyncHandler(discordController.getWebhookInfo));
router.get("/discord/invite", asyncHandler(discordController.getDiscordBotInvite));

module.exports = router;
