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
const containerController = require("../controllers/containerController");
const containerDebugController = require("../controllers/containerDebugController");
const imageController = require("../controllers/imageController");
const authController = require("../controllers/authController");
const sourceController = require("../controllers/sourceController");
const avatarController = require("../controllers/avatarController");
const batchController = require("../controllers/batchController");
const trackedAppController = require("../controllers/trackedImageController");
const trackedAppHistoryController = require("../controllers/trackedAppController");
const discordController = require("../controllers/discordController");
const settingsController = require("../controllers/settingsController");
const versionController = require("../controllers/versionController");
const logsController = require("../controllers/logsController");
const repositoryAccessTokenController = require("../controllers/repositoryAccessTokenController");
const intentController = require("../controllers/intentController");
const oauthController = require("../controllers/oauthController");
const ssoAdminController = require("../controllers/ssoAdminController");
const runnerController = require("../controllers/runnerController");
const debugRouter = require("./debug");
const { getAllRunners } = require("../db/runners");
const { getContainersFromRunners } = require("../services/runnerService");
const {
  getRegistryImageVersion,
  upsertRegistryImageVersion,
} = require("../db/registryImageVersions");
const { getDatabase } = require("../db/connection");
const { parseImageName } = require("../utils/imageRepoParser");
const { computeHasUpdate } = require("../utils/containerUpdateHelpers");
const { asyncHandler } = require("../middleware/errorHandler");
const { authenticate } = require("../middleware/auth");
const { validate, validationChains } = require("../middleware/validation");
const { param } = require("express-validator");

const router = express.Router();
const logger = require("../utils/logger");

/**
 * Perform a registry check for a runner container image and update registry_image_versions.
 * @returns {Promise<Object|null>} The checkImageUpdates result, or null on failure.
 */
async function checkRunnerImageRegistry(userId, container, imageRepo, tag) {
  const imageUpdateService = require("../services/imageUpdateService");
  const result = await imageUpdateService.checkImageUpdates(
    container.image,
    null,
    null,
    null,
    userId
  );
  if (result && (result.latestDigestFull || result.latestDigest)) {
    await upsertRegistryImageVersion(userId, imageRepo, tag, {
      latestDigest: result.latestDigestFull || result.latestDigest,
      latestVersion: result.latestVersion || null,
      latestPublishDate: result.latestPublishDate || null,
      provider: result.provider || null,
      existsInRegistry: true,
    });
    return result;
  }
  return null;
}

/**
 * Fetch stored repo_digests from deployed_images for a container.
 * Used as a fallback when the live runner doesn't return repoDigests.
 * @returns {string[]|null} parsed repo_digests array or null
 */
async function getStoredRepoDigests(userId, containerId) {
  const db = getDatabase();
  return new Promise((resolve) => {
    db.get(
      `SELECT di.repo_digests
       FROM containers c
       JOIN deployed_images di ON c.deployed_image_id = di.id
       WHERE c.container_id = ? AND c.user_id = ?
       LIMIT 1`,
      [containerId, userId],
      (err, row) => {
        if (err || !row || !row.repo_digests) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(row.repo_digests));
        } catch (parseErr) {
          logger.debug("getStoredRepoDigests: failed to parse repo_digests", {
            error: parseErr.message,
          });
          resolve(null);
        }
      }
    );
  });
}

/**
 * Enrich a runner container with registry update info.
 * - forceRefresh=false (default): use cached registry_image_versions; if missing, trigger
 *   a background check so the next page load has data.
 * - forceRefresh=true (Check for Updates): bypass cache, hit the registry synchronously,
 *   update the DB, and return enriched data in the same request.
 */
