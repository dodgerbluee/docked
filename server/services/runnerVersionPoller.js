/**
 * Runner Version Poller
 *
 * Two independent background loops:
 *  1. GitHub release check — runs every GITHUB_POLL_INTERVAL_MS (5 min).
 *     Fetches the latest dockhand release tag once and writes it to every
 *     runner row so the UI shows the update badge as soon as a release drops.
 *  2. Runner ping loop — runs every RUNNER_POLL_INTERVAL_MS (1 hour).
 *     Pings each runner to get its live binary version and online status.
 */

const logger = require("../utils/logger");
const {
  getAllRunnersWithKeys,
  updateRunnerVersion,
  updateRunnerOnlineStatus,
} = require("../db/runners");
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
const GITHUB_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RUNNER_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Track consecutive failures per runner to implement backoff.
// After MAX_CONSECUTIVE_FAILURES, only try every BACKOFF_MULTIPLIER polls.
const _failureCounts = new Map(); // runnerId -> consecutive failure count
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_MULTIPLIER = 3; // After 3 failures, only ping every 3rd poll (= 3 hours)
let _pollCount = 0;

// Fetch latest GitHub release and write it to all runner rows.
async function pollGithubRelease() {
  let runners;
  try {
    runners = await getAllRunnersWithKeys();
  } catch (err) {
    logger.warn("runnerVersionPoller: could not load runners", { error: err.message });
    return;
  }
  if (runners.length === 0) return;

  let latestVersion;
  try {
    const release = await githubService.getLatestRelease(DOCKHAND_GITHUB_REPO);
    latestVersion = release?.tag_name ?? null;
  } catch (err) {
    logger.warn("runnerVersionPoller: failed to fetch latest release", { error: err.message });
    return;
  }

  if (!latestVersion) return;

  await Promise.allSettled(
    runners.map((runner) =>
      updateRunnerVersion(runner.id, runner.user_id, runner.version, latestVersion, null).catch(
        () => {}
      )
    )
  );

  logger.debug("runnerVersionPoller: github release check complete", { latestVersion });
}

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

  // latest_version in the DB is kept fresh by the pollGithubRelease loop

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

        // Transition to online if previously offline
        if (runner.online_status === "offline") {
          const changed = await updateRunnerOnlineStatus(runner.id, "online");
          if (changed) {
            insertRunnerEvent({
              runnerId: runner.id,
              eventType: EVENT_TYPES.STATUS_CHANGE,
              message: "Runner is back online (via poller)",
              details: {},
            }).catch(() => {});

            const { sendRunnerStatusNotification } = require("./discordService");
            sendRunnerStatusNotification({
              userId: runner.user_id,
              runnerName: runner.name,
              status: "online",
            }).catch(() => {});
          }
        }

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
            message:
              failures + 1 === MAX_CONSECUTIVE_FAILURES
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
          runner.latest_version,
          dockerEnabled
        );
      } catch (err) {
        logger.warn(`runnerVersionPoller: DB update failed for runner ${runner.id}`, {
          error: err.message,
        });
      }
    })
  );

  logger.debug("runnerVersionPoller: runner ping complete", { runners: runners.length });

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
  // GitHub release check: run immediately, then every 5 minutes
  pollGithubRelease().catch((err) =>
    logger.warn("runnerVersionPoller: startup github check failed", { error: err.message })
  );
  setInterval(() => {
    pollGithubRelease().catch((err) =>
      logger.warn("runnerVersionPoller: github check failed", { error: err.message })
    );
  }, GITHUB_POLL_INTERVAL_MS);

  // Runner ping loop: run immediately, then every hour
  pollRunnerVersions().catch((err) =>
    logger.warn("runnerVersionPoller: startup runner ping failed", { error: err.message })
  );
  setInterval(() => {
    pollRunnerVersions().catch((err) =>
      logger.warn("runnerVersionPoller: runner ping failed", { error: err.message })
    );
  }, RUNNER_POLL_INTERVAL_MS);
}

module.exports = { startVersionPoller, resetRunnerBackoff };
