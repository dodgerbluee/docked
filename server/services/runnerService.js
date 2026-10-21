/**
 * Runner Service
 *
 * HTTP client for communicating with dockhand instances, used by the intent
 * engine and batch handlers: container listing, health checks, and app
 * listings. The browser-facing proxy routes (upgrade/operation SSE streams,
 * operations listings, app history) now live in the Go backend
 * (internal/api/handlers/runnerUser.go) behind utils/goRunnerProxy.js.
 */

const axios = require("axios");
const logger = require("../utils/logger");
const { EVENT_TYPES, insertRunnerEvent } = require("../db/runnerEvents");

const REQUEST_TIMEOUT_MS = 10_000;

// ── Runner container cache ──────────────────────────────────────────────────
// Prevents repeated hits to runner /containers endpoints within a short window.
// Key: sorted comma-joined runner IDs, Value: { data, timestamp }
const _runnerContainerCache = new Map();
const RUNNER_CACHE_TTL_MS = 120_000; // 2 minutes

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
  // Clean repoDigests to sha256-only format.
  // Docker (and dockhand) return entries like "ghcr.io/image@sha256:abc..." — strip the image prefix.
  const cleanRepoDigests = (rc.repoDigests || []).map((rd) => {
    if (rd.includes("@sha256:")) {
      return "sha256:" + rd.split("@sha256:")[1];
    }
    return rd;
  });
  // Derive currentDigest from the first cleaned entry if not provided explicitly.
  const derivedDigest = cleanRepoDigests.length > 0 ? cleanRepoDigests[0] : null;

  return {
    id: rc.id,
    name: rc.name,
    image: rc.image,
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

    // Network mode flags — providesNetwork is computed post-normalization (requires scanning all containers)
    networkMode: rc.networkMode || "",
    usesNetworkMode: !!(
      rc.networkMode &&
      (rc.networkMode.startsWith("service:") || rc.networkMode.startsWith("container:"))
    ),
    providesNetwork: false, // filled in by appendRunnerContainers after all containers are collected

    // RepoDigests in clean sha256-only format (image prefix stripped above)
    repoDigests: cleanRepoDigests,
    currentDigest: rc.currentDigest || derivedDigest,

    // Image creation date (unix timestamp from dockhand, or null)
    currentImageCreated: rc.imageCreated || null,

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

    // No source instance fields (legacy source columns remain null)
    sourceName: null,
    sourceUrl: null,
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
async function getContainersFromRunners(runners, { bypassCache = false } = {}) {
  // Do NOT filter on docker_enabled — always attempt all enabled runners.
  // Individual fetch failures are caught gracefully below (lines 174-179).
  // docker_enabled is still tracked for UI display but must not gate fetching,
  // because a stale docker_enabled=0 value permanently hides containers.
  const eligible = runners.filter((r) => r.enabled);
  if (eligible.length === 0) return [];

  // Build a stable cache key from sorted runner IDs
  const cacheKey = eligible
    .map((r) => r.id)
    .sort()
    .join(",");

  // Check cache unless caller explicitly wants fresh data
  if (!bypassCache) {
    const cached = _runnerContainerCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RUNNER_CACHE_TTL_MS) {
      logger.debug("Using cached runner containers", {
        module: "runnerService",
        runnerCount: eligible.length,
        containerCount: cached.data.length,
        ageMs: Date.now() - cached.timestamp,
      });
      return cached.data;
    }
  }

  const results = [];

  await Promise.all(
    eligible.map(async (runner) => {
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

        // Log fetch error as an event (fire-and-forget)
        insertRunnerEvent({
          runnerId: runner.id,
          eventType: EVENT_TYPES.FETCH_ERROR,
          message: `Failed to fetch containers: ${err.message}`,
          details: { error: err.message, code: err.code },
        }).catch(() => {});
      }
    })
  );

  // Store in cache
  _runnerContainerCache.set(cacheKey, { data: results, timestamp: Date.now() });

  return results;
}

/**
 * Invalidate the runner container cache (e.g. after an upgrade or config change).
 */
function invalidateRunnerContainerCache() {
  _runnerContainerCache.clear();
  logger.debug("Invalidated runner container cache", { module: "runnerService" });
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
      if (app.versionSource?.type === "command") {
        return app;
      }
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

module.exports = {
  pingRunner,
  fetchRunnerContainers,
  normalizeRunnerContainer,
  getContainersFromRunners,
  invalidateRunnerContainerCache,
  fetchRunnerApps,
  enrichAppsWithVersions,
};
