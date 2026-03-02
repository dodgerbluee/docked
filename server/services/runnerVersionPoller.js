/**
 * Runner Version Poller
 *
 * Background job that periodically:
 *  1. Fetches the latest dockhand release from GitHub (one request, shared
 *     across all runners).
 *  2. Pings each enabled runner to get its running binary version.
 *  3. Persists both values via updateRunnerVersion so the UI shows the
 *     update badge without requiring a manual health-check.
 *
 * Runs once at startup then every POLL_INTERVAL_MS thereafter.
 */

const logger = require("../utils/logger");
const { getAllRunnersWithKeys, updateRunnerVersion } = require("../db/runners");
const { pingRunner } = require("./runnerService");
const githubService = require("./githubService");

const DOCKHAND_GITHUB_REPO = "dockedapp/dockhand";
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function pollRunnerVersions() {
  let runners;
  try {
    runners = await getAllRunnersWithKeys();
  } catch (err) {
    logger.warn("runnerVersionPoller: could not load runners", { error: err.message });
    return;
  }

  if (runners.length === 0) return;

  // Fetch latest GitHub release once for all runners
  let latestVersion = null;
  let latestVersionFetched = false;
  try {
    const release = await githubService.getLatestRelease(DOCKHAND_GITHUB_REPO);
    latestVersion = release?.tag_name ?? null;
    latestVersionFetched = true;
  } catch (err) {
    logger.warn("runnerVersionPoller: failed to fetch latest release", { error: err.message });
  }

  // Ping each runner in parallel, update DB with whatever we learn
  await Promise.allSettled(
    runners.map(async (runner) => {
      let runningVersion = runner.version ?? null;
      let dockerEnabled = null; // null = offline / unknown, keep existing DB value
      try {
        const health = await pingRunner(runner.url, runner.api_key);
        runningVersion = health.version ?? runningVersion;
        // health.dockerOk is present on dockhand >= the Docker management release.
        // Older runners won't have it; treat undefined the same as true (they had
        // Docker routes always registered before the docker.enabled config existed).
        dockerEnabled = health.dockerOk !== false;
      } catch {
        // Runner offline — keep existing values in DB, still update latest
      }
      try {
        await updateRunnerVersion(
          runner.id,
          runner.user_id,
          runningVersion,
          latestVersionFetched ? latestVersion : runner.latest_version,
          dockerEnabled
        );
      } catch (err) {
        logger.warn(`runnerVersionPoller: DB update failed for runner ${runner.id}`, {
          error: err.message,
        });
      }
    })
  );

  logger.debug("runnerVersionPoller: version check complete", {
    runners: runners.length,
    latestVersion,
  });
}

function startVersionPoller() {
  // Run immediately on startup, then on a fixed interval
  pollRunnerVersions().catch((err) =>
    logger.warn("runnerVersionPoller: startup check failed", { error: err.message })
  );

  setInterval(() => {
    pollRunnerVersions().catch((err) =>
      logger.warn("runnerVersionPoller: periodic check failed", { error: err.message })
    );
  }, POLL_INTERVAL_MS);
}

module.exports = { startVersionPoller };
