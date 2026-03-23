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

// Named read-only queries. SQL is never sourced from user input.
const DB_QUERY_CATALOG = {
  "list-tables":
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
  schema: "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
  containers:
    "SELECT id, user_id, container_id, runner_id, portainer_instance_id, endpoint_id, image, name, created_at FROM containers ORDER BY created_at DESC LIMIT 100",
  "containers-count": "SELECT COUNT(*) AS count FROM containers",
  runners:
    "SELECT id, user_id, name, url, enabled, docker_enabled, version, latest_version, last_seen, docker_status, created_at FROM runners ORDER BY created_at ASC",
  "upgrade-history":
    "SELECT id, user_id, container_id, runner_id, runner_name, old_image, new_image, status, created_at FROM upgrade_history ORDER BY created_at DESC LIMIT 100",
  "upgrade-history-failed":
    "SELECT id, user_id, container_id, runner_id, runner_name, old_image, new_image, status, error, created_at FROM upgrade_history WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50",
  settings:
    "SELECT key, user_id, SUBSTR(value, 1, 200) AS value_preview, created_at FROM settings ORDER BY user_id, key",
  "system-settings": "SELECT key, value, created_at FROM system_settings ORDER BY key",
};

// Only these SQL statement types are permitted for raw queries
const ALLOWED_SQL_PREFIXES = ["select", "explain", "pragma", "with"];

function isReadOnlySql(sql) {
  const first = sql.trim().toLowerCase().split(/\s+/)[0];
  return ALLOWED_SQL_PREFIXES.includes(first);
}

async function runDbQuery(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { query: queryKey, sql: rawSql, params: rawParams } = req.body || {};

    let sql;
    let queryLabel;

    if (rawSql) {
      // Raw SQL path (used by MCP client)
      if (typeof rawSql !== "string" || !isReadOnlySql(rawSql)) {
        return res.status(400).json({
          error: "Only SELECT, EXPLAIN, PRAGMA, and WITH queries are allowed",
        });
      }
      sql = rawSql;
      queryLabel = "raw";
    } else if (queryKey) {
      // Named query path (used by UI)
      const namedSql = DB_QUERY_CATALOG[queryKey];
      if (!namedSql) {
        return res
          .status(400)
          .json({ error: `Unknown query "${queryKey}"`, available: Object.keys(DB_QUERY_CATALOG) });
      }
      sql = namedSql;
      queryLabel = queryKey;
    } else {
      return res
        .status(400)
        .json({ error: "Either sql or query is required", available: Object.keys(DB_QUERY_CATALOG) });
    }

    const params = Array.isArray(rawParams) ? rawParams : [];
    const db = getDatabase();
    const rows = await new Promise((resolve, reject) => {
      db.all(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result || []);
      });
    });

    res.json({ rows, count: rows.length, query: queryLabel });
  } catch (err) {
    logger.error("debugController: runDbQuery error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

async function getDbQueryCatalog(req, res) {
  if (!requireAdmin(req, res)) return;
  res.json({ queries: Object.keys(DB_QUERY_CATALOG) });
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
      return res
        .status(400)
        .json({ error: "Invalid log file. Allowed: " + ALLOWED_LOG_FILES.join(", ") });
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

    // req.params.path captures the remainder after /runner/:runnerId/
    // e.g. for GET /api/debug/runner/3/container/abc/inspect → req.params.path = "container/abc/inspect"
    const remainder = req.params.path || "";
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
  getDbQueryCatalog,
  getCacheState,
  getLockState,
  getServerLogs,
  clearAllCaches,
  proxyToRunner,
};
