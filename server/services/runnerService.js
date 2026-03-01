/**
 * Runner Service
 *
 * HTTP client for communicating with dockhand instances.
 * Handles container listing, health checks, and SSE stream proxying
 * for upgrade and log operations.
 */

const axios = require("axios");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Build an axios config for a runner request.
 * @param {string} apiKey
 * @returns {Object}
 */
function runnerAxiosConfig(apiKey, extra = {}) {
  return {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: REQUEST_TIMEOUT_MS,
    ...extra,
  };
}

/**
 * Ping a runner and return its health response.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @returns {Promise<Object>} health payload
 */
async function pingRunner(url, apiKey) {
  const resp = await axios.get(`${url}/health`, runnerAxiosConfig(apiKey));
  return resp.data;
}

/**
 * Fetch all containers from a runner.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @returns {Promise<Array>} raw ContainerInfo array from runner
 */
async function fetchRunnerContainers(url, apiKey) {
  const resp = await axios.get(`${url}/containers`, runnerAxiosConfig(apiKey));
  return resp.data?.containers ?? [];
}

/**
 * Normalize a runner ContainerInfo to the Docked container shape.
 * @param {Object} rc - Raw container from runner
 * @param {Object} runner - Runner DB row { id, name, url }
 * @returns {Object}
 */
function normalizeRunnerContainer(rc, runner) {
  return {
    id: rc.id,
    name: rc.name,
    imageName: rc.image,
    imageId: rc.imageId || null,
    status: rc.status || "",
    state: rc.state || "",
    created: rc.created || 0,
    ports: (rc.ports || []).map((p) => ({
      hostIp: p.hostIp || "",
      hostPort: p.hostPort || "",
      containerPort: p.containerPort || "",
      protocol: p.protocol || "tcp",
    })),
    labels: rc.labels || {},

    // Compose info
    stackName: rc.composeProject || null,
    composeProject: rc.composeProject || null,
    composeService: rc.composeService || null,
    composeWorkingDir: rc.composeWorkingDir || null,
    composeConfigFile: rc.composeConfigFile || null,

    // RepoDigests for update detection (populated when runner returns them)
    repoDigests: rc.repoDigests || null,
    currentDigest: rc.currentDigest || null,

    // Runner metadata (used by UI and upgrade routing)
    source: "runner",
    runnerId: runner.id,
    runnerName: runner.name,
    runnerUrl: runner.url,

    // Update info — not yet checked against registry in Phase 2
    hasUpdate: null,
    existsInDockerHub: null,
    latestDigest: null,
    lastChecked: null,

    // No portainer fields
    portainerName: null,
    portainerUrl: null,
    endpointId: null,
  };
}

/**
 * Fetch and normalize containers from all enabled runners for a user.
 * Failures from individual runners are logged and skipped (non-fatal).
 *
 * @param {Array} runners - Array of runner DB rows { id, name, url, api_key, enabled }
 * @returns {Promise<Array>} normalized container objects
 */
async function getContainersFromRunners(runners) {
  const results = [];

  await Promise.all(
    runners
      .filter((r) => r.enabled)
      .map(async (runner) => {
        try {
          const raw = await fetchRunnerContainers(runner.url, runner.api_key);
          for (const rc of raw) {
            results.push(normalizeRunnerContainer(rc, runner));
          }
          logger.debug(`Fetched ${raw.length} containers from runner "${runner.name}"`, {
            module: "runnerService",
            runnerId: runner.id,
          });
        } catch (err) {
          logger.warn(`Failed to fetch containers from runner "${runner.name}": ${err.message}`, {
            module: "runnerService",
            runnerId: runner.id,
          });
        }
      })
  );

  return results;
}

/**
 * Proxy an SSE upgrade stream from a runner to the browser.
 *
 * Sets up SSE headers on `res`, opens a streaming POST to the runner's
 * upgrade endpoint, and pipes each chunk directly to the browser.
 * Cleans up when the client disconnects.
 *
 * @param {Object} runner - Runner DB row { url, api_key }
 * @param {string} containerId
 * @param {import('http').IncomingMessage} req - Express request (for close detection)
 * @param {import('http').ServerResponse} res - Express response
 */
