/**
 * Runner action operations (health / restart / update / uninstall / events / logs).
 *
 * Thin wrappers over the graph that return the same shapes the old REST
 * endpoints returned, so components can stay agnostic of the transport.
 */

import { graphqlClient } from "./client";
import {
  RUNNER_EVENTS_QUERY,
  RUNNER_LOGS_QUERY,
  RUNNER_HEALTH_MUTATION,
  RESTART_RUNNER_MUTATION,
  UPDATE_RUNNER_BINARY_MUTATION,
  UNINSTALL_RUNNER_MUTATION,
} from "./queries";

// Ping a runner. Resolves { online, health } (health is null when offline);
// throws only on transport/auth errors, matching the old REST semantics where
// an unreachable runner still resolved with online: false.
export async function checkRunnerHealth(runnerId) {
  const result = await graphqlClient
    .mutation(RUNNER_HEALTH_MUTATION, { runnerId: String(runnerId) })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const res = result.data.runnerHealthCheck;
  if (!res.online) return { online: false, error: res.error };
  return {
    online: true,
    health: { version: res.version, dockerOk: res.dockerOk, uptimeSeconds: res.uptimeSeconds },
  };
}

// Restart the dockhand service on a runner. Throws with the server message on failure.
export async function restartRunner(runnerId) {
  const result = await graphqlClient
    .mutation(RESTART_RUNNER_MUTATION, { runnerId: String(runnerId) })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const res = result.data.restartRunner;
  if (!res.success) throw new Error(res.message || "Failed to restart runner");
  return res;
}

// Trigger a runner binary self-update (version falls back to the stored latest).
export async function updateRunnerBinary(runnerId, version = null) {
  const result = await graphqlClient
    .mutation(UPDATE_RUNNER_BINARY_MUTATION, { runnerId: String(runnerId), version })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const res = result.data.updateRunnerBinary;
  if (!res.success) throw new Error(res.message || "Failed to update runner");
  return res;
}

// Uninstall a runner (waits server-side until it drops offline, then removes it).
export async function uninstallRunner(runnerId) {
  const result = await graphqlClient
    .mutation(UNINSTALL_RUNNER_MUTATION, { runnerId: String(runnerId) })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const res = result.data.uninstallRunner;
  if (!res.success) throw new Error(res.message || "Failed to uninstall runner");
  return res;
}

// Runner event log, newest first. Returns REST-shaped rows (snake_case,
// details parsed to an object) so the events tab renders unchanged.
export async function fetchRunnerEvents(runnerId, { limit = 50, offset = 0 } = {}) {
  const result = await graphqlClient
    .query(RUNNER_EVENTS_QUERY, { runnerId: String(runnerId), first: limit, offset })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const conn = result.data.runnerEvents;
  const events = (conn.items || []).map((e) => {
    let details = null;
    if (e.details) {
      try {
        details = JSON.parse(e.details);
      } catch {
        details = e.details;
      }
    }
    return {
      id: e.id,
      runner_id: e.runnerId,
      event_type: e.eventType,
      message: e.message,
      details,
      created_at: e.createdAt,
    };
  });
  return { success: true, events, total: conn.total };
}

// Runner service logs. Resolves { success, lines, count, error } — failures
// come back as success: false rather than throwing (REST parity).
export async function fetchRunnerLogs(runnerId, lines = 100) {
  const result = await graphqlClient
    .query(RUNNER_LOGS_QUERY, { runnerId: String(runnerId), lines })
    .toPromise();
  if (result.error) throw new Error(result.error.message);
  const res = result.data.runnerLogs;
  if (res.error) return { success: false, error: res.error, lines: [], count: 0 };
  return { success: true, lines: res.lines || [], count: res.count };
}
