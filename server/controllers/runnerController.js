/**
 * Runner Controller
 * Browser-facing proxy routes for dockhand runner instances: upgrade and
 * operation SSE streams plus apps listings. The dockhand agent protocol
 * (install script, register, heartbeat, re-enroll) and the enrollment
 * endpoints now live in the Go backend (internal/api/handlers); Node keeps
 * the edge limiters and streams those routes through utils/goRunnerProxy.js.
 */

const { getRunnerById } = require("../db/runners");
const {
  proxyUpgradeStream,
  fetchRunnerOperations,
  enrichOperationsWithVersions,
  proxyOperationRunStream,
  fetchRunnerApps,
  enrichAppsWithVersions,
  fetchRunnerAppsAllHistory,
  proxyAppOperationRunStream,
} = require("../services/runnerService");
const githubService = require("../services/githubService");

/**
 * POST /api/runners/:runnerId/containers/:containerId/upgrade  (SSE)
 * Proxies the runner's upgrade SSE stream to the browser.
 */
async function upgradeRunnerContainer(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { containerId } = req.params;

    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }

    // Acquire upgrade lock to prevent conflicts with intent-driven, batch, or manual upgrades
    const upgradeLockManager = require("../services/intents/upgradeLockManager");
    const lockOpts = { runnerId };
    const lockToken = await upgradeLockManager.acquire(containerId, {
      ...lockOpts,
      owner: "runner-sse",
    });
    if (!lockToken) {
      const lockInfo = upgradeLockManager.isLocked(containerId, lockOpts);
      return res.status(409).json({
        success: false,
        error: `Upgrade already in progress (locked by ${lockInfo.owner || "unknown"})`,
      });
    }

    try {
      await proxyUpgradeStream(runner, containerId, req, res);
    } finally {
      await upgradeLockManager.release(containerId, { ...lockOpts, lockToken });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/operations
 * Returns the list of named operations configured on the runner.
 */
async function getRunnerOperations(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerOperations(runner.url, runner.api_key);
    const enriched = await enrichOperationsWithVersions(data.operations ?? [], githubService);
    res.json({ success: true, operations: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:runnerId/operations/:name/run  (SSE)
 * Proxies a live operation run stream from the runner to the browser.
 */
async function runRunnerOperation(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { name } = req.params;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    await proxyOperationRunStream(runner, name, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/apps
 * Returns the list of named apps configured on the runner.
 */
async function getRunnerApps(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerApps(runner.url, runner.api_key);
    const enriched = await enrichAppsWithVersions(data.apps ?? [], githubService);
    res.json({ success: true, apps: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:runnerId/apps/:appName/operations/:opName/run  (SSE)
 * Proxies a live app operation run stream from the runner to the browser.
 */
async function runRunnerAppOperation(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { appName, opName } = req.params;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    await proxyAppOperationRunStream(runner, appName, opName, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/apps/history
 * Returns all app operation run history from the runner.
 */
async function getRunnerAppsHistory(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const limit = parseInt(req.query.limit, 10) || 100;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerAppsAllHistory(runner.url, runner.api_key, limit);
    // Attach runnerId/runnerName to each record for the client to group/label
    const history = (data.history || []).map((r) => ({
      ...r,
      runnerId: runner.id,
      runnerName: runner.name,
    }));
    res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  upgradeRunnerContainer,
  getRunnerOperations,
  runRunnerOperation,
  getRunnerApps,
  runRunnerAppOperation,
  getRunnerAppsHistory,
};