async function enrichRunnerContainer(userId, container, forceRefresh = false) {
  try {
    const { imageRepo, tag } = parseImageName(container.image);

    // Merge live and stored repo_digests for accurate multi-arch update detection.
    // Live digests from dockhand contain the arch-specific digest, while stored
    // digests (from deployed_images after upgrade) may also include the manifest-list
    // digest. Both are needed: computeHasUpdate checks if latestDigest (manifest-list)
    // exists in repoDigests to determine if the container is up-to-date.
    const liveRepoDigests = container.repoDigests || [];
    const storedRepoDigests = (await getStoredRepoDigests(userId, container.id)) || [];
    const repoDigests =
      liveRepoDigests.length > 0 || storedRepoDigests.length > 0
        ? [...new Set([...liveRepoDigests, ...storedRepoDigests])]
        : liveRepoDigests;

    if (!forceRefresh) {
      const cached = await getRegistryImageVersion(userId, imageRepo, tag);
      if (cached && cached.latest_digest) {
        const enriched = {
          ...container,
          repoDigests,
          latestDigest: cached.latest_digest,
          latestVersion: cached.latest_version || null,
          latestPublishDate: cached.latest_publish_date || null,
          lastChecked: cached.last_checked || null,
          provider: cached.provider || null,
          existsInDockerHub: true,
          noDigest: false,
        };
        return { ...enriched, hasUpdate: computeHasUpdate(enriched) };
      }
      // No cache — fire-and-forget so the next load has data
      checkRunnerImageRegistry(userId, container, imageRepo, tag).catch((err) => {
        logger.debug(`Background registry check failed for runner image ${container.image}:`, {
          module: "routes",
          error: err.message,
        });
      });
      return container;
    }

    // Force refresh: hit registry, await result, update DB, return enriched
    const result = await checkRunnerImageRegistry(userId, container, imageRepo, tag);
    if (result) {
      const fullDigest = result.latestDigestFull || result.latestDigest;
      const enriched = {
        ...container,
        repoDigests,
        latestDigest: fullDigest,
        latestVersion: result.latestVersion || null,
        latestPublishDate: result.latestPublishDate || null,
        lastChecked: new Date().toISOString(),
        provider: result.provider || null,
        existsInDockerHub: true,
        noDigest: false,
      };
      return { ...enriched, hasUpdate: computeHasUpdate(enriched) };
    }
  } catch (err) {
    logger.debug(`Runner container enrichment failed for ${container.name}:`, {
      module: "routes",
      error: err.message,
    });
  }
  return container;
}

/**
 * Middleware that appends runner-sourced containers to the /containers response.
 * Runner fetch failures are non-fatal — Portainer containers are always returned.
 */
function appendRunnerContainers(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    // Restore immediately so we never double-intercept
    res.json = originalJson;

    if (!Array.isArray(data?.containers) || !req.user?.id) {
      logger.debug(
        `appendRunnerContainers: skipping — containers array: ${Array.isArray(data?.containers)}, userId: ${req.user?.id}`,
        { module: "routes" }
      );
      return originalJson(data);
    }

    // Skip runner requests when client only needs Portainer/source containers
    if (req.query.portainerOnly === "true" || req.query.sourceOnly === "true") {
      return originalJson(data);
    }

    const userId = req.user.id;
    getAllRunners(userId)
      .then((runners) => {
        logger.debug(
          `appendRunnerContainers: found ${runners.length} runners for user ${userId}, enabled: ${runners.filter((r) => r.enabled).length}`,
          { module: "routes" }
        );
        return getContainersFromRunners(runners, { bypassCache: req.method === "POST" });
      })
      .then(async (runnerContainers) => {
        logger.debug(
          `appendRunnerContainers: got ${runnerContainers.length} runner containers, base containers: ${data.containers.length}`,
          { module: "routes" }
        );
        // Always remove runner containers from the DB cache — fresh runner data
        // is the source of truth (avoids duplicates and stale entries)
        const baseContainers = data.containers.filter((c) => c.source !== "runner" && !c.runnerId);

        if (runnerContainers.length > 0) {
          // Two-pass: detect which containers are network providers before enriching.
          // A container "provides network" if another container has networkMode = "container:<id|name>"
          // or "service:<name>" pointing to it.
          const providerIds = new Set();
          const providerNames = new Set();
          for (const c of runnerContainers) {
            const nm = c.networkMode || "";
            if (nm.startsWith("container:")) {
              providerIds.add(nm.slice("container:".length));
              providerNames.add(nm.slice("container:".length));
            } else if (nm.startsWith("service:")) {
              providerNames.add(nm.slice("service:".length));
            }
          }
          for (const c of runnerContainers) {
            if (providerIds.has(c.id) || providerNames.has(c.name)) {
              c.providesNetwork = true;
            }
          }

          // POST /containers/pull = "Check for Updates": bypass cache and hit registry directly
          const isForceRefresh = req.method === "POST";
          const enriched = await Promise.all(
            runnerContainers.map((c) => enrichRunnerContainer(userId, c, isForceRefresh))
          );
          data = { ...data, containers: [...baseContainers, ...enriched] };
          logger.debug(
            `appendRunnerContainers: final container count: ${data.containers.length} (${enriched.length} from runners)`,
            { module: "routes" }
          );
        } else {
          data = { ...data, containers: baseContainers };
        }
        originalJson(data);
      })
      .catch((err) => {
        logger.warn("Runner container fetch failed, returning Portainer-only results:", {
          module: "routes",
          error: err.message,
          stack: err.stack,
        });
        originalJson(data);
      });
  };
  next();
}

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
router.get(
  "/auth/registration-code-required",
  publicLimiter,
  asyncHandler(authController.checkRegistrationCodeRequired)
);
// Auth routes (public - no authentication required)
router.get("/auth/check-user-exists", publicLimiter, asyncHandler(authController.checkUserExists));
router.post(
  "/auth/generate-registration-code",
  authLimiter,
  asyncHandler(authController.generateRegistrationCodeEndpoint)
);
router.post(
  "/auth/verify-registration-code",
  authLimiter,
  asyncHandler(authController.verifyRegistrationCode)
);
router.post("/auth/register", authLimiter, asyncHandler(authController.register));
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

