/**
 * Migration 15: Add runner health tracking
 *
 * Adds observability to runner state so the Docked UI can show why
 * a runner stopped reporting containers (or went offline).
 *
 * Changes:
 * 1. New `runner_events` table — append-only event log recording status
 *    changes, Docker state transitions, errors, and heartbeats.
 * 2. New columns on `runners`:
 *    - `last_seen`          — ISO-8601 timestamp of last successful contact
 *    - `docker_status`      — current Docker state: 'ok', 'unavailable', 'unknown'
 *    - `docker_status_since` — ISO-8601 timestamp of when docker_status last changed
 *
 * Version: 15
 * Date: 2026-03-17
 */

const logger = require("../../utils/logger");
const {
  addColumnIfNotExists,
  tableExists,
  createIndexIfNotExists,
  executeSql,
} = require("./helpers");

module.exports = {
  version: 15,
  name: "Add runner health tracking",
  up: async () => {
    logger.info("Migration 15: Adding runner health tracking");

    // 1. Add health columns to runners
    await addColumnIfNotExists("runners", "last_seen", "TEXT"); // ISO-8601
    await addColumnIfNotExists("runners", "docker_status", "TEXT DEFAULT 'unknown'"); // ok | unavailable | unknown
    await addColumnIfNotExists("runners", "docker_status_since", "TEXT"); // ISO-8601

    // 2. Create runner_events table
    const eventsExist = await tableExists("runner_events");
    if (!eventsExist) {
      await executeSql(`
        CREATE TABLE runner_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          runner_id  INTEGER NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
          event_type TEXT    NOT NULL,
          message    TEXT,
          details    TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logger.info("Migration 15: Created runner_events table");
    }

    // 3. Indexes for efficient querying
    await createIndexIfNotExists(
      "idx_runner_events_runner_id",
      "runner_events",
      "runner_id, created_at DESC"
    );
    await createIndexIfNotExists(
      "idx_runner_events_type",
      "runner_events",
      "event_type, created_at DESC"
    );

    // 4. Backfill docker_status from existing docker_enabled values
    // docker_enabled: NULL=unknown, 1=ok, 0=unavailable
    await executeSql(`
      UPDATE runners SET
        docker_status = CASE
          WHEN docker_enabled = 1 THEN 'ok'
          WHEN docker_enabled = 0 THEN 'unavailable'
          ELSE 'unknown'
        END,
        docker_status_since = COALESCE(version_checked_at, updated_at)
      WHERE docker_status IS NULL OR docker_status = 'unknown'
    `);

    logger.info("Migration 15: Runner health tracking ready");
  },
};
