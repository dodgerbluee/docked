/**
 * OperationTasksDock
 *
 * Conditional, bottom-right launcher for the operation tasks modal. Renders only
 * when there is something to show (a running task, or finished tasks awaiting
 * dismissal). The button carries a running count and a red dot for failures;
 * clicking it opens the unified OperationTasksModal.
 */

import React from "react";
import PropTypes from "prop-types";
import { ListChecks } from "lucide-react";
import { STATUS } from "../../utils/operationLog";
import styles from "./OperationTasksDock.module.css";

export default function OperationTasksDock({ tasks, onOpen }) {
  if (!tasks.length) return null;

  // Reconnecting tasks are still running on the runner, so count them as active.
  const active = tasks.filter(
    (t) => t.status === STATUS.RUNNING || t.status === STATUS.RECONNECTING
  ).length;
  const failed = tasks.filter((t) => t.status === STATUS.ERROR).length;
  const label = active ? `${active} running` : `${tasks.length} task${tasks.length > 1 ? "s" : ""}`;

  return (
    <div className={styles.dock}>
      <button className={styles.toggle} onClick={onOpen} aria-label="Open operation tasks">
        <ListChecks size={18} />
        <span className={styles.toggleLabel}>{label}</span>
        {failed > 0 && (
          <span className={styles.failedDot} title={`${failed} failed`} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

OperationTasksDock.propTypes = {
  tasks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      status: PropTypes.string.isRequired,
    })
  ).isRequired,
  onOpen: PropTypes.func.isRequired,
};
