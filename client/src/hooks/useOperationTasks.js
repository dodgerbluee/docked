/**
 * useOperationTasks
 *
 * Client-side manager for dockhand operation runs on the Apps page. Owns N
 * concurrent SSE streams so an operation keeps running even after its output
 * modal is closed. Each task buffers its (ANSI-stripped) output and a terminal
 * status; finished tasks stay until dismissed.
 *
 * The operation's lifetime is tied to the SSE request (dockhand runs the command
 * via exec.CommandContext on the request context), so the stream is kept alive
 * here — independent of any modal — until it completes or the page unmounts.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { API_BASE_URL } from "../constants/api";
import { STATUS, processRawLog } from "../utils/operationLog";

// Cap buffered output per task so a chatty operation can't grow memory unbounded.
const MAX_LINES = 2000;

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function runKey(runnerId, appName, opName) {
  return `${runnerId}:${appName ?? ""}:${opName}`;
}

export function useOperationTasks() {
  const [tasks, setTasks] = useState([]);
  const controllersRef = useRef({}); // taskId -> AbortController

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
      };
      setTasks((prev) => [task, ...prev]);

      const url = appName
        ? `${API_BASE_URL}/api/runners/${runner.id}/apps/${encodeURIComponent(appName)}/operations/${encodeURIComponent(op.name)}/run`
        : `${API_BASE_URL}/api/runners/${runner.id}/operations/${encodeURIComponent(op.name)}/run`;

      const controller = new AbortController();
      controllersRef.current[id] = controller;

      (async () => {
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
            throw new Error(`Server error ${resp.status}: ${text}`);
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let sawTerminal = false;

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
                sawTerminal = true;
                let exitCode = 0;
                try {
                  exitCode = JSON.parse(dataLine).exitCode ?? 0;
                } catch {
                  exitCode = 0;
                }
                updateTask(id, (t) => ({
                  ...t,
                  status: exitCode === 0 ? STATUS.DONE : STATUS.ERROR,
                  exitCode,
                  error: exitCode !== 0 ? `Exited with code ${exitCode}` : "",
                  finishedAt: new Date().toISOString(),
                }));
              } else if (eventLine === "error") {
                sawTerminal = true;
                let msg = dataLine;
                try {
                  msg = JSON.parse(dataLine).message || dataLine;
                } catch {
                  msg = dataLine;
                }
                updateTask(id, (t) => ({
                  ...t,
                  status: STATUS.ERROR,
                  error: msg,
                  finishedAt: new Date().toISOString(),
                }));
              }
              // "start" event — operation name echoed back, ignore
            }
          }

          // Stream ended without an explicit terminal event.
          if (!sawTerminal) {
            updateTask(id, (t) =>
              t.status === STATUS.RUNNING
                ? { ...t, status: STATUS.DONE, finishedAt: new Date().toISOString() }
                : t
            );
          }
        } catch (err) {
          if (err.name === "AbortError") return;
          updateTask(id, (t) => ({
            ...t,
            status: STATUS.ERROR,
            error: err.message || "Connection failed",
            finishedAt: new Date().toISOString(),
          }));
        } finally {
          delete controllersRef.current[id];
        }
      })();

      return id;
    },
    [updateTask]
  );

  // Stable Set of "runnerId:appName:opName" keys for currently-running tasks.
  // Recomputed only when the running set actually changes, so memoized AppCards
  // don't re-render on every streamed log line.
  const runningSig = useMemo(
    () =>
      tasks
        .filter((t) => t.status === STATUS.RUNNING)
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

  // Dismiss finished tasks only; running tasks can't be dismissed (no cancel).
  const dismissTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => !(t.id === id && t.status !== STATUS.RUNNING)));
  }, []);

  const dismissAll = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === STATUS.RUNNING));
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
