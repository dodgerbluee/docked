/**
 * useOperationTasks
 *
 * Client-side manager for dockhand operation runs on the Apps page. Owns N
 * concurrent SSE streams so an operation keeps running even after its output
 * modal is closed. Each task buffers its (ANSI-stripped) output and a terminal
 * status; finished tasks stay until dismissed.
 *
 * A run's own `done` event (with an exit code) is the only authoritative
 * terminal signal. If the stream instead ends without one — because docked
 * itself restarted (e.g. an update upgraded the Docker daemon hosting docked),
 * or the connection otherwise dropped — the task is NOT marked failed. It moves
 * to a `reconnecting` state and is reconciled from the runner's persisted
 * history: we poll the operation's live `active` flag and `lastRun` until the
 * run has finished on the runner, then finalize from that real exit code.
 * Persistent operations (dockhand `persistent: true`) keep running across the
 * disconnect, so this recovers their true result instead of a false failure.
 *
 * Reconciliation only accepts a `lastRun` that belongs to the attempt: dockhand
 * ids every run, and the id recorded before we started is remembered so an
 * older run's success can never stand in for a run that never happened. When
 * no matching result appears within the reconcile window the task ends as an
 * explicit error rather than an assumed outcome.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { STATUS, processRawLog } from "../utils/operationLog";

// Cap buffered output per task so a chatty operation can't grow memory unbounded.
const MAX_LINES = 2000;
// How often a reconnecting task polls the runner for its live state.
const RECONCILE_INTERVAL_MS = 4000;
// How long a reconnecting task waits for a result it can attribute to its own
// attempt before giving up. Only applies once the operation is inactive on the
// runner with no matching result, so a long-running op is never cut short.
const RECONCILE_DEADLINE_MS = 120000;
// Tolerance for clock differences between the browser and the runner host.
const CLOCK_SKEW_MS = 120000;

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function runKey(runnerId, appName, opName) {
  return `${runnerId}:${appName ?? ""}:${opName}`;
}

// A task is "active" (occupying its operation, not dismissable) while running or
// reconnecting — in both cases the operation is still going on the runner.
function isActiveStatus(status) {
  return status === STATUS.RUNNING || status === STATUS.RECONNECTING;
}

// Decide whether the runner's persisted `lastRun` belongs to this attempt, and
// return its exit code if so (null = no usable result yet).
//
// Without this, a run whose POST never reached the runner is "reconciled"
// against whatever the operation did last - possibly a successful run from days
// ago - and reported as Completed (exit 0). dockhand gives every run a
// monotonically increasing id, so a lastRun still carrying the id recorded
// before we started is an older run, not our result.
// (Exported for tests; the hook is the only caller.)
export function reconcileOutcome(task, lastRun) {
  if (!lastRun) return null;
  if (task.priorRunId != null && lastRun.id != null) {
    return lastRun.id === task.priorRunId ? null : (lastRun.exitCode ?? 1);
  }
  // Older agent without run ids: fall back to the finish time.
  const finished = Date.parse(lastRun.finishedAt);
  const started = Date.parse(task.startedAt);
  if (Number.isFinite(finished) && Number.isFinite(started) && finished + CLOCK_SKEW_MS < started) {
    return null;
  }
  return lastRun.exitCode ?? 1;
}

export function useOperationTasks() {
  const [tasks, setTasks] = useState([]);
  const controllersRef = useRef({}); // taskId -> AbortController
  const tasksRef = useRef([]); // latest tasks, read by the reconcile poller

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const updateTask = useCallback((id, updater) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }, []);

  const startTask = useCallback(
    (runner, app, op) => {
      const id = makeId();
      const appName = app?.name ?? null;
      const task = {
        id,
        runnerId: runner.id,
        runnerName: runner.name,
        appName,
        operationName: op.name,
        operationLabel: op.label || op.name,
        status: STATUS.RUNNING,
        exitCode: null,
        error: "",
        lines: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        // The run this operation had before we started, used to tell our own
        // result apart from an older one if the stream drops.
        priorRunId: op.lastRun?.id ?? null,
        reconnectingAt: null,
      };
      setTasks((prev) => [task, ...prev]);

      const url = appName
        ? `${API_BASE_URL}/api/runners/${runner.id}/apps/${encodeURIComponent(appName)}/operations/${encodeURIComponent(op.name)}/run`
        : `${API_BASE_URL}/api/runners/${runner.id}/operations/${encodeURIComponent(op.name)}/run`;

      const controller = new AbortController();
      controllersRef.current[id] = controller;

      (async () => {
        // Distinguishes a real HTTP error (409 already-running, 404 unknown op,
        // 500) — terminal — from a dropped connection (docked down / network),
        // which we reconcile instead of failing.
        let httpFailed = false;
        let sawDone = false;

        try {
          const resp = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
            },
          });

          if (!resp.ok) {
            const text = await resp.text();
            httpFailed = true;
            throw new Error(`Server error ${resp.status}: ${text}`);
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const eventLine = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
              const dataLine = part.match(/^data:\s*(.+)$/ms)?.[1]?.trim();
              if (!dataLine) continue;

              if (eventLine === "log") {
                const { shouldClear, lines: newLines } = processRawLog(dataLine);
                updateTask(id, (t) => {
                  const base = shouldClear ? [] : t.lines;
                  let next = [...base, ...newLines];
                  if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
                  return { ...t, lines: next };
                });
              } else if (eventLine === "done") {
                // Authoritative terminal event.
                sawDone = true;
                // A done event we cannot read is not proof of success. The old
                // fallback to 0 turned a truncated or malformed frame into a
                // green "completed" for an operation that may have failed.
                let exitCode = null;
                try {
                  const parsed = JSON.parse(dataLine);
                  if (Number.isInteger(parsed.exitCode)) exitCode = parsed.exitCode;
                } catch {
                  exitCode = null;
                }
                if (exitCode === null) {
                  updateTask(id, (t) => ({
                    ...t,
                    status: STATUS.ERROR,
                    error: t.error || "The operation ended with an unreadable result",
                    finishedAt: new Date().toISOString(),
                  }));
                  continue;
                }
                updateTask(id, (t) => ({
                  ...t,
                  status: exitCode === 0 ? STATUS.DONE : STATUS.ERROR,
                  exitCode,
                  error: exitCode !== 0 ? t.error || `Exited with code ${exitCode}` : "",
                  finishedAt: new Date().toISOString(),
                }));
              } else if (eventLine === "error") {
                // dockhand always follows a genuine error with done(1); a lone
                // error event means the connection dropped mid-error. Record the
                // message but don't treat it as terminal — reconcile instead.
                let msg = dataLine;
                try {
                  msg = JSON.parse(dataLine).message || dataLine;
                } catch {
                  msg = dataLine;
                }
                updateTask(id, (t) => ({ ...t, error: msg }));
              }
              // "start" event — operation name echoed back, ignore
            }
          }

          // Stream ended without a `done` event: the connection dropped (e.g.
          // docked restarted). Don't fail the task — reconcile from the runner.
          if (!sawDone) {
            updateTask(id, (t) =>
              t.status === STATUS.RUNNING
                ? {
                    ...t,
                    status: STATUS.RECONNECTING,
                    reconnectingAt: new Date().toISOString(),
                    lines: [
                      ...t.lines,
                      "[connection lost — waiting for the run to finish on the runner…]",
                    ],
                  }
                : t
            );
          }
        } catch (err) {
          if (err.name === "AbortError") return;
          if (sawDone) return;
          if (httpFailed) {
            // A real HTTP response error (already-running, unknown op, server
            // error) is terminal.
            updateTask(id, (t) => ({
              ...t,
              status: STATUS.ERROR,
              error: err.message || "Request failed",
              finishedAt: new Date().toISOString(),
            }));
          } else {
            // Connection dropped before/while streaming — reconcile.
            updateTask(id, (t) =>
              t.status === STATUS.RUNNING
                ? {
                    ...t,
                    status: STATUS.RECONNECTING,
                    reconnectingAt: new Date().toISOString(),
                    lines: [
                      ...t.lines,
                      "[connection lost — waiting for the run to finish on the runner…]",
                    ],
                  }
                : t
            );
          }
        } finally {
          delete controllersRef.current[id];
        }
      })();

      return id;
    },
    [updateTask]
  );

  // Reconcile reconnecting tasks: poll the runner for each operation's live
  // state and finalize once the run has ended there. While the operation is
  // still `active` on the runner we keep waiting (a persistent op survives the
  // disconnect); once it's inactive we read its persisted `lastRun.exitCode`.
  const reconnectingSig = useMemo(
    () =>
      tasks
        .filter((t) => t.status === STATUS.RECONNECTING)
        .map((t) => t.id)
        .sort()
        .join("|"),
    [tasks]
  );

  useEffect(() => {
    if (!reconnectingSig) return undefined;
    let cancelled = false;

    const poll = async () => {
      const reconnecting = tasksRef.current.filter((t) => t.status === STATUS.RECONNECTING);
      for (const t of reconnecting) {
        try {
          const url = t.appName
            ? `${API_BASE_URL}/api/runners/${t.runnerId}/apps`
            : `${API_BASE_URL}/api/runners/${t.runnerId}/operations`;
          const { data } = await axios.get(url);
          if (cancelled) return;

          let op;
          if (t.appName) {
            const app = (data.apps || []).find((a) => a.name === t.appName);
            op = app?.operations?.find((o) => o.name === t.operationName);
          } else {
            op = (data.operations || []).find((o) => o.name === t.operationName);
          }
          // App/op not visible yet (docked still settling) or still running on
          // the runner — keep polling.
          if (!op || op.active) continue;

          const exitCode = reconcileOutcome(t, op.lastRun);
          if (exitCode === null) {
            // The operation is idle on the runner but nothing persisted there
            // belongs to this attempt: the run either never started or its
            // result never landed. Give the runner a bounded window to report,
            // then say so — an older run's exit code is not this run's result.
            const since = Date.parse(t.reconnectingAt);
            if (Number.isFinite(since) && Date.now() - since < RECONCILE_DEADLINE_MS) continue;
            updateTask(t.id, (cur) =>
              cur.status === STATUS.RECONNECTING
                ? {
                    ...cur,
                    status: STATUS.ERROR,
                    error:
                      cur.error ||
                      "The connection was lost and the runner never reported a result for this run.",
                    finishedAt: new Date().toISOString(),
                  }
                : cur
            );
            continue;
          }

          updateTask(t.id, (cur) =>
            cur.status === STATUS.RECONNECTING
              ? {
                  ...cur,
                  status: exitCode === 0 ? STATUS.DONE : STATUS.ERROR,
                  exitCode,
                  error: exitCode !== 0 ? cur.error || `Exited with code ${exitCode}` : "",
                  finishedAt: new Date().toISOString(),
                }
              : cur
          );
        } catch {
          // docked still down / network error — keep polling on the next tick.
        }
      }
    };

    poll();
    const timer = setInterval(poll, RECONCILE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reconnectingSig, updateTask]);

  // Stable Set of "runnerId:appName:opName" keys for currently-active tasks.
  // Recomputed only when the active set actually changes, so memoized AppCards
  // don't re-render on every streamed log line.
  const runningSig = useMemo(
    () =>
      tasks
        .filter((t) => isActiveStatus(t.status))
        .map((t) => runKey(t.runnerId, t.appName, t.operationName))
        .sort()
        .join("|"),
    [tasks]
  );
  const runningKeys = useMemo(() => new Set(runningSig ? runningSig.split("|") : []), [runningSig]);

  const isRunning = useCallback(
    (runnerId, appName, opName) => runningKeys.has(runKey(runnerId, appName, opName)),
    [runningKeys]
  );

  // Dismiss finished tasks only; running/reconnecting tasks can't be dismissed
  // (the operation is still going on the runner).
  const dismissTask = useCallback((id) => {
    setTasks((prev) =>
      prev.filter((t) => !(t.id === id && (t.status === STATUS.DONE || t.status === STATUS.ERROR)))
    );
  }, []);

  const dismissAll = useCallback(() => {
    setTasks((prev) => prev.filter((t) => isActiveStatus(t.status)));
  }, []);

  // Abort all in-flight streams when the owning page unmounts.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      Object.values(controllers).forEach((c) => c.abort());
    };
  }, []);

  return { tasks, startTask, isRunning, runningKeys, dismissTask, dismissAll };
}
