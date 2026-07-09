/**
 * Runner Health Service
 *
 * Periodically checks whether runners have gone stale (no heartbeat
 * for longer than the threshold) and transitions their online_status.
 *
 * State transitions:
 *   online  → offline : when last_seen > OFFLINE_THRESHOLD_MS ago
 *   offline → online  : handled by the heartbeat handler (runnerController)
 *
 * On each transition a Discord notification is sent (once per direction)
 * and a runner_event is logged.
 */

const logger = require("../utils/logger");
const { getAllRunnersWithKeys, updateRunnerOnlineStatus } = require("../db/runners");
const { EVENT_TYPES, insertRunnerEvent } = require("../db/runnerEvents");
const { sendRunnerStatusNotification } = require("./discordService");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes (3 missed heartbeats)

async function checkRunnerHealth() {
  let runners;
  try {
    runners = await getAllRunnersWithKeys();
  } catch (err) {
    logger.warn("runnerHealthService: could not load runners", { error: err.message });
    return;
  }

  if (runners.length === 0) return;

  const now = Date.now();

  for (const runner of runners) {
    try {
      if (!runner.last_seen) continue;

      const lastSeenMs = new Date(runner.last_seen).getTime();
      const staleDuration = now - lastSeenMs;
      const isStale = staleDuration > OFFLINE_THRESHOLD_MS;
      const currentStatus = runner.online_status || "online";

      if (isStale && currentStatus !== "offline") {
        const changed = await updateRunnerOnlineStatus(runner.id, "offline");
        if (changed) {
          logger.warn(
            `Runner "${runner.name}" marked offline (last seen ${Math.round(staleDuration / 60000)} min ago)`,
            { module: "runnerHealthService", runnerId: runner.id }
          );

          insertRunnerEvent({
            runnerId: runner.id,
            eventType: EVENT_TYPES.STATUS_CHANGE,
            message: `Runner went offline (no heartbeat for ${Math.round(staleDuration / 60000)} minutes)`,
            details: { lastSeen: runner.last_seen, thresholdMinutes: OFFLINE_THRESHOLD_MS / 60000 },
          }).catch(() => {});

          sendRunnerStatusNotification({
            userId: runner.user_id,
            runnerName: runner.name,
            status: "offline",
            lastSeen: runner.last_seen,
          }).catch((err) => {
            logger.warn(`Failed to send offline notification for runner "${runner.name}":`, {
              error: err.message,
            });
          });
        }
      }
    } catch (err) {
      logger.warn(`runnerHealthService: error checking runner ${runner.id}:`, {
        error: err.message,
      });
    }
  }
}

function startHealthChecker() {
  checkRunnerHealth().catch((err) =>
    logger.warn("runnerHealthService: startup check failed", { error: err.message })
  );

  setInterval(() => {
    checkRunnerHealth().catch((err) =>
      logger.warn("runnerHealthService: periodic check failed", { error: err.message })
    );
  }, CHECK_INTERVAL_MS);
}

module.exports = { startHealthChecker, checkRunnerHealth };
