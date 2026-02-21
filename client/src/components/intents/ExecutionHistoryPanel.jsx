/**
 * ExecutionHistoryPanel Component
 * Displays execution history for a specific intent with inline detail view
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Circle,
  Container,
  SkipForward,
  Eye,
} from "lucide-react";
import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_COLORS,
  TRIGGER_TYPE_LABELS,
  CONTAINER_STATUSES,
  CONTAINER_STATUS_LABELS,
  CONTAINER_STATUS_COLORS,
} from "../../constants/intents";
import { parseSQLiteDate } from "../../utils/dateParsing";
import EmptyState from "../ui/EmptyState";
import LoadingSpinner from "../ui/LoadingSpinner";
import styles from "./ExecutionHistoryPanel.module.css";

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
 * Format a date string to a compact display (for the list view)
 */
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const date = parseSQLiteDate(dateStr);
  if (!date || isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });
}

/**
 * Format a date string with full detail (for the detail view)
 */
function formatDateFull(dateStr) {
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
 * Get the icon for an execution status
 */
function getStatusIcon(status, size = 14) {
  switch (status) {
    case EXECUTION_STATUSES.COMPLETED:
      return <CheckCircle2 size={size} />;
    case EXECUTION_STATUSES.FAILED:
      return <XCircle size={size} />;
    case EXECUTION_STATUSES.PARTIAL:
      return <AlertTriangle size={size} />;
    case EXECUTION_STATUSES.RUNNING:
      return <Loader2 size={size} className={styles.spinning} />;
    case EXECUTION_STATUSES.PENDING:
      return <Clock size={size} />;
    default:
      return <Circle size={size} />;
  }
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

/* ---------- Detail View (inline) ---------- */

function ExecutionDetailView({ execution, containers, onBack }) {
  return (
    <div className={styles.detailView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        <ChevronLeft size={16} />
        <span>Execution History</span>
      </button>

      {/* Summary section */}
      <div className={styles.detailSummary}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Status</span>
          <span
            className={styles.statusBadge}
            style={{
              color: EXECUTION_STATUS_COLORS[execution.status],
              background: `color-mix(in srgb, ${EXECUTION_STATUS_COLORS[execution.status]} 12%, transparent)`,
            }}
          >
            {getStatusIcon(execution.status)}
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
          <span className={styles.summaryValue}>{formatDateFull(execution.startedAt)}</span>
        </div>
        {execution.completedAt && (
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Completed</span>
            <span className={styles.summaryValue}>{formatDateFull(execution.completedAt)}</span>
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
    </div>
  );
}

ExecutionDetailView.propTypes = {
  execution: PropTypes.object.isRequired,
  containers: PropTypes.array.isRequired,
  onBack: PropTypes.func.isRequired,
};

/* ---------- Main Panel ---------- */

function ExecutionHistoryPanel({ intentId, intentName, fetchExecutions, fetchExecutionDetail }) {
  const [executions, setExecutions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Detail view state
  const [selectedExecutionId, setSelectedExecutionId] = useState(null);
  const [detailExecution, setDetailExecution] = useState(null);
  const [detailContainers, setDetailContainers] = useState([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const scrollRef = useRef(null);

  const loadExecutions = useCallback(async () => {
    if (!intentId || !fetchExecutions) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await fetchExecutions(intentId, 25);
      if (result.success) {
        setExecutions(result.executions);
      } else {
        setError(result.error || "Failed to load executions");
      }
    } catch (err) {
      // Log for debugging while keeping the user-facing message generic
      console.error("loadExecutions error:", err);
      setError("Failed to load executions");
    } finally {
      setIsLoading(false);
    }
  }, [intentId, fetchExecutions]);

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  const handleViewDetail = useCallback(
    async (executionId) => {
      if (!fetchExecutionDetail) return;
      setSelectedExecutionId(executionId);
      setIsLoadingDetail(true);
      setDetailError("");
      setDetailExecution(null);
      setDetailContainers([]);

      try {
        const result = await fetchExecutionDetail(executionId);
        if (result.success) {
          setDetailExecution(result.execution);
          setDetailContainers(result.containers);
        } else {
          setDetailError(result.error || "Failed to load execution detail");
        }
      } catch (err) {
        console.error("handleViewDetail error:", err);
        setDetailError("Failed to load execution detail");
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [fetchExecutionDetail]
  );

  const handleBack = useCallback(() => {
    setSelectedExecutionId(null);
    setDetailExecution(null);
    setDetailContainers([]);
    setDetailError("");
  }, []);

  // Scroll to top when switching views
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [selectedExecutionId]);

  // Loading state for the list
  if (isLoading) {
    return (
      <div className={styles.panel}>
        <LoadingSpinner size="sm" message="Loading executions..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.panel}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!selectedExecutionId && executions.length === 0) {
    return (
      <div className={styles.panel}>
        <EmptyState icon={History} message="No executions yet for this intent." />
      </div>
    );
  }

  // Detail view
  if (selectedExecutionId) {
    return (
      <div className={styles.panel} ref={scrollRef}>
        {isLoadingDetail && <LoadingSpinner size="sm" message="Loading execution detail..." />}
        {detailError && (
          <div>
            <button type="button" className={styles.backButton} onClick={handleBack}>
              <ChevronLeft size={16} />
              <span>Execution History</span>
            </button>
            <div className={styles.error}>{detailError}</div>
          </div>
        )}
        {!isLoadingDetail && !detailError && detailExecution && (
          <ExecutionDetailView
            execution={detailExecution}
            containers={detailContainers}
            onBack={handleBack}
          />
        )}
      </div>
    );
  }

  // List view
  return (
    <div className={styles.panel} ref={scrollRef}>
      <div className={styles.header}>
        <span className={styles.count}>{executions.length} execution(s)</span>
      </div>
      <div className={styles.list}>
        {executions.map((execution) => (
          <button
            key={execution.id}
            className={styles.executionRow}
            onClick={() => handleViewDetail(execution.id)}
            type="button"
          >
            <div className={styles.rowLeft}>
              <span
                className={styles.statusIcon}
                style={{ color: EXECUTION_STATUS_COLORS[execution.status] }}
              >
                {getStatusIcon(execution.status)}
              </span>
              <div className={styles.rowInfo}>
                <span className={styles.rowStatus}>
                  {EXECUTION_STATUS_LABELS[execution.status] || execution.status}
                </span>
                <span className={styles.rowMeta}>
                  {TRIGGER_TYPE_LABELS[execution.triggerType] || execution.triggerType}
                  {" · "}
                  {formatDate(execution.startedAt)}
                </span>
              </div>
            </div>
            <div className={styles.rowRight}>
              <div className={styles.rowCounts}>
                {execution.containersMatched > 0 && (
                  <span className={styles.countChip}>{execution.containersMatched} matched</span>
                )}
                {execution.containersUpgraded > 0 && (
                  <span className={`${styles.countChip} ${styles.countSuccess}`}>
                    {execution.containersUpgraded} upgraded
                  </span>
                )}
                {execution.containersFailed > 0 && (
                  <span className={`${styles.countChip} ${styles.countFailed}`}>
                    {execution.containersFailed} failed
                  </span>
                )}
                {execution.containersSkipped > 0 && (
                  <span className={`${styles.countChip} ${styles.countSkipped}`}>
                    {execution.containersSkipped} skipped
                  </span>
                )}
              </div>
              <span className={styles.duration}>{formatDuration(execution.durationMs)}</span>
              <ChevronRight size={14} className={styles.chevron} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

ExecutionHistoryPanel.propTypes = {
  intentId: PropTypes.number,
  intentName: PropTypes.string,
  fetchExecutions: PropTypes.func.isRequired,
  fetchExecutionDetail: PropTypes.func,
};

export default React.memo(ExecutionHistoryPanel);
