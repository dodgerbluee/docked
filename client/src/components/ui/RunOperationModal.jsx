/**
 * RunOperationModal
 *
 * Streams live output from a dockhand operation via SSE (POST).
 * Opened from the Operations panel on a runner card in RunnerTab.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, CheckCircle, AlertCircle } from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import styles from "./RunOperationModal.module.css";

const STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
};

// Strip all ANSI/VT escape sequences (colors, bold, cursor movement, etc.)
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_OTHER_RE = /\x1b./g;
// Detect clear-screen sequences (ESC[2J or ESC[3J) — signal to reset the line buffer
const CLEAR_SCREEN_RE = /\x1b\[(?:2J|3J)/;

function processRawLog(raw) {
  const shouldClear = CLEAR_SCREEN_RE.test(raw);
  const stripped = raw
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_OTHER_RE, "");

  // Split into display lines; handle \r (carriage-return overwrite): last segment wins
  const lines = stripped
    .split("\n")
    .map((seg) => {
      const parts = seg.split("\r");
      return parts[parts.length - 1];
    })
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return { shouldClear, lines };
}

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

        // eslint-disable-next-line no-constant-condition
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
              appendLog(dataLine);
            } else if (eventLine === "done") {
              try {
                const payload = JSON.parse(dataLine);
                setExitCode(payload.exitCode ?? 0);
                setStatus(payload.exitCode === 0 ? STATUS.DONE : STATUS.ERROR);
                if (payload.exitCode !== 0) {
                  setErrorMsg(`Exited with code ${payload.exitCode}`);
                }
              } catch {
                setStatus(STATUS.DONE);
              }
            } else if (eventLine === "error") {
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

        // Stream ended without explicit done
        if (status === STATUS.RUNNING) {
          setStatus(STATUS.DONE);
        }
      } catch (err) {
        if (err.name === "AbortError") return;
        setErrorMsg(err.message || "Connection failed");
        setStatus(STATUS.ERROR);
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {status === STATUS.RUNNING && <><span className={styles.spinner} /> Running…</>}
          {status === STATUS.DONE && <><CheckCircle size={15} /> Completed (exit 0)</>}
          {status === STATUS.ERROR && (
            <><AlertCircle size={15} /> {errorMsg || `Failed (exit ${exitCode ?? 1})`}</>
          )}
        </div>

        <div className={styles.output} ref={outputRef}>
          {lines.length === 0 && status === STATUS.RUNNING && (
            <span className={styles.waiting}>Connecting to runner…</span>
          )}
          {lines.map((line, i) => (
            <div key={i} className={styles.line}>{line}</div>
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