// Validation endpoints (public - used during import process)
router.post(
  "/portainer/instances/validate",
  publicLimiter,
  asyncHandler(sourceController.validateInstance)
);
router.post("/discord/test", publicLimiter, asyncHandler(discordController.testDiscordWebhook));

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

// Instance admin token routes (require authentication)
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

// Admin SSO provider management routes (protected - instanceAdmin checked inside handlers)
router.get("/admin/sso/providers", asyncHandler(ssoAdminController.listProviders));
router.post("/admin/sso/providers", writeLimiter, asyncHandler(ssoAdminController.createProvider));
router.post(
  "/admin/sso/providers/test",
  writeLimiter,
  asyncHandler(ssoAdminController.testProvider)
);
router.put(
  "/admin/sso/providers/:id",
  writeLimiter,
  asyncHandler(ssoAdminController.updateProvider)
);
router.delete(
  "/admin/sso/providers/:id",
  destructiveLimiter,
  asyncHandler(ssoAdminController.deleteProvider)
);
router.get("/admin/sso/settings", asyncHandler(ssoAdminController.getSettings));
router.put("/admin/sso/settings", writeLimiter, asyncHandler(ssoAdminController.updateSettings));

// User management routes (protected)
router.get("/auth/users", asyncHandler(authController.getAllUsersEndpoint));
router.get("/auth/users/:userId/stats", asyncHandler(authController.getUserStatsEndpoint));
router.get("/auth/export-users", asyncHandler(authController.exportUsersEndpoint));
router.post("/auth/update-password", writeLimiter, asyncHandler(authController.updateUserPassword));
router.post("/auth/update-username", writeLimiter, asyncHandler(authController.updateUserUsername));
router.post(
  "/auth/users/:userId/password",
  writeLimiter,
  asyncHandler(authController.adminUpdateUserPassword)
);
router.put(
  "/auth/users/:userId/role",
  writeLimiter,
  asyncHandler(authController.adminUpdateUserRole)
);
router.delete(
  "/auth/users/:userId",
  destructiveLimiter,
  asyncHandler(authController.adminDeleteUser)
);
router.get("/user/export-config", asyncHandler(authController.exportUserConfig));

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
router.get("/containers", appendRunnerContainers, asyncHandler(containerController.getContainers));

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
router.post(
  "/containers/pull",
  destructiveLimiter,
  appendRunnerContainers,
  asyncHandler(containerController.pullContainers)
);

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
router.delete(
  "/containers/data",
  destructiveLimiter,
  asyncHandler(containerController.clearContainerData)
);

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
router.post(
  "/containers/batch-upgrade",
  destructiveLimiter,
  asyncHandler(containerController.batchUpgradeContainers)
);

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
  destructiveLimiter,
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
router.post("/images/delete", destructiveLimiter, asyncHandler(imageController.deleteImages));

// Upgrade history routes
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

/**
 * Get container debug information (developer mode only)
 * @route GET /api/containers/:containerId/debug
 */
router.get(
  "/containers/:containerId/debug",
  asyncHandler(containerDebugController.getContainerDebugInfo)
);

// Portainer instance routes (legacy - kept for backward compatibility)
router.post("/portainer/instances", writeLimiter, asyncHandler(sourceController.createInstance));

router.put("/portainer/instances/:id", writeLimiter, asyncHandler(sourceController.updateInstance));
router.post("/portainer/instances/:id/health", asyncHandler(sourceController.healthCheckInstance));

