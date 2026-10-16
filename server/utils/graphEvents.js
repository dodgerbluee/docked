// Bridge for publishing GraphQL subscription events from the Node process
// into the Go backend's subscription hub. Fire-and-forget: events are
// best-effort (clients also refetch on load), so failures are logged at
// debug level and never surface to request handlers.
const http = require("http");

const GRAPHQL_BACKEND = process.env.GRAPHQL_BACKEND || "http://127.0.0.1:4000";
const JWT_SECRET = process.env.JWT_SECRET || "";

// Event types mirror the Go /internal/events handler switch.
const EVENT_TYPES = new Set([
  "containersUpdated",
  "upgradeProgress",
  "batchJobProgress",
  "intentExecutionProgress",
  "runnerStatusChanged",
  "operationProgress",
]);

function publishGraphEvent(type, userId, payload) {
  if (!EVENT_TYPES.has(type)) return;
  const target = new URL(GRAPHQL_BACKEND);
  const body = JSON.stringify({ type, userId, payload });

  const req = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      path: "/internal/events",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Internal-Token": JWT_SECRET,
      },
      timeout: 3000,
    },
    (res) => {
      res.resume(); // drain to release the socket
      if (res.statusCode >= 400) {
        const { logger } = require("./logger");
        logger.debug("Graph event bridge rejected", {
          module: "graphEvents",
          type,
          status: res.statusCode,
        });
      }
    }
  );
  req.on("error", (err) => {
    const { logger } = require("./logger");
    logger.debug("Graph event bridge error", { module: "graphEvents", type, error: err.message });
  });
  req.on("timeout", () => req.destroy());
  req.end(body);
}

// Map a batch_runs DB row (snake_case) to the graph BatchRun JSON shape.
// Times are stored as SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS");
// the Go bridge unmarshals into time.Time, so normalize to RFC3339.
// Enum values are upper-snake in GraphQL but lowercase-hyphen in the DB.
function toRFC3339(value) {
  if (!value) return null;
  const s = String(value);
  if (s.includes("T")) return s.endsWith("Z") || s.includes("+") ? s : `${s}Z`;
  return `${s.replace(" ", "T")}Z`;
}

function enumConst(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[- ]/g, "_");
}

function batchRunPayload(row) {
  return {
    id: String(row.id),
    status: enumConst(row.status),
    jobType: enumConst(row.job_type),
    queuedAt: toRFC3339(row.started_at),
    startedAt: toRFC3339(row.started_at),
    completedAt: toRFC3339(row.completed_at),
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    containersChecked: Number(row.containers_checked || 0),
    containersUpdated: Number(row.containers_updated || 0),
    errorMessage: row.error_message || null,
    logs: row.logs || null,
    isManual: Boolean(row.is_manual),
  };
}

// Map an intent_executions DB row to the graph IntentExecution JSON shape.
// `containers`/`intent` are relation fields resolved lazily by Go, so they
// are omitted here.
function intentExecutionPayload(row) {
  return {
    id: String(row.id),
    intentId: String(row.intent_id),
    status: enumConst(row.status),
    triggerType: enumConst(row.trigger_type),
    containersMatched: Number(row.containers_matched || 0),
    containersUpgraded: Number(row.containers_upgraded || 0),
    containersFailed: Number(row.containers_failed || 0),
    containersSkipped: Number(row.containers_skipped || 0),
    errorMessage: row.error_message || null,
    queuedAt: toRFC3339(row.started_at),
    startedAt: toRFC3339(row.started_at),
    completedAt: toRFC3339(row.completed_at),
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
  };
}

module.exports = {
  publishGraphEvent,
  batchRunPayload,
  intentExecutionPayload,
  BROADCAST_USER: 0,
};
