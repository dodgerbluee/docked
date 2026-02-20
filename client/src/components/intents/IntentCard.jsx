/**
 * IntentCard Component
 * Displays a single intent as a card with summary info and actions
 */

import React, { useCallback, useState } from "react";
import PropTypes from "prop-types";
import {
  Pencil,
  Trash2,
  Play,
  Eye,
  Zap,
  Clock,
  ToggleLeft,
  ToggleRight,
  History,
  Loader2,
} from "lucide-react";
import {
  SCHEDULE_TYPES,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_COLORS,
} from "../../constants/intents";
import styles from "./IntentCard.module.css";

function IntentCard({ intent, onEdit, onDelete, onToggle, onExecute, onDryRun, onViewHistory }) {
  const [executing, setExecuting] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);

  const handleEdit = useCallback(
    (e) => {
      e.stopPropagation();
      if (onEdit) onEdit(intent);
    },
    [intent, onEdit]
  );

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      if (onDelete) onDelete(intent.id, intent.name);
    },
    [intent.id, intent.name, onDelete]
  );

  const handleToggle = useCallback(
    (e) => {
      e.stopPropagation();
      if (onToggle) onToggle(intent.id);
    },
    [intent.id, onToggle]
  );

  const handleExecute = useCallback(
    async (e) => {
      e.stopPropagation();
      if (!onExecute || executing) return;
      setExecuting(true);
      try {
        await onExecute(intent.id);
      } finally {
        setExecuting(false);
      }
    },
    [intent.id, onExecute, executing]
  );

  const handleDryRun = useCallback(
    async (e) => {
      e.stopPropagation();
      if (!onDryRun || dryRunning) return;
      setDryRunning(true);
      try {
        await onDryRun(intent.id);
      } finally {
        setDryRunning(false);
      }
    },
    [intent.id, onDryRun, dryRunning]
  );

  const handleViewHistory = useCallback(
    (e) => {
      e.stopPropagation();
      if (onViewHistory) onViewHistory(intent.id);
    },
    [intent.id, onViewHistory]
  );

  // Build match summary text
  const matchSummary = [];
  if (intent.matchContainers?.length) {
    matchSummary.push(`${intent.matchContainers.length} container(s)`);
  }
  if (intent.matchImages?.length) {
    matchSummary.push(`${intent.matchImages.length} image pattern(s)`);
  }
  if (intent.matchInstances?.length) {
    matchSummary.push(`${intent.matchInstances.length} instance(s)`);
  }
  if (intent.matchStacks?.length) {
    matchSummary.push(`${intent.matchStacks.length} stack pattern(s)`);
  }
  if (intent.matchRegistries?.length) {
    matchSummary.push(`${intent.matchRegistries.length} registry(ies)`);
  }

  const isImmediate = intent.scheduleType === SCHEDULE_TYPES.IMMEDIATE;

  return (
    <div className={`${styles.card} ${!intent.enabled ? styles.disabled : ""}`}>
      <div className={styles.cardHeader}>
        <div className={styles.headerLeft}>
          <h3 className={styles.name}>{intent.name}</h3>
          <div className={styles.badges}>
            <span
              className={`${styles.badge} ${isImmediate ? styles.badgeImmediate : styles.badgeScheduled}`}
            >
              {isImmediate ? (
                <>
                  <Zap size={12} />
                  Immediate
                </>
              ) : (
                <>
                  <Clock size={12} />
                  Scheduled
                </>
              )}
            </span>
            {intent.dryRun ? (
              <span className={`${styles.badge} ${styles.badgeDryRun}`}>Dry Run</span>
            ) : null}
            {intent.lastExecutionStatus && (
              <span
                className={`${styles.badge} ${styles.badgeExecution}`}
                style={{ color: EXECUTION_STATUS_COLORS[intent.lastExecutionStatus] }}
              >
                {EXECUTION_STATUS_LABELS[intent.lastExecutionStatus] || intent.lastExecutionStatus}
              </span>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.toggleButton} ${intent.enabled ? styles.toggleOn : styles.toggleOff}`}
            onClick={handleToggle}
            aria-label={intent.enabled ? "Disable intent" : "Enable intent"}
            title={intent.enabled ? "Enabled - click to disable" : "Disabled - click to enable"}
          >
            {intent.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
          </button>
        </div>
      </div>

      {intent.description && <p className={styles.description}>{intent.description}</p>}

      <div className={styles.details}>
        {matchSummary.length > 0 ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Matches:</span>
            <span className={styles.detailValue}>{matchSummary.join(", ")}</span>
          </div>
        ) : (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Matches:</span>
            <span className={styles.detailValueMuted}>No match criteria set</span>
          </div>
        )}

        {!isImmediate && intent.scheduleCron ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Schedule:</span>
            <span className={styles.detailValue}>
              <code className={styles.cronExpression}>{intent.scheduleCron}</code>
            </span>
          </div>
        ) : (
          <div className={`${styles.detailRow} ${styles.detailRowPlaceholder}`}>
            <span className={styles.detailLabel}>&nbsp;</span>
          </div>
        )}
      </div>

      <div className={styles.cardFooter}>
        <div className={styles.actions}>
          <button
            className={`${styles.actionButton} ${styles.executeAction}`}
            onClick={handleExecute}
            disabled={executing}
            aria-label="Execute intent"
            title="Execute now"
          >
            {executing ? <Loader2 size={15} className={styles.spinning} /> : <Play size={15} />}
          </button>
          <button
            className={`${styles.actionButton} ${styles.dryRunAction}`}
            onClick={handleDryRun}
            disabled={dryRunning}
            aria-label="Dry run intent"
            title="Dry run (preview)"
          >
            {dryRunning ? <Loader2 size={15} className={styles.spinning} /> : <Eye size={15} />}
          </button>
          <button
            className={styles.actionButton}
            onClick={handleViewHistory}
            aria-label="View execution history"
            title="Execution history"
          >
            <History size={15} />
          </button>
          <span className={styles.actionSeparator} />
          <button
            className={styles.actionButton}
            onClick={handleEdit}
            aria-label="Edit intent"
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            className={`${styles.actionButton} ${styles.dangerAction}`}
            onClick={handleDelete}
            aria-label="Delete intent"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
        {intent.lastEvaluatedAt && (
          <span className={styles.lastRun}>
            <span className={styles.lastRunLabel}>Last run:</span>
            {new Date(intent.lastEvaluatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
              hour12: true,
            })}
          </span>
        )}
      </div>
    </div>
  );
}

IntentCard.propTypes = {
  intent: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    description: PropTypes.string,
    enabled: PropTypes.oneOfType([PropTypes.bool, PropTypes.number]),
    matchContainers: PropTypes.array,
    matchImages: PropTypes.array,
    matchInstances: PropTypes.array,
    matchStacks: PropTypes.array,
    matchRegistries: PropTypes.array,
    scheduleType: PropTypes.string,
    scheduleCron: PropTypes.string,
    dryRun: PropTypes.oneOfType([PropTypes.bool, PropTypes.number]),
    lastEvaluatedAt: PropTypes.string,
    lastExecutionStatus: PropTypes.string,
  }).isRequired,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
  onToggle: PropTypes.func,
  onExecute: PropTypes.func,
  onDryRun: PropTypes.func,
  onViewHistory: PropTypes.func,
};

export default React.memo(IntentCard);
