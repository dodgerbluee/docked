/**
 * RunOperationModal
 *
 * Streams live output from a dockhand operation via SSE (POST).
 * Opened from the Operations panel on a runner card in RunnerTab.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, CheckCircle, AlertCircle } from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import { STATUS, processRawLog } from "../../utils/operationLog";
import styles from "./RunOperationModal.module.css";

export default function RunOperationModal({ isOpen, runnerId, appName, operationName, onClose }) {
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [exitCode, setExitCode] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const outputRef = useRef(null);
  const abortRef = useRef(null);
  const startedRef = useRef(false);

  const appendLog = useCallback((raw) => {
    const { shouldClear, lines: newLines } = processRawLog(raw);
    setLines((prev) => [...(shouldClear ? [] : prev), ...newLines]);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Start stream when modal opens
  useEffect(() => {
    if (!isOpen || !runnerId || !operationName || startedRef.current) return;
    startedRef.current = true;

    setStatus(STATUS.RUNNING);
    setLines([]);
    setExitCode(null);
    setErrorMsg("");

    const url = appName
      ? `${API_BASE_URL}/api/runners/${runnerId}/apps/${encodeURIComponent(appName)}/operations/${encodeURIComponent(operationName)}/run`
      : `${API_BASE_URL}/api/runners/${runnerId}/operations/${encodeURIComponent(operationName)}/run`;
    const controller = new AbortController();
    abortRef.current = controller;

    // `status` in this closure is the value from before the stream started
    // (IDLE), so terminal state has to be tracked locally inside the routine.
    // `cancelled` marks the run retired — the modal closed or the runner/op
    // target changed — so late chunks must not touch state.
    let sawTerminalEvent = false;
    let cancelled = false;

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) return;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventLine = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const dataLine = part.match(/^data:\s*(.+)$/ms)?.[1]?.trim();

            if (!dataLine) continue;

            if (eventLine === "log") {
              appendLog(dataLine);
            } else if (eventLine === "done") {
              sawTerminalEvent = true;
              try {
                const payload = JSON.parse(dataLine);
                setExitCode(payload.exitCode ?? 0);
                setStatus(payload.exitCode === 0 ? STATUS.DONE : STATUS.ERROR);
                if (payload.exitCode !== 0) {
                  setErrorMsg(`Exited with code ${payload.exitCode}`);
                }
              } catch {
                // A done event we cannot parse carries no exit code, so it
                // cannot prove success.
                setErrorMsg("Operation ended with an unreadable completion event");
                setStatus(STATUS.ERROR);
              }
            } else if (eventLine === "error") {
              sawTerminalEvent = true;
              try {
                const payload = JSON.parse(dataLine);
                setErrorMsg(payload.message || dataLine);
              } catch {
                setErrorMsg(dataLine);
              }
              setStatus(STATUS.ERROR);
            }
            // "start" event — just the operation name echoed back, ignore
          }
        }

        if (cancelled) return;

        // Stream ended without an explicit done/error event. That is NOT
        // evidence of success: a proxy timeout or server restart closes the
        // stream while the operation may still be running or may have failed.
        // Report it as an unresolved outcome instead of "Completed (exit 0)".
        if (!sawTerminalEvent) {
          setErrorMsg(
            "Connection ended before the operation reported completion. " +
              "Check the runner's operation history for the actual result."
          );
          setStatus(STATUS.ERROR);
        }
      } catch (err) {
        if (err.name === "AbortError" || cancelled) return;
        setErrorMsg(err.message || "Connection failed");
        setStatus(STATUS.ERROR);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, runnerId, appName, operationName, appendLog]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      startedRef.current = false;
      setStatus(STATUS.IDLE);
      setLines([]);
      setExitCode(null);
      setErrorMsg("");
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isDone = status === STATUS.DONE || status === STATUS.ERROR;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>Operation</span>
            <span className={styles.opName}>{operationName}</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={!isDone}
            title={isDone ? "Close" : "Operation in progress…"}
          >
            <X size={18} />
          </button>
        </div>

        <div
          className={`${styles.statusBar} ${
            status === STATUS.RUNNING
              ? styles.statusRunning
              : status === STATUS.DONE
                ? styles.statusDone
                : status === STATUS.ERROR
                  ? styles.statusError
                  : ""
          }`}
        >
          {status === STATUS.RUNNING && (
            <>
              <span className={styles.spinner} /> Running…
            </>
          )}
          {status === STATUS.DONE && (
            <>
              <CheckCircle size={15} /> Completed (exit 0)
            </>
          )}
          {status === STATUS.ERROR && (
            <>
              <AlertCircle size={15} /> {errorMsg || `Failed (exit ${exitCode ?? 1})`}
            </>
          )}
        </div>

        <div className={styles.output} ref={outputRef}>
          {lines.length === 0 && status === STATUS.RUNNING && (
            <span className={styles.waiting}>Connecting to runner…</span>
          )}
          {lines.map((line, i) => (
            <div key={i} className={styles.line}>
              {line}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.closeFooterBtn} onClick={onClose} disabled={!isDone}>
            {isDone ? "Close" : "Running…"}
          </button>
        </div>
      </div>
    </div>
  );
}
