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
 *   - name: Logs
 *     description: Application log management
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const containerController = require("../controllers/containerController");
const containerDebugController = require("../controllers/containerDebugController");
const imageController = require("../controllers/imageController");
const authController = require("../controllers/authController");
const portainerController = require("../controllers/portainerController");
const avatarController = require("../controllers/avatarController");
const batchController = require("../controllers/batchController");
const trackedAppController = require("../controllers/trackedImageController");
const trackedAppHistoryController = require("../controllers/trackedAppController");
const discordController = require("../controllers/discordController");
const settingsController = require("../controllers/settingsController");
const versionController = require("../controllers/versionController");
const logsController = require("../controllers/logsController");
const repositoryAccessTokenController = require("../controllers/repositoryAccessTokenController");
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");
const { validate, validationChains } = require("../middleware/validation");
const { param } = require("express-validator");

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

// Auth routes rate limiter: 20 requests per 15 minutes per IP (for sensitive auth operations)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
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
router.post("/auth/register", authLimiter, asyncHandler(authController.register));
router.post("/auth/login", authLimiter, asyncHandler(authController.login));
router.post("/auth/import-users", authLimiter, asyncHandler(authController.importUsers));
router.post(
  "/auth/create-user-with-config",
  authLimiter,
  asyncHandler(authController.createUserWithConfig)
);
router.post(
  "/auth/generate-instance-admin-token",
  authLimiter,
  asyncHandler(authController.generateInstanceAdminToken)
);
router.post(
  "/auth/regenerate-instance-admin-token",
  authLimiter,
  asyncHandler(authController.regenerateInstanceAdminToken)
);
router.post(
  "/auth/verify-instance-admin-token",
  authLimiter,
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

// Docker Hub credentials routes removed - crane/skopeo use system Docker credentials (~/.docker/config.json)
// Users should run 'docker login' on the server if authentication is needed

// Container routes
/**
 * @swagger
 * /containers:
 *   get:
 *     summary: Get all containers with update information
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: portainerUrl
 *         schema:
 *           type: string
 *         description: Filter by Portainer instance URL (optional)
 *     responses:
 *       200:
 *         description: List of containers with update information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 containers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Container'
 *       401:
 *         description: Unauthorized
 */
router.get("/containers", asyncHandler(containerController.getContainers));

// IMPORTANT: Specific routes must come before parameterized routes
// Otherwise /containers/pull would match /containers/:containerId/upgrade

/**
 * @swagger
 * /containers/pull:
 *   post:
 *     summary: Pull latest container data from Portainer instances
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Container data pulled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post("/containers/pull", asyncHandler(containerController.pullContainers));

/**
 * @swagger
 * /containers/data:
 *   get:
 *     summary: Get raw container data for export
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Raw container data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *   delete:
 *     summary: Clear all container data for current user
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Container data cleared successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/containers/data", asyncHandler(containerController.getContainerData));
router.delete("/containers/data", asyncHandler(containerController.clearContainerData));

/**
 * @swagger
 * /containers/batch-upgrade:
 *   post:
 *     summary: Upgrade multiple containers in batch
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - containerIds
 *               - imageName
 *             properties:
 *               containerIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["abc123", "def456"]
 *               imageName:
 *                 type: string
 *                 example: "nginx:latest"
 *     responses:
 *       200:
 *         description: Batch upgrade completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                 errors:
 *                   type: array
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post("/containers/batch-upgrade", asyncHandler(containerController.batchUpgradeContainers));

/**
 * @swagger
 * /containers/{containerId}/upgrade:
 *   post:
 *     summary: Upgrade a single container
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: containerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Container ID (minimum 12 characters)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageName
 *             properties:
 *               imageName:
 *                 type: string
 *                 example: "nginx:latest"
 *               portainerUrl:
 *                 type: string
 *                 example: "http://portainer:9000"
 *               endpointId:
 *                 type: string
 *                 example: "1"
 *     responses:
 *       200:
 *         description: Container upgraded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 containerId:
 *                   type: string
 *                 containerName:
 *                   type: string
 *                 oldImage:
 *                   type: string
 *                 newImage:
 *                   type: string
 *       400:
 *         description: Invalid request or validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Container not found
 */
router.post(
  "/containers/:containerId/upgrade",
  validate([
    param("containerId")
      .isString()
      .isLength({ min: 12 })
      .withMessage("containerId must be at least 12 characters"),
    ...validationChains.containerUpgrade,
  ]),
  asyncHandler(containerController.upgradeContainer)
);

// Image routes
router.get("/images/unused", asyncHandler(imageController.getUnusedImages));
router.post("/images/delete", asyncHandler(imageController.deleteImages));

// Upgrade history routes
/**
 * @swagger
 * /containers/upgrade-history:
 *   get:
 *     summary: Get upgrade history
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *       - in: query
 *         name: containerName
 *         schema:
 *           type: string
 *         description: Filter by container name
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [success, failed]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: Upgrade history retrieved successfully
 *       401:
 *         description: Authentication required
 */
router.get("/containers/upgrade-history", asyncHandler(containerController.getUpgradeHistory));
router.get(
  "/containers/upgrade-history/stats",
  asyncHandler(containerController.getUpgradeHistoryStats)
);
router.get(
  "/containers/upgrade-history/:id",
  asyncHandler(containerController.getUpgradeHistoryById)
);

// Tracked App Upgrade History routes
router.get(
  "/tracked-apps/upgrade-history",
  asyncHandler(trackedAppHistoryController.getTrackedAppHistory)
);
router.get(
  "/tracked-apps/upgrade-history/stats",
  asyncHandler(trackedAppHistoryController.getTrackedAppHistoryStats)
);
router.get(
  "/tracked-apps/upgrade-history/:id",
  asyncHandler(trackedAppHistoryController.getTrackedAppHistoryById)
);

/**
 * Get container debug information (developer mode only)
 * @route GET /api/containers/:containerId/debug
 */
router.get(
  "/containers/:containerId/debug",
  asyncHandler(containerDebugController.getContainerDebugInfo)
);

/**
 * @swagger
 * /containers/upgrade-history/stats:
 *   get:
 *     summary: Get upgrade history statistics
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Upgrade history statistics retrieved successfully
 *       401:
 *         description: Authentication required
 */
router.get(
  "/containers/upgrade-history/stats",
  asyncHandler(containerController.getUpgradeHistoryStats)
);

/**
 * @swagger
 * /containers/upgrade-history/{id}:
 *   get:
 *     summary: Get a single upgrade history record by ID
 *     tags: [Containers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Upgrade history record ID
 *     responses:
 *       200:
 *         description: Upgrade history record retrieved successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Upgrade history record not found
 */
router.get(
  "/containers/upgrade-history/:id",
  asyncHandler(containerController.getUpgradeHistoryById)
);

// Portainer instance routes
/**
 * @swagger
 * /portainer/instances:
 *   get:
 *     summary: Get all Portainer instances for current user
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Portainer instances
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 instances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       url:
 *                         type: string
 *                       name:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *   post:
 *     summary: Create a new Portainer instance
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 example: "http://portainer:9000"
 *               name:
 *                 type: string
 *                 example: "Local Portainer"
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               apiKey:
 *                 type: string
 *               authType:
 *                 type: string
 *                 enum: [apikey, basic]
 *                 default: apikey
 *     responses:
 *       201:
 *         description: Portainer instance created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.get("/portainer/instances", asyncHandler(portainerController.getInstances));
router.post("/portainer/instances", asyncHandler(portainerController.createInstance));

/**
 * @swagger
 * /portainer/instances/{id}:
 *   get:
 *     summary: Get a specific Portainer instance
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Portainer instance ID
 *     responses:
 *       200:
 *         description: Portainer instance details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Instance not found
 *   put:
 *     summary: Update a Portainer instance
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               name:
 *                 type: string
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               apiKey:
 *                 type: string
 *               authType:
 *                 type: string
 *                 enum: [apikey, basic]
 *     responses:
 *       200:
 *         description: Instance updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Instance not found
 *   delete:
 *     summary: Delete a Portainer instance
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Instance deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Instance not found
 */
router.get("/portainer/instances/:id", asyncHandler(portainerController.getInstance));
router.put("/portainer/instances/:id", asyncHandler(portainerController.updateInstance));
router.delete("/portainer/instances/:id", asyncHandler(portainerController.deleteInstance));

/**
 * @swagger
 * /portainer/instances/reorder:
 *   post:
 *     summary: Update the display order of Portainer instances
 *     tags: [Portainer]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orders
 *             properties:
 *               orders:
 *                 type: object
 *                 additionalProperties:
 *                   type: integer
 *                 example: { "1": 0, "2": 1, "3": 2 }
 *     responses:
 *       200:
 *         description: Order updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post("/portainer/instances/reorder", asyncHandler(portainerController.updateInstanceOrder));

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

/**
 * @swagger
 * /tracked-apps:
 *   get:
 *     summary: Get all tracked applications
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of tracked applications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 trackedApps:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *   post:
 *     summary: Create a new tracked application
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               imageName:
 *                 type: string
 *               githubRepo:
 *                 type: string
 *               sourceType:
 *                 type: string
 *                 enum: [docker, github]
 *     responses:
 *       201:
 *         description: Tracked app created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.get("/tracked-apps", asyncHandler(trackedAppController.getTrackedImages));
router.post("/tracked-apps", asyncHandler(trackedAppController.createTrackedApp));

/**
 * @swagger
 * /tracked-apps/check-updates:
 *   post:
 *     summary: Check for updates for all tracked applications
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Update check completed
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/tracked-apps/check-updates",
  asyncHandler(trackedAppController.checkTrackedImagesUpdates)
);

/**
 * @swagger
 * /tracked-apps/cache:
 *   delete:
 *     summary: Clear GitHub cache for tracked apps
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *       401:
 *         description: Unauthorized
 */
router.delete("/tracked-apps/cache", asyncHandler(trackedAppController.clearGitHubCache));

/**
 * @swagger
 * /tracked-apps/{id}:
 *   get:
 *     summary: Get a specific tracked application
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Tracked app details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tracked app not found
 *   put:
 *     summary: Update a tracked application
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               imageName:
 *                 type: string
 *               githubRepo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tracked app updated
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tracked app not found
 *   delete:
 *     summary: Delete a tracked application
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Tracked app deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tracked app not found
 */
router.get("/tracked-apps/:id", asyncHandler(trackedAppController.getTrackedImage));
router.put("/tracked-apps/:id", asyncHandler(trackedAppController.updateTrackedApp));
router.delete("/tracked-apps/:id", asyncHandler(trackedAppController.deleteTrackedApp));

/**
 * @swagger
 * /tracked-apps/{id}/check-update:
 *   post:
 *     summary: Check for updates for a specific tracked application
 *     tags: [Tracked Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Update check completed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tracked app not found
 */
router.post(
  "/tracked-apps/:id/check-update",
  asyncHandler(trackedAppController.checkTrackedImageUpdate)
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
/**
 * @swagger
 * /settings/color-scheme:
 *   get:
 *     summary: Get user's color scheme preference
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Color scheme preference
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 colorScheme:
 *                   type: string
 *                   enum: [light, dark, auto]
 *       401:
 *         description: Unauthorized
 *   post:
 *     summary: Set user's color scheme preference
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - colorScheme
 *             properties:
 *               colorScheme:
 *                 type: string
 *                 enum: [light, dark, auto]
 *     responses:
 *       200:
 *         description: Color scheme updated
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.get("/settings/color-scheme", asyncHandler(settingsController.getColorSchemeHandler));
router.post("/settings/color-scheme", asyncHandler(settingsController.setColorSchemeHandler));

/**
 * @swagger
 * /settings/refreshing-toggles-enabled:
 *   get:
 *     summary: Get whether refreshing toggles are enabled
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refreshing toggles enabled status
 *   post:
 *     summary: Set whether refreshing toggles are enabled
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Setting updated
 */
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
