/**
 * OperationTasksDock
 *
 * Conditional, bottom-right "tasks tray" for the Apps page. Renders only when
 * there is something to show (a running task, or finished tasks awaiting
 * dismissal). The toggle button carries a running count and a red dot for new
 * failures; expanding it lists every task with a status chip, a per-task
 * dismiss (finished only), and a "Dismiss all" button.
 */

import React, { useState } from "react";
import PropTypes from "prop-types";
import { X, CheckCircle, AlertCircle, ListChecks, ChevronUp, ChevronDown } from "lucide-react";
import { STATUS } from "../../utils/operationLog";
import styles from "./OperationTasksDock.module.css";

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
  if (status === STATUS.DONE)
    return <CheckCircle size={15} className={styles.chipDone} aria-label="Completed" />;
  return <AlertCircle size={15} className={styles.chipError} aria-label="Failed" />;
}

StatusChip.propTypes = { status: PropTypes.string.isRequired };

export default function OperationTasksDock({ tasks, onOpenTask, onDismiss, onDismissAll }) {
  const [expanded, setExpanded] = useState(false);

  if (!tasks.length) return null;

  const running = tasks.filter((t) => t.status === STATUS.RUNNING);
  const failed = tasks.filter((t) => t.status === STATUS.ERROR);
  const finished = tasks.filter((t) => t.status !== STATUS.RUNNING);

  const label = running.length
    ? `${running.length} running`
    : `${tasks.length} task${tasks.length > 1 ? "s" : ""}`;

  return (
    <div className={styles.dock}>
      {expanded && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Tasks</span>
            <button
              className={styles.dismissAllBtn}
              onClick={onDismissAll}
              disabled={!finished.length}
              title={finished.length ? "Dismiss all finished tasks" : "Nothing to dismiss"}
            >
              Dismiss all
            </button>
          </div>
          <ul className={styles.list}>
            {tasks.map((t) => (
              <li key={t.id} className={styles.item}>
                <button className={styles.itemMain} onClick={() => onOpenTask(t.id)}>
                  <StatusChip status={t.status} />
                  <span className={styles.itemName}>{t.operationLabel}</span>
                  <span className={styles.itemMeta}>
                    {t.runnerName}
                    {t.appName ? ` · ${t.appName}` : ""}
                  </span>
                  <span className={styles.itemTime}>{formatAge(t.finishedAt || t.startedAt)}</span>
                </button>
                {t.status !== STATUS.RUNNING && (
                  <button
                    className={styles.dismissBtn}
                    onClick={() => onDismiss(t.id)}
                    title="Dismiss"
                    aria-label="Dismiss task"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ListChecks size={18} />
        <span className={styles.toggleLabel}>{label}</span>
        {failed.length > 0 && (
          <span className={styles.failedDot} title={`${failed.length} failed`} aria-hidden="true" />
        )}
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </div>
  );
}

OperationTasksDock.propTypes = {
  tasks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      operationLabel: PropTypes.string,
      runnerName: PropTypes.string,
      appName: PropTypes.string,
      status: PropTypes.string.isRequired,
      startedAt: PropTypes.string,
      finishedAt: PropTypes.string,
    })
  ).isRequired,
  onOpenTask: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
  onDismissAll: PropTypes.func.isRequired,
};
