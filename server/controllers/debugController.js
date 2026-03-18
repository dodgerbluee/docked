/**
 * Debug Controller
 *
 * Admin-only debug endpoints for AI/operator introspection.
 * All handlers require instanceAdmin privileges.
 *
 *   GET  /api/debug/health         - Extended server health
 *   POST /api/debug/db             - Read-only SQL query
 *   GET  /api/debug/cache          - Cache state
 *   GET  /api/debug/locks          - Upgrade lock state
 *   GET  /api/debug/logs           - Server log tail
 *   POST /api/debug/cache/clear    - Clear all caches
 *   GET  /api/debug/runner/:id/*   - Proxy to runner's /debug/* endpoints
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const logger = require("../utils/logger");
const { getDatabase } = require("../db/connection");
const { getRunnerById } = require("../db/runners");
const upgradeLockManager = require("../services/intents/upgradeLockManager");

const logsDir = process.env.LOGS_DIR || path.join(__dirname, "../../logs");

// ── Auth helper ─────────────────────────────────────────────────────────────

function requireAdmin(req, res) {
  if (!req.user?.instanceAdmin) {
    res.status(403).json({ error: "Instance admin access required" });
    return false;
  }
  return true;
}

// ── GET /api/debug/health ────────────────────────────────────────────────────

async function getServerHealth(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());
    const db = getDatabase();

    // Quick DB connectivity check
    const dbStats = await new Promise((resolve) => {
      db.get("SELECT count(*) as tables FROM sqlite_master WHERE type='table'", (err, row) => {
        resolve(err ? { error: err.message } : { tables: row?.tables ?? 0 });
      });
    });

    res.json({
      status: "ok",
      uptimeSeconds,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      hostname: os.hostname(),
      loadAvg: os.loadavg(),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      processMemMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      db: dbStats,
      upgradeLocks: upgradeLockManager.size,
    });
  } catch (err) {
    logger.error("debugController: getServerHealth error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/debug/db ───────────────────────────────────────────────────────

// Only these statement types are allowed.
const ALLOWED_SQL_PREFIXES = ["select", "explain", "pragma"];

async function runDbQuery(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { sql, params = [] } = req.body || {};

    if (!sql || typeof sql !== "string") {
      return res.status(400).json({ error: "sql is required" });
    }

    // Reject anything that's not a read-only statement
    const normalized = sql.trim().toLowerCase();
    const allowed = ALLOWED_SQL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
    if (!allowed) {
      return res
        .status(400)
        .json({ error: "Only SELECT, EXPLAIN, and PRAGMA statements are allowed" });
    }

    if (!Array.isArray(params)) {
      return res.status(400).json({ error: "params must be an array" });
    }

    const db = getDatabase();
    // sql is validated above to start with SELECT/EXPLAIN/PRAGMA (read-only).
    // params are passed separately (parameterized query). Admin-only endpoint.
    // lgtm[js/sql-injection]
    const rows = await new Promise((resolve, reject) => {
      db.all(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result || []);
      });
    });

    res.json({ rows, count: rows.length });
  } catch (err) {
    logger.error("debugController: runDbQuery error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/debug/cache ─────────────────────────────────────────────────────

async function getCacheState(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    // Import lazily to avoid circular deps
    const containerCacheService = require("../services/cache/containerCacheService");

    const caches = {
      containerMemoryCache: {
        size: containerCacheService.getMemoryCacheSize(),
      },
    };

    res.json({ caches, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("debugController: getCacheState error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/debug/locks ─────────────────────────────────────────────────────

async function getLockState(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const locks = [];
    for (const [key, entry] of upgradeLockManager.locks) {
      locks.push({
        key,
        owner: entry.owner,
        acquiredAt: new Date(entry.acquiredAt).toISOString(),
        ageMs: Date.now() - entry.acquiredAt,
      });
    }
    res.json({ locks, count: locks.length });
  } catch (err) {
    logger.error("debugController: getLockState error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/debug/logs ──────────────────────────────────────────────────────

// Strict allowlist — only these filenames may be requested via ?file=
const ALLOWED_LOG_FILES = ["combined.log", "error.log"];

function getServerLogs(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const lines = Math.min(parseInt(req.query.lines, 10) || 100, 2000);
    const logFile = req.query.file || "combined.log";

    if (!ALLOWED_LOG_FILES.includes(logFile)) {
      return res.status(400).json({ error: "Invalid log file. Allowed: " + ALLOWED_LOG_FILES.join(", ") });
    }

    const logFilePath = path.join(path.resolve(logsDir), logFile);

    if (!fs.existsSync(logFilePath)) {
      return res.json({ lines: [], count: 0, note: "Log file not found" });
    }

    const content = fs.readFileSync(logFilePath, "utf8");
    const allLines = content.split("\n");
    const recent = allLines.slice(-lines).filter((l) => l.trim());

    res.json({ lines: recent, count: recent.length, totalLines: allLines.length });
  } catch (err) {
    logger.error("debugController: getServerLogs error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/debug/cache/clear ──────────────────────────────────────────────

async function clearAllCaches(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const containerCacheService = require("../services/cache/containerCacheService");
    containerCacheService.clearMemoryCache();

    res.json({ success: true, message: "All caches cleared" });
  } catch (err) {
    logger.error("debugController: clearAllCaches error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/debug/runner/:runnerId/* ────────────────────────────────────────
// Proxies requests to the runner's /debug/* endpoints.

async function proxyToRunner(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { runnerId } = req.params;
    const runner = await getRunnerById(parseInt(runnerId, 10), req.user.id);

    if (!runner) {
      return res.status(404).json({ error: "Runner not found" });
    }
    if (!runner.api_key) {
      return res.status(400).json({ error: "Runner has no API key configured" });
    }

    // req.path inside this sub-router is the remainder after /runner/:runnerId
    // e.g. for GET /api/debug/runner/3/container/abc/inspect → req.params[0] = "container/abc/inspect"
    const remainder = req.params[0] || "";
    const runnerPath = `/debug/${remainder}`.replace(/\/+/g, "/");

    const runnerUrl = `${runner.url}${runnerPath}`;
    if (req.url.includes("?")) {
      const qs = req.url.slice(req.url.indexOf("?"));
      // append query string
      const fullUrl = `${runnerUrl}${qs}`;
      const resp = await axios({
        method: req.method.toLowerCase(),
        url: fullUrl,
        headers: { Authorization: `Bearer ${runner.api_key}` },
        data: req.body,
        timeout: 30_000,
        validateStatus: () => true,
      });
      return res.status(resp.status).json(resp.data);
    }

    const resp = await axios({
      method: req.method.toLowerCase(),
      url: runnerUrl,
      headers: { Authorization: `Bearer ${runner.api_key}` },
      data: req.body,
      timeout: 30_000,
      validateStatus: () => true,
    });

    res.status(resp.status).json(resp.data);
  } catch (err) {
    logger.error("debugController: proxyToRunner error", { error: err.message });
    res.status(502).json({ error: "Runner proxy error: " + err.message });
  }
}

module.exports = {
  getServerHealth,
  runDbQuery,
  getCacheState,
  getLockState,
  getServerLogs,
  clearAllCaches,
  proxyToRunner,
};
