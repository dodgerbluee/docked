/**
 * Runner Events Database Module
 *
 * Append-only event log for runner state changes, Docker status transitions,
 * heartbeat events, errors, and other diagnostics. Events are never modified
 * after creation — old events are periodically pruned.
 *
 * Event types:
 *   - status_change      : Runner went online/offline
 *   - docker_change      : Docker status changed (ok/unavailable/unknown)
 *   - heartbeat          : Heartbeat received (only logged on notable changes)
 *   - heartbeat_error    : Heartbeat contained an error or unexpected state
 *   - health_check       : Manual or poller health check result
 *   - health_check_error : Health check failed (runner unreachable)
 *   - fetch_error        : Failed to fetch containers from runner
 *   - url_change         : Runner URL changed (IP migration)
 *   - version_change     : Runner binary version changed
 *   - enrolled           : Runner first enrolled
 *   - re_enrolled        : Runner re-enrolled (API key refresh)
 *   - updated            : Runner binary was updated
 *   - info               : Generic informational event
 */

const { getDatabase } = require("./connection");

/**
 * Event type constants
 */
const EVENT_TYPES = {
  STATUS_CHANGE: "status_change",
  DOCKER_CHANGE: "docker_change",
  HEARTBEAT: "heartbeat",
  HEARTBEAT_ERROR: "heartbeat_error",
  HEALTH_CHECK: "health_check",
  HEALTH_CHECK_ERROR: "health_check_error",
  FETCH_ERROR: "fetch_error",
  URL_CHANGE: "url_change",
  VERSION_CHANGE: "version_change",
  ENROLLED: "enrolled",
  RE_ENROLLED: "re_enrolled",
  UPDATED: "updated",
  INFO: "info",
};

/**
 * Insert a runner event.
 * @param {Object} params
 * @param {number} params.runnerId - Runner ID
 * @param {string} params.eventType - One of EVENT_TYPES
 * @param {string} [params.message] - Human-readable summary
 * @param {Object|string} [params.details] - Extra data (JSON-serialized if object)
 * @returns {Promise<number>} Event ID
 */
function insertRunnerEvent({ runnerId, eventType, message = null, details = null }) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      const detailsStr =
        details !== null && typeof details === "object" ? JSON.stringify(details) : details;
      db.run(
        "INSERT INTO runner_events (runner_id, event_type, message, details) VALUES (?, ?, ?, ?)",
        [runnerId, eventType, message, detailsStr],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get events for a runner, newest first.
 * @param {number} runnerId
 * @param {Object} [options]
 * @param {number} [options.limit=50] - Max events to return
 * @param {number} [options.offset=0] - Pagination offset
 * @param {string} [options.eventType] - Filter by event type
 * @returns {Promise<Array>}
 */
function getRunnerEvents(runnerId, { limit = 50, offset = 0, eventType = null } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      let sql = "SELECT * FROM runner_events WHERE runner_id = ?";
      const params = [runnerId];

      if (eventType) {
        sql += " AND event_type = ?";
        params.push(eventType);
      }

      sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else {
          // Parse details JSON where possible
          const parsed = (rows || []).map((row) => {
            if (row.details) {
              try {
                row.details = JSON.parse(row.details);
              } catch {
                // keep as string
              }
            }
            return row;
          });
          resolve(parsed);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the count of events for a runner (for pagination).
 * @param {number} runnerId
 * @param {string} [eventType]
 * @returns {Promise<number>}
 */
function getRunnerEventCount(runnerId, eventType = null) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      let sql = "SELECT COUNT(*) as count FROM runner_events WHERE runner_id = ?";
      const params = [runnerId];
      if (eventType) {
        sql += " AND event_type = ?";
        params.push(eventType);
      }
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Prune old events, keeping the most recent N events per runner.
 * @param {number} [keepPerRunner=200] - Number of events to keep per runner
 * @returns {Promise<number>} Number of deleted events
 */
function pruneRunnerEvents(keepPerRunner = 200) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        `DELETE FROM runner_events WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY runner_id ORDER BY created_at DESC) as rn
            FROM runner_events
          ) WHERE rn <= ?
        )`,
        [keepPerRunner],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update runner's last_seen timestamp.
 * @param {number} runnerId
 * @returns {Promise<void>}
 */
function updateRunnerLastSeen(runnerId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        "UPDATE runners SET last_seen = datetime('now') WHERE id = ?",
        [runnerId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update runner's Docker status (and docker_status_since if changed).
 * @param {number} runnerId
 * @param {string} status - 'ok', 'unavailable', or 'unknown'
 * @returns {Promise<boolean>} true if the status actually changed
 */
function updateRunnerDockerStatus(runnerId, status) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      // First check current status to detect a change
      db.get(
        "SELECT docker_status FROM runners WHERE id = ?",
        [runnerId],
        (err, row) => {
          if (err) return reject(err);
          const oldStatus = row?.docker_status || "unknown";
          const changed = oldStatus !== status;

          if (changed) {
            db.run(
              "UPDATE runners SET docker_status = ?, docker_status_since = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              [status, runnerId],
              (err2) => {
                if (err2) reject(err2);
                else resolve(true);
              }
            );
          } else {
            resolve(false);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  EVENT_TYPES,
  insertRunnerEvent,
  getRunnerEvents,
  getRunnerEventCount,
  pruneRunnerEvents,
  updateRunnerLastSeen,
  updateRunnerDockerStatus,
};
