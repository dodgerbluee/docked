/**
 * RunnerUpgradeModal
 *
 * Streams real upgrade output from a dockhand instance via SSE.
 * Shown instead of UpgradeProgressModal when container.source === "runner".
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { X, CheckCircle, AlertCircle } from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import styles from "./RunnerUpgradeModal.module.css";

const STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
};

export default function RunnerUpgradeModal({ isOpen, container, onClose, onSuccess }) {
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const outputRef = useRef(null);
  const xhrRef = useRef(null);
  const startedRef = useRef(false);

  const appendLine = useCallback((line) => {
    setLines((prev) => [...prev, line]);
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Start upgrade stream when modal opens
  useEffect(() => {
    if (!isOpen || !container || startedRef.current) return;
    startedRef.current = true;

    const runnerId = container.runnerId;
    const containerId = container.id;

    setStatus(STATUS.RUNNING);
    setLines([]);
    setResult(null);
    setErrorMsg("");

    const url = `${API_BASE_URL}/api/runners/${runnerId}/containers/${encodeURIComponent(containerId)}/upgrade`;

    // Use fetch with streaming for the SSE response
    const controller = new AbortController();
    xhrRef.current = controller;

    (async () => {
      try {
        const resp = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream",
            // Auth token injected by axios interceptor — but fetch doesn't share axios config.
            // Grab token from localStorage
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

          // Parse SSE events from buffer
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventLine = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const dataLine = part.match(/^data:\s*(.+)$/ms)?.[1]?.trim();

            if (!dataLine) continue;

            if (eventLine === "line") {
              // Raw log line — data is plain text (may be JSON-encoded string)
              try {
                appendLine(JSON.parse(dataLine));
              } catch {
                appendLine(dataLine);
              }
            } else if (eventLine === "result") {
              try {
                setResult(JSON.parse(dataLine));
              } catch {
                /* ignore */
              }
            } else if (eventLine === "done") {
              try {
                const payload = JSON.parse(dataLine);
                if (payload.exitCode === 0) {
                  setStatus(STATUS.DONE);
                  if (onSuccess) onSuccess(container);
                } else {
                  setStatus(STATUS.ERROR);
                  setErrorMsg("Upgrade exited with a non-zero status.");
                }
              } catch {
                setStatus(STATUS.DONE);
                if (onSuccess) onSuccess(container);
              }
            } else if (eventLine === "error") {
              try {
                const payload = JSON.parse(dataLine);
                setErrorMsg(payload.message || "Unknown error");
              } catch {
                setErrorMsg(dataLine);
              }
              setStatus(STATUS.ERROR);
            } else if (eventLine === "start") {
              // start event — container id echoed back, ignore
            }
          }
        }

        // Stream ended without explicit done event
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
  }, [isOpen, container]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      startedRef.current = false;
      setStatus(STATUS.IDLE);
      setLines([]);
      setResult(null);
      setErrorMsg("");
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isDone = status === STATUS.DONE || status === STATUS.ERROR;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Runner Upgrade">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.runnerBadge}>Runner Upgrade</span>
            <span className={styles.containerName}>{container?.name}</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={!isDone}
            title={isDone ? "Close" : "Upgrade in progress…"}
          >
            <X size={18} />
          </button>
        </div>

        {/* Runner info */}
        {container?.runnerName && (
          <div className={styles.runnerInfo}>
            via <strong>{container.runnerName}</strong>
            {container.runnerUrl && (
              <span className={styles.runnerUrl}> ({container.runnerUrl})</span>
            )}
          </div>
        )}

        {/* Status bar */}
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
              <span className={styles.spinner} /> Upgrading…
            </>
          )}
          {status === STATUS.DONE && (
            <>
              <CheckCircle size={15} /> Upgrade complete
            </>
          )}
          {status === STATUS.ERROR && (
            <>
              <AlertCircle size={15} /> {errorMsg || "Upgrade failed"}
            </>
          )}
        </div>

        {/* Terminal output */}
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

        {/* Result summary */}
        {result && status === STATUS.DONE && (
          <div className={styles.resultSummary}>
            <span>Strategy: {result.strategy}</span>
            {result.durationSeconds != null && (
              <span>Duration: {result.durationSeconds.toFixed(1)}s</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.closeFooterBtn} onClick={onClose} disabled={!isDone}>
            {isDone ? "Close" : "Upgrading…"}
          </button>
        </div>
      </div>
    </div>
  );
}

RunnerUpgradeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  container: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
