/**
 * Debug Routes
 *
 * Mounted at /api/debug — admin-only introspection endpoints.
 * Auth (authenticate) is applied in routes/index.js before mounting this router.
 * The `requireDebugEnabled` middleware gates all routes behind the
 * `debug_endpoints_enabled` system setting (off by default).
 * Admin check (instanceAdmin) is enforced inside each controller handler.
 */

const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const { getSystemSetting } = require("../db/settings");
const debug = require("../controllers/debugController");

const router = express.Router();

// Gate: reject all requests unless debug endpoints are enabled in settings.
async function requireDebugEnabled(req, res, next) {
  try {
    const value = await getSystemSetting("debug_endpoints_enabled");
    if (value !== "true") {
      return res.status(403).json({ error: "Debug endpoints are disabled. Enable them in Admin → General Settings." });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Failed to check debug setting: " + err.message });
  }
}

router.use(asyncHandler(requireDebugEnabled));

// Server health & state
router.get("/health", asyncHandler(debug.getServerHealth));
router.get("/cache", asyncHandler(debug.getCacheState));
router.get("/locks", asyncHandler(debug.getLockState));
router.get("/logs", debug.getServerLogs);

// Read-only SQL query
router.post("/db", asyncHandler(debug.runDbQuery));

// Cache management
router.post("/cache/clear", asyncHandler(debug.clearAllCaches));

// Runner debug proxy — forwards to runner's /debug/* endpoints
router.all("/runner/:runnerId/*", asyncHandler(debug.proxyToRunner));

module.exports = router;