// Source instance routes (new canonical paths)
/**
 * @swagger
 * /sources/instances:
 *   get:
 *     summary: Get all source instances for current user
 *     tags: [Sources]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of source instances
 *       401:
 *         description: Unauthorized
 *   post:
 *     summary: Create a new source instance
 *     tags: [Sources]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Source instance created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.get("/sources/instances", asyncHandler(sourceController.getInstances));
router.post("/sources/instances/reorder", asyncHandler(sourceController.updateInstanceOrder));

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
router.post("/avatars", writeLimiter, asyncHandler(avatarController.uploadAvatar));
router.delete("/avatars", destructiveLimiter, asyncHandler(avatarController.deleteAvatar));

// Batch configuration routes
router.get("/batch/config", asyncHandler(batchController.getBatchConfigHandler));
router.post("/batch/config", writeLimiter, asyncHandler(batchController.updateBatchConfigHandler));
router.post(
  "/batch/trigger",
  destructiveLimiter,
  asyncHandler(batchController.triggerBatchJobHandler)
);
router.get("/batch/log-level", asyncHandler(batchController.getLogLevelHandler));
router.post("/batch/log-level", writeLimiter, asyncHandler(batchController.setLogLevelHandler));
router.post("/batch/runs", writeLimiter, asyncHandler(batchController.createBatchRunHandler));
router.put("/batch/runs/:id", writeLimiter, asyncHandler(batchController.updateBatchRunHandler));
router.get("/batch/runs/latest", asyncHandler(batchController.getLatestBatchRunHandler));
router.get("/batch/runs", asyncHandler(batchController.getRecentBatchRunsHandler));

// Intent routes
// IMPORTANT: Specific/static routes must come before parameterized routes
router.get("/intents/executions/recent", asyncHandler(intentController.getRecentExecutionsHandler));
router.get(
  "/intents/executions/:executionId",
  asyncHandler(intentController.getExecutionDetailHandler)
);
router.get("/intents/:id/preview", asyncHandler(intentController.getIntentPreviewHandler));
router.post("/intents/:id/dry-run", asyncHandler(intentController.dryRunIntentHandler));

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
router.post("/tracked-apps", writeLimiter, asyncHandler(trackedAppController.createTrackedApp));

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
router.delete(
  "/tracked-apps/cache",
  destructiveLimiter,
  asyncHandler(trackedAppController.clearGitHubCache)
);

router.put("/tracked-apps/:id", writeLimiter, asyncHandler(trackedAppController.updateTrackedApp));
router.delete(
  "/tracked-apps/:id",
  destructiveLimiter,
  asyncHandler(trackedAppController.deleteTrackedApp)
);

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
router.post(
  "/discord/webhooks",
  writeLimiter,
  asyncHandler(discordController.createDiscordWebhook)
);
router.put(
  "/discord/webhooks/:id",
  writeLimiter,
  asyncHandler(discordController.updateDiscordWebhook)
);
router.post(
  "/discord/webhooks/:id/test",
  writeLimiter,
  asyncHandler(discordController.testDiscordWebhookById)
);
router.get("/discord/webhooks/info", asyncHandler(discordController.getWebhookInfo));

// Settings routes

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

router.get(
  "/settings/disallowed-containers",
  asyncHandler(settingsController.getDisallowedContainersHandler)
);
router.put(
  "/settings/disallowed-containers",
  writeLimiter,
  asyncHandler(settingsController.setDisallowedContainersHandler)
);

router.get(
  "/settings/debug-endpoints-enabled",
  asyncHandler(settingsController.getDebugEndpointsEnabledHandler)
);
router.post(
  "/settings/debug-endpoints-enabled",
  writeLimiter,
  asyncHandler(settingsController.setDebugEndpointsEnabledHandler)
);

// Repository access token routes

router.get(
  "/repository-access-tokens/:id/associated-images",
  repositoryAssociatedImagesRateLimiter,
  asyncHandler(repositoryAccessTokenController.getAssociatedImages)
);

router.post(
  "/repository-access-tokens/:id/associate-images",
  associateImagesLimiter,
  asyncHandler(repositoryAccessTokenController.associateImages)
);

// Logs routes
router.get("/logs", asyncHandler(logsController.getLogsHandler));

// Runner routes (dockhand agent instances)
// IMPORTANT: Specific/static routes must come before parameterized routes
router.get("/runners", asyncHandler(runnerController.getRunners));
router.post("/runners/enrollment", writeLimiter, asyncHandler(runnerController.createEnrollment));
router.get("/runners/enrollment-status", asyncHandler(runnerController.getEnrollmentStatus));
router.put("/runners/:id", writeLimiter, asyncHandler(runnerController.updateRunnerHandler));
router.delete(
  "/runners/:id",
  destructiveLimiter,
  asyncHandler(runnerController.deleteRunnerHandler)
);
router.post("/runners/:id/health", asyncHandler(runnerController.healthCheckRunner));
router.post("/runners/:id/update", writeLimiter, asyncHandler(runnerController.updateRunnerBinary));
// Runner health & diagnostics
router.get("/runners/:id/events", asyncHandler(runnerController.getRunnerEventsHandler));
router.get("/runners/:id/logs", asyncHandler(runnerController.getRunnerLogsHandler));
router.post(
  "/runners/:id/uninstall",
  destructiveLimiter,
  asyncHandler(runnerController.uninstallRunnerHandler)
);
router.post(
  "/runners/:id/restart",
  destructiveLimiter,
  asyncHandler(runnerController.restartRunnerHandler)
);
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