async function proxyUpgradeStream(runner, containerId, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let runnerStream = null;

  try {
    const response = await axios({
      method: "post",
      url: `${runner.url}/containers/${encodeURIComponent(containerId)}/upgrade`,
      headers: {
        Authorization: `Bearer ${runner.api_key}`,
        Accept: "text/event-stream",
      },
      responseType: "stream",
      timeout: 0,
    });

    runnerStream = response.data;

    runnerStream.on("data", (chunk) => {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    runnerStream.on("end", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    runnerStream.on("error", (err) => {
      logger.error(`Runner upgrade stream error for container ${containerId}: ${err.message}`, {
        module: "runnerService",
        containerId,
        runnerId: runner.id,
      });
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      }
    });
  } catch (err) {
    logger.error(`Failed to connect to runner for upgrade: ${err.message}`, {
      module: "runnerService",
      containerId,
      runnerId: runner.id,
    });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  req.on("close", () => {
    if (runnerStream) {
      runnerStream.destroy();
    }
  });
}

/**
 * Proxy an SSE log stream from a runner to the browser.
 *
 * @param {Object} runner - Runner DB row { url, api_key }
 * @param {string} containerId
 * @param {Object} opts - { tail?: string, follow?: boolean }
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
async function proxyLogsStream(runner, containerId, opts, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const params = new URLSearchParams();
  if (opts.tail) params.set("tail", opts.tail);
  if (opts.follow) params.set("follow", "true");

  let runnerStream = null;

  try {
    const response = await axios({
      method: "get",
      url: `${runner.url}/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`,
      headers: {
        Authorization: `Bearer ${runner.api_key}`,
        Accept: "text/event-stream",
      },
      responseType: "stream",
      timeout: 0,
    });

    runnerStream = response.data;

    runnerStream.on("data", (chunk) => {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    runnerStream.on("end", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    runnerStream.on("error", (err) => {
      logger.error(`Runner log stream error for container ${containerId}: ${err.message}`, {
        module: "runnerService",
      });
      if (!res.writableEnded) {
        res.end();
      }
    });
  } catch (err) {
    logger.error(`Failed to connect to runner for logs: ${err.message}`, {
      module: "runnerService",
    });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  req.on("close", () => {
    if (runnerStream) {
      runnerStream.destroy();
    }
  });
}

/**
 * Fetch the list of configured operations from a runner.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @returns {Promise<Object>} { operations: [...] }
 */
async function fetchRunnerOperations(url, apiKey) {
  const response = await axios.get(`${url}/operations`, runnerAxiosConfig(apiKey));
  return response.data;
}

/**
 * Fetch execution history for a named operation.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @param {string} operationName
 * @param {number} limit
 * @returns {Promise<Object>} { history: [...] }
 */
async function fetchRunnerOperationHistory(url, apiKey, operationName, limit = 20) {
  const response = await axios.get(
    `${url}/operations/${encodeURIComponent(operationName)}/history?limit=${limit}`,
    runnerAxiosConfig(apiKey)
  );
  return response.data;
}

/**
 * Proxy a POST SSE operation run stream from a runner to the browser.
 * @param {Object} runner - Runner DB row { id, url, api_key }
 * @param {string} operationName
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
async function proxyOperationRunStream(runner, operationName, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let runnerStream = null;

  try {
    const response = await axios({
      method: "post",
      url: `${runner.url}/operations/${encodeURIComponent(operationName)}/run`,
      headers: {
        Authorization: `Bearer ${runner.api_key}`,
        Accept: "text/event-stream",
      },
      responseType: "stream",
      timeout: 0,
    });

    runnerStream = response.data;

    runnerStream.on("data", (chunk) => {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    runnerStream.on("end", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    runnerStream.on("error", (err) => {
      logger.error(`Runner operation stream error for "${operationName}": ${err.message}`, {
        module: "runnerService",
        runnerId: runner.id,
      });
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      }
    });
  } catch (err) {
    logger.error(`Failed to connect to runner for operation run: ${err.message}`, {
      module: "runnerService",
      runnerId: runner.id,
    });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  req.on("close", () => {
    if (runnerStream) {
      runnerStream.destroy();
    }
  });
}

/**
 * Enrich a list of operation summaries with latestVersion from GitHub.
 * For each operation with versionSource.type === "github", fetches the
 * latest release (1-hr cached via githubService) and appends latestVersion.
 * Failures are non-fatal — operation gets latestVersion: null.
 *
 * @param {Array} operations - Array of OperationSummary objects from runner
 * @param {Object} githubService - github service with getLatestRelease(repo)
 * @returns {Promise<Array>} enriched operations
 */
/**
 * Trigger a self-update on the runner binary.
 * @param {Object} runner - Runner DB row { url, api_key }
 * @param {string} version - Target version tag (e.g. "v0.1.5")
 * @returns {Promise<Object>} runner response
 */
async function triggerRunnerUpdate(runner, version) {
  const resp = await axios.post(
    `${runner.url}/update`,
    { version },
    runnerAxiosConfig(runner.api_key)
  );
  return resp.data;
}

/**
 * Trigger self-uninstall on the runner.
 * @param {Object} runner - Runner DB row { url, api_key }
 * @returns {Promise<Object>} runner response
 */
async function triggerRunnerUninstall(runner) {
  const resp = await axios.post(
    `${runner.url}/uninstall`,
    {},
    runnerAxiosConfig(runner.api_key)
  );
  return resp.data;
}

async function enrichOperationsWithVersions(operations, githubService) {
  return Promise.all(
    operations.map(async (op) => {
      if (op.versionSource?.type !== "github" || !op.versionSource?.repo) {
        return op;
      }
      try {
        const release = await githubService.getLatestRelease(op.versionSource.repo);
        return { ...op, latestVersion: release?.tag_name ?? null };
      } catch {
        return { ...op, latestVersion: null };
      }
    })
  );
}

/**
 * Fetch the list of configured apps from a runner.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @returns {Promise<Object>} { apps: [...] }
 */
async function fetchRunnerApps(url, apiKey) {
  const response = await axios.get(`${url}/apps`, runnerAxiosConfig(apiKey));
  return response.data;
}

/**
 * Fetch execution history for a named app operation.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @param {string} appName
 * @param {string} opName
 * @param {number} limit
 * @returns {Promise<Object>} { history: [...] }
 */
async function fetchRunnerAppOperationHistory(url, apiKey, appName, opName, limit = 20) {
  const response = await axios.get(
    `${url}/apps/${encodeURIComponent(appName)}/operations/${encodeURIComponent(opName)}/history?limit=${limit}`,
    runnerAxiosConfig(apiKey)
  );
  return response.data;
}

/**
 * Fetch all app operation run history from a runner.
 * @param {string} url - Runner base URL
 * @param {string} apiKey
 * @param {number} limit
 * @returns {Promise<Object>} { history: [...] }
 */
async function fetchRunnerAppsAllHistory(url, apiKey, limit = 100) {
  const response = await axios.get(
    `${url}/apps/history?limit=${limit}`,
    runnerAxiosConfig(apiKey)
  );
  return response.data;
}

/**
 * Enrich a list of app summaries with latestVersion from GitHub.
 * For each app with versionSource.type === "github", fetches the latest release
 * and appends latestVersion. Failures are non-fatal — app gets latestVersion: null.
 *
 * @param {Array} apps - Array of AppSummary objects from runner
 * @param {Object} githubService - github service with getLatestRelease(repo)
 * @returns {Promise<Array>} enriched apps
 */
async function enrichAppsWithVersions(apps, githubService) {
  return Promise.all(
    apps.map(async (app) => {
      if (app.versionSource?.type !== "github" || !app.versionSource?.repo) {
        return app;
      }
      try {
        const release = await githubService.getLatestRelease(app.versionSource.repo);
        return { ...app, latestVersion: release?.tag_name ?? null };
      } catch {
        return { ...app, latestVersion: null };
      }
    })
  );
}

/**
 * Proxy a POST SSE app operation run stream from a runner to the browser.
 * @param {Object} runner - Runner DB row { id, url, api_key }
 * @param {string} appName
 * @param {string} opName
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
async function proxyAppOperationRunStream(runner, appName, opName, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let runnerStream = null;

  try {
    const response = await axios({
      method: "post",
      url: `${runner.url}/apps/${encodeURIComponent(appName)}/operations/${encodeURIComponent(opName)}/run`,
      headers: {
        Authorization: `Bearer ${runner.api_key}`,
        Accept: "text/event-stream",
      },
      responseType: "stream",
      timeout: 0,
    });

    runnerStream = response.data;

    runnerStream.on("data", (chunk) => {
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    runnerStream.on("end", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    runnerStream.on("error", (err) => {
      logger.error(`Runner app operation stream error for "${appName}:${opName}": ${err.message}`, {
        module: "runnerService",
        runnerId: runner.id,
      });
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      }
    });
  } catch (err) {
    logger.error(`Failed to connect to runner for app operation run: ${err.message}`, {
      module: "runnerService",
      runnerId: runner.id,
    });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  req.on("close", () => {
    if (runnerStream) {
      runnerStream.destroy();
    }
  });
}

module.exports = {
  pingRunner,
  fetchRunnerContainers,
  normalizeRunnerContainer,
  getContainersFromRunners,
  proxyUpgradeStream,
  proxyLogsStream,
  fetchRunnerOperations,
  fetchRunnerOperationHistory,
  proxyOperationRunStream,
  enrichOperationsWithVersions,
  fetchRunnerApps,
  fetchRunnerAppOperationHistory,
  fetchRunnerAppsAllHistory,
  enrichAppsWithVersions,
  proxyAppOperationRunStream,
  triggerRunnerUpdate,
  triggerRunnerUninstall,
};
