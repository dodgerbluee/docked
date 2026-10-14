/**
 * OperationTaskModal
 *
 * Detail view for a single operation task owned by useOperationTasks. It is a
 * pure view over the task's buffered output — it does NOT own the stream, so
 * closing it only hides the output; the operation keeps running in the manager.
 */

import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { X, CheckCircle, AlertCircle } from "lucide-react";
import { STATUS } from "../../utils/operationLog";
import styles from "./OperationTaskModal.module.css";

export default function OperationTaskModal({ task, onClose }) {
  const outputRef = useRef(null);

  // Auto-scroll to the newest line.
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [task?.lines]);

  if (!task) return null;

  const isDone = task.status === STATUS.DONE || task.status === STATUS.ERROR;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>Operation</span>
            <span className={styles.opName}>{task.operationLabel}</span>
            <span className={styles.runnerTag}>
              {task.runnerName}
              {task.appName ? ` · ${task.appName}` : ""}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div
          className={`${styles.statusBar} ${
            task.status === STATUS.RUNNING
              ? styles.statusRunning
              : task.status === STATUS.DONE
                ? styles.statusDone
                : task.status === STATUS.ERROR
                  ? styles.statusError
                  : ""
          }`}
        >
          {task.status === STATUS.RUNNING && (
            <>
              <span className={styles.spinner} /> Running…
            </>
          )}
          {task.status === STATUS.DONE && (
            <>
              <CheckCircle size={15} /> Completed (exit 0)
            </>
          )}
          {task.status === STATUS.ERROR && (
            <>
              <AlertCircle size={15} /> {task.error || `Failed (exit ${task.exitCode ?? 1})`}
            </>
          )}
        </div>

        <div className={styles.output} ref={outputRef}>
          {task.lines.length === 0 && task.status === STATUS.RUNNING && (
            <span className={styles.waiting}>Connecting to runner…</span>
          )}
          {task.lines.map((line, i) => (
            <div key={i} className={styles.line}>
              {line}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.closeFooterBtn} onClick={onClose}>
            {isDone ? "Close" : "Hide (keeps running)"}
          </button>
        </div>
      </div>
    </div>
  );
}

OperationTaskModal.propTypes = {
  task: PropTypes.shape({
    operationLabel: PropTypes.string,
    runnerName: PropTypes.string,
    appName: PropTypes.string,
    status: PropTypes.string,
    exitCode: PropTypes.number,
    error: PropTypes.string,
    lines: PropTypes.arrayOf(PropTypes.string),
  }),
  onClose: PropTypes.func.isRequired,
};
