/**
 * OperationTasksModal
 *
 * Unified view over the operation task manager. A fixed-size modal with a left
 * column of task tabs (one per run, with a status chip) and a right console
 * showing the selected task's live output. Selecting a tab switches the console;
 * finished tasks can be dismissed individually or all at once. Closing only
 * hides the view — running operations keep streaming in the manager.
 */

import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { X, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { STATUS } from "../../utils/operationLog";
import styles from "./OperationTasksModal.module.css";

function formatAge(ts) {
  if (!ts) return "";
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function StatusChip({ status }) {
  if (status === STATUS.RUNNING) return <span className={styles.spinner} title="Running" />;
  if (status === STATUS.RECONNECTING)
    return (
      <RefreshCw
        size={15}
        className={`${styles.chipReconnecting} ${styles.spinIcon}`}
        aria-label="Reconnecting"
      />
    );
  if (status === STATUS.DONE)
    return <CheckCircle size={15} className={styles.chipDone} aria-label="Completed" />;
  return <AlertCircle size={15} className={styles.chipError} aria-label="Failed" />;
}

StatusChip.propTypes = { status: PropTypes.string.isRequired };

export default function OperationTasksModal({
  tasks,
  activeTaskId,
  onSelectTask,
  onDismiss,
  onDismissAll,
  onClose,
}) {
  const outputRef = useRef(null);
  const selected = tasks.find((t) => t.id === activeTaskId) || tasks[0] || null;
  const finished = tasks.filter((t) => t.status === STATUS.DONE || t.status === STATUS.ERROR);

  // Auto-scroll the console to the newest line of the selected task.
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [selected?.id, selected?.lines]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Operation Tasks</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Left: task tabs */}
          <div className={styles.sidebar}>
            <ul className={styles.tabList}>
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className={`${styles.tab} ${selected?.id === t.id ? styles.tabActive : ""}`}
                >
                  <button className={styles.tabBtn} onClick={() => onSelectTask(t.id)}>
                    <StatusChip status={t.status} />
                    <span className={styles.tabText}>
                      <span className={styles.tabName}>{t.operationLabel}</span>
                      <span className={styles.tabMeta}>
                        {t.runnerName}
                        {t.appName ? ` · ${t.appName}` : ""}
                      </span>
                    </span>
                    <span className={styles.tabAge}>{formatAge(t.finishedAt || t.startedAt)}</span>
                  </button>
                  {(t.status === STATUS.DONE || t.status === STATUS.ERROR) && (
                    <button
                      className={styles.tabDismiss}
                      onClick={() => onDismiss(t.id)}
                      title="Dismiss"
                      aria-label="Dismiss task"
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className={styles.sidebarFooter}>
              <button
                className={styles.dismissAllBtn}
                onClick={onDismissAll}
                disabled={!finished.length}
                title={finished.length ? "Dismiss all finished tasks" : "Nothing to dismiss"}
              >
                Dismiss all
              </button>
            </div>
          </div>

          {/* Right: console for the selected task */}
          <div className={styles.console}>
            {selected ? (
              <>
                <div
                  className={`${styles.statusBar} ${
                    selected.status === STATUS.RUNNING
                      ? styles.statusRunning
                      : selected.status === STATUS.RECONNECTING
                        ? styles.statusReconnecting
                        : selected.status === STATUS.DONE
                          ? styles.statusDone
                          : selected.status === STATUS.ERROR
                            ? styles.statusError
                            : ""
                  }`}
                >
                  {selected.status === STATUS.RUNNING && (
                    <>
                      <span className={styles.spinner} /> Running…
                    </>
                  )}
                  {selected.status === STATUS.RECONNECTING && (
                    <>
                      <RefreshCw size={15} className={styles.spinIcon} /> Reconnecting to runner…
                    </>
                  )}
                  {selected.status === STATUS.DONE && (
                    <>
                      <CheckCircle size={15} /> Completed (exit 0)
                    </>
                  )}
                  {selected.status === STATUS.ERROR && (
                    <>
                      <AlertCircle size={15} />{" "}
                      {selected.error || `Failed (exit ${selected.exitCode ?? 1})`}
                    </>
                  )}
                  <span className={styles.statusMeta}>
                    {selected.runnerName}
                    {selected.appName ? ` · ${selected.appName}` : ""}
                  </span>
                </div>
                <div className={styles.output} ref={outputRef}>
                  {selected.lines.length === 0 && selected.status === STATUS.RUNNING && (
                    <span className={styles.waiting}>Connecting to runner…</span>
                  )}
                  {selected.lines.map((line, i) => (
                    <div key={i} className={styles.line}>
                      {line}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.empty}>No tasks.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

OperationTasksModal.propTypes = {
  tasks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      operationLabel: PropTypes.string,
      runnerName: PropTypes.string,
      appName: PropTypes.string,
      status: PropTypes.string.isRequired,
      exitCode: PropTypes.number,
      error: PropTypes.string,
      lines: PropTypes.arrayOf(PropTypes.string),
      startedAt: PropTypes.string,
      finishedAt: PropTypes.string,
    })
  ).isRequired,
  activeTaskId: PropTypes.string,
  onSelectTask: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
  onDismissAll: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
