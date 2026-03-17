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
const {
  EVENT_TYPES,
  insertRunnerEvent,
  updateRunnerLastSeen,
  updateRunnerDockerStatus,
  pruneRunnerEvents,
} = require("../db/runnerEvents");
const { pingRunner } = require("./runnerService");
const githubService = require("./githubService");

const DOCKHAND_GITHUB_REPO = "dockedapp/dockhand";
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Track consecutive failures per runner to implement backoff.
// After MAX_CONSECUTIVE_FAILURES, only try every BACKOFF_MULTIPLIER polls.
const _failureCounts = new Map(); // runnerId -> consecutive failure count
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_MULTIPLIER = 3; // After 3 failures, only ping every 3rd poll (= 3 hours)
let _pollCount = 0;

async function pollRunnerVersions() {
  _pollCount++;
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
      // Backoff: if a runner has failed MAX_CONSECUTIVE_FAILURES times,
      // only attempt it every BACKOFF_MULTIPLIER polls
      const failures = _failureCounts.get(runner.id) || 0;
      if (failures >= MAX_CONSECUTIVE_FAILURES && _pollCount % BACKOFF_MULTIPLIER !== 0) {
        logger.debug(
          `runnerVersionPoller: skipping runner "${runner.name}" (${failures} consecutive failures, backoff)`,
          { module: "runnerVersionPoller", runnerId: runner.id }
        );
        // Still update latest version from GitHub even if we skip the ping
        try {
          await updateRunnerVersion(
            runner.id,
            runner.user_id,
            runner.version,
            latestVersionFetched ? latestVersion : runner.latest_version,
            null // keep existing docker_enabled
          );
        } catch {
          // ignore
        }
        return;
      }

      let runningVersion = runner.version ?? null;
      let dockerEnabled = null; // null = offline / unknown, keep existing DB value
      try {
        const health = await pingRunner(runner.url, runner.api_key);
        runningVersion = health.version ?? runningVersion;
        // health.dockerOk is present on dockhand >= the Docker management release.
        // Older runners won't have it; treat undefined the same as true (they had
        // Docker routes always registered before the docker.enabled config existed).
        dockerEnabled = health.dockerOk !== false;

        // Update last_seen on successful contact
        await updateRunnerLastSeen(runner.id);

        // Update Docker status and log if changed
        const dockerStatus = health.dockerOk === false ? "unavailable" : "ok";
        const dockerChanged = await updateRunnerDockerStatus(runner.id, dockerStatus);
        if (dockerChanged) {
          insertRunnerEvent({
            runnerId: runner.id,
            eventType: EVENT_TYPES.DOCKER_CHANGE,
            message: `Docker status changed to "${dockerStatus}" (via poller)`,
            details: { from: runner.docker_status || "unknown", to: dockerStatus },
          }).catch(() => {});
        }

        // Log version change
        if (runningVersion && runner.version && runningVersion !== runner.version) {
          insertRunnerEvent({
            runnerId: runner.id,
            eventType: EVENT_TYPES.VERSION_CHANGE,
            message: `Version changed: ${runner.version} → ${runningVersion}`,
            details: { from: runner.version, to: runningVersion },
          }).catch(() => {});
        }

        // Success — reset failure count
        _failureCounts.set(runner.id, 0);
      } catch {
        // Runner offline — increment failure count
        _failureCounts.set(runner.id, failures + 1);
        logger.debug(
          `runnerVersionPoller: runner "${runner.name}" unreachable (${failures + 1} consecutive failures)`,
          { module: "runnerVersionPoller", runnerId: runner.id }
        );

        // Log health check error on first failure or when entering backoff
        if (failures === 0 || failures + 1 === MAX_CONSECUTIVE_FAILURES) {
          insertRunnerEvent({
            runnerId: runner.id,
            eventType: EVENT_TYPES.HEALTH_CHECK_ERROR,
            message: failures + 1 === MAX_CONSECUTIVE_FAILURES
              ? `Runner unreachable — entering backoff after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
              : `Runner unreachable (poller)`,
            details: { consecutiveFailures: failures + 1 },
          }).catch(() => {});
        }
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

  // Periodically prune old events (every 6th poll = ~6 hours)
  if (_pollCount % 6 === 0) {
    pruneRunnerEvents(200).catch((err) =>
      logger.warn("runnerVersionPoller: event pruning failed", { error: err.message })
    );
  }
}

/**
 * Reset the failure count for a specific runner, allowing the poller to
 * immediately try it on the next cycle. Called when a heartbeat updates
 * a runner's URL (the old URL may have been causing ping failures).
 * @param {number} runnerId
 */
function resetRunnerBackoff(runnerId) {
  _failureCounts.delete(runnerId);
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

module.exports = { startVersionPoller, resetRunnerBackoff };
