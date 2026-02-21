/**
 * ExecutionDetailModal Component
 * Modal showing per-container results for a specific execution
 */

import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Eye,
  Clock,
  Loader2,
  Container,
} from "lucide-react";
import Modal from "../ui/Modal";
import LoadingSpinner from "../ui/LoadingSpinner";
import {
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_COLORS,
  TRIGGER_TYPE_LABELS,
  CONTAINER_STATUSES,
  CONTAINER_STATUS_LABELS,
  CONTAINER_STATUS_COLORS,
} from "../../constants/intents";
import { parseSQLiteDate } from "../../utils/dateParsing";
import styles from "./ExecutionDetailModal.module.css";

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format a date string to display
 */
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const date = parseSQLiteDate(dateStr);
  if (!date || isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  });
}

/**
 * Get the icon for a container status
 */
function getContainerStatusIcon(status) {
  switch (status) {
    case CONTAINER_STATUSES.UPGRADED:
      return <CheckCircle2 size={14} />;
    case CONTAINER_STATUSES.FAILED:
      return <XCircle size={14} />;
    case CONTAINER_STATUSES.SKIPPED:
      return <SkipForward size={14} />;
    case CONTAINER_STATUSES.DRY_RUN:
      return <Eye size={14} />;
    default:
      return <Clock size={14} />;
  }
}

function ExecutionDetailModal({ isOpen, onClose, executionId, fetchExecutionDetail }) {
  const [execution, setExecution] = useState(null);
  const [containers, setContainers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    if (!executionId || !fetchExecutionDetail) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await fetchExecutionDetail(executionId);
      if (result.success) {
        setExecution(result.execution);
        setContainers(result.containers);
      } else {
        setError(result.error || "Failed to load execution detail");
      }
    } catch (err) {
      setError("Failed to load execution detail");
    } finally {
      setIsLoading(false);
    }
  }, [executionId, fetchExecutionDetail]);

  useEffect(() => {
    if (isOpen && executionId) {
      loadDetail();
    }
  }, [isOpen, executionId, loadDetail]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setExecution(null);
      setContainers([]);
      setError("");
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Execution Detail" size="lg">
      <div className={styles.content}>
        {isLoading && <LoadingSpinner message="Loading execution detail..." />}
        {error && <div className={styles.error}>{error}</div>}

        {!isLoading && !error && execution && (
          <>
            {/* Summary section */}
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Status</span>
                <span
                  className={styles.statusBadge}
                  style={{
                    color: EXECUTION_STATUS_COLORS[execution.status],
                    background: `color-mix(in srgb, ${EXECUTION_STATUS_COLORS[execution.status]} 12%, transparent)`,
                  }}
                >
                  {EXECUTION_STATUS_LABELS[execution.status] || execution.status}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Trigger</span>
                <span className={styles.summaryValue}>
                  {TRIGGER_TYPE_LABELS[execution.triggerType] || execution.triggerType}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Started</span>
                <span className={styles.summaryValue}>{formatDate(execution.startedAt)}</span>
              </div>
              {execution.completedAt && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Completed</span>
                  <span className={styles.summaryValue}>{formatDate(execution.completedAt)}</span>
                </div>
              )}
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Duration</span>
                <span className={styles.summaryValue}>{formatDuration(execution.durationMs)}</span>
              </div>
              <div className={styles.summaryCounters}>
                <div className={styles.counter}>
                  <span className={styles.counterNumber}>{execution.containersMatched ?? 0}</span>
                  <span className={styles.counterLabel}>Matched</span>
                </div>
                <div className={`${styles.counter} ${styles.counterSuccess}`}>
                  <span className={styles.counterNumber}>{execution.containersUpgraded ?? 0}</span>
                  <span className={styles.counterLabel}>Upgraded</span>
                </div>
                <div className={`${styles.counter} ${styles.counterFailed}`}>
                  <span className={styles.counterNumber}>{execution.containersFailed ?? 0}</span>
                  <span className={styles.counterLabel}>Failed</span>
                </div>
                <div className={`${styles.counter} ${styles.counterSkipped}`}>
                  <span className={styles.counterNumber}>{execution.containersSkipped ?? 0}</span>
                  <span className={styles.counterLabel}>Skipped</span>
                </div>
              </div>
              {execution.errorMessage && (
                <div className={styles.executionError}>
                  <XCircle size={14} />
                  {execution.errorMessage}
                </div>
              )}
            </div>

            {/* Container results */}
            <div className={styles.containerSection}>
              <h4 className={styles.containerTitle}>
                <Container size={14} />
                Container Results ({containers.length})
              </h4>
              {containers.length === 0 ? (
                <div className={styles.noContainers}>No container results recorded.</div>
              ) : (
                <div className={styles.containerList}>
                  {containers.map((container) => (
                    <div key={container.id} className={styles.containerRow}>
                      <div className={styles.containerHeader}>
                        <span
                          className={styles.containerStatus}
                          style={{ color: CONTAINER_STATUS_COLORS[container.status] }}
                        >
                          {getContainerStatusIcon(container.status)}
                          {CONTAINER_STATUS_LABELS[container.status] || container.status}
                        </span>
                        <span className={styles.containerName}>{container.containerName}</span>
                        {container.durationMs != null && (
                          <span className={styles.containerDuration}>
                            {formatDuration(container.durationMs)}
                          </span>
                        )}
                      </div>
                      <div className={styles.containerDetails}>
                        <div className={styles.containerDetail}>
                          <span className={styles.detailLabel}>Image:</span>
                          <span className={styles.detailValue}>{container.imageName || "-"}</span>
                        </div>
                        {container.oldImage &&
                          container.newImage &&
                          container.oldImage !== container.newImage && (
                            <div className={styles.containerDetail}>
                              <span className={styles.detailLabel}>Updated:</span>
                              <span className={styles.detailValueCode}>
                                {container.oldImage} → {container.newImage}
                              </span>
                            </div>
                          )}
                        {container.errorMessage && (
                          <div className={styles.containerError}>
                            <XCircle size={12} />
                            {container.errorMessage}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

ExecutionDetailModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  executionId: PropTypes.number,
  fetchExecutionDetail: PropTypes.func.isRequired,
};

export default React.memo(ExecutionDetailModal);
