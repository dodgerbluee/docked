/**
 * IntentDetailModal Component
 * Modal displaying detailed intent information with tabs:
 *   - Configuration: match/exclude criteria, schedule, settings
 *   - Current Matches: containers currently matching this intent
 *   - Next Execution Preview: what would happen on next run
 *   - History: execution history with drill-down to per-container results
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import cronstrue from "cronstrue";
import {
  Settings,
  Target,
  Calendar,
  History as HistoryIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  ToggleRight,
  ToggleLeft,
  Eye,
  Container,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Server,
  Box,
  Image,
  Layers,
  Database,
  ShieldOff,
  Pencil,
  Trash2,
} from "lucide-react";
import Modal from "../ui/Modal";
import Tabs from "../ui/Tabs";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import LoadingSpinner from "../ui/LoadingSpinner";
import { useIntents } from "../../hooks/useIntents";
import {
  SCHEDULE_TYPES,
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_COLORS,
  TRIGGER_TYPE_LABELS,
  CONTAINER_STATUSES,
  CONTAINER_STATUS_LABELS,
  CONTAINER_STATUS_COLORS,
} from "../../constants/intents";
import { parseSQLiteDate } from "../../utils/dateParsing";
import styles from "./IntentDetailModal.module.css";

/* ==========================================
   Tab Constants
   ========================================== */

const TAB_CONFIG = "config";
const TAB_MATCHES = "matches";
const TAB_PREVIEW = "preview";
const TAB_HISTORY = "history";

const TAB_OPTIONS = [
  { value: TAB_CONFIG, label: "Configuration", icon: Settings },
  { value: TAB_MATCHES, label: "Current Matches", icon: Target },
  { value: TAB_PREVIEW, label: "Preview", icon: Calendar },
  { value: TAB_HISTORY, label: "History", icon: HistoryIcon },
];

/* ==========================================
   Utility Functions
   ========================================== */

function formatDuration(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

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
      return <Clock size={size} />;
  }
}

function getContainerStatusIcon(status) {
  switch (status) {
    case CONTAINER_STATUSES.UPGRADED:
      return <CheckCircle2 size={14} />;
    case CONTAINER_STATUSES.FAILED:
      return <XCircle size={14} />;
    case CONTAINER_STATUSES.SKIPPED:
      return <SkipForward size={14} />;
    case CONTAINER_STATUSES.DRY_RUN:
    case CONTAINER_STATUSES.WOULD_UPGRADE:
      return <Eye size={14} />;
    default:
      return <Clock size={14} />;
  }
}

/* ==========================================
   Configuration Tab
   ========================================== */

function ConfigTab({ intent, portainerInstances }) {
  // Build portainer ID-to-name map
  const idToName = useMemo(() => {
    const map = new Map();
    if (portainerInstances?.length > 0) {
      for (const inst of portainerInstances) {
        if (inst.name && inst.id != null) {
          map.set(String(inst.id), inst.name);
        }
      }
    }
    return map;
  }, [portainerInstances]);

  // Compute human-readable cron description
  const cronDescription = useMemo(() => {
    const raw = intent?.scheduleCron?.trim();
    if (!raw) return null;
    try {
      return cronstrue.toString(raw, { use24HourTimeFormat: false, verbose: false });
    } catch {
      return null;
    }
  }, [intent?.scheduleCron]);

  if (!intent) return null;

  const isImmediate = intent.scheduleType === SCHEDULE_TYPES.IMMEDIATE;

  // Resolve portainer instance IDs to names
  const resolveInstanceValues = (values) => {
    if (!values?.length) return [];
    return values.map((v) => idToName.get(String(v)) || String(v));
  };

  // Build match criteria sections
  const matchCriteria = [
    { label: "Containers", values: intent.matchContainers, icon: Box },
    { label: "Images", values: intent.matchImages, icon: Image },
    { label: "Stacks", values: intent.matchStacks, icon: Layers },
    {
      label: "Portainer Instances",
      values: resolveInstanceValues(intent.matchInstances),
      icon: Server,
    },
    { label: "Registries", values: intent.matchRegistries, icon: Database },
  ].filter((c) => c.values?.length > 0);

  const excludeCriteria = [
    { label: "Containers", values: intent.excludeContainers, icon: Box },
    { label: "Images", values: intent.excludeImages, icon: Image },
    { label: "Stacks", values: intent.excludeStacks, icon: Layers },
    { label: "Registries", values: intent.excludeRegistries, icon: Database },
  ].filter((c) => c.values?.length > 0);

  return (
    <div className={styles.configContent}>
      {/* Status row */}
      <div className={styles.statusRow}>
        <span
          className={`${styles.statusPill} ${intent.enabled ? styles.statusEnabled : styles.statusDisabled}`}
        >
          {intent.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {intent.enabled ? "Enabled" : "Disabled"}
        </span>
        <span
          className={`${styles.statusPill} ${isImmediate ? styles.statusImmediate : styles.statusScheduled}`}
        >
          {isImmediate ? <Zap size={14} /> : <Clock size={14} />}
          {isImmediate ? "Immediate" : "Scheduled"}
        </span>
        {intent.dryRun && (
          <span className={`${styles.statusPill} ${styles.statusDryRun}`}>
            <Eye size={14} />
            Dry Run
          </span>
        )}
      </div>

      {/* Description */}
      {intent.description && <div className={styles.descriptionBlock}>{intent.description}</div>}

      {/* Match Criteria */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          <Target size={14} />
          Match Criteria
        </h4>
        {matchCriteria.length === 0 ? (
          <div className={styles.emptySection}>No match criteria configured</div>
        ) : (
          <div className={styles.criteriaGrid}>
            {matchCriteria.map((criteria) => (
              <div key={criteria.label} className={styles.criteriaCard}>
                <div className={styles.criteriaHeader}>
                  <criteria.icon size={13} />
                  <span className={styles.criteriaLabel}>{criteria.label}</span>
                  <span className={styles.criteriaCount}>{criteria.values.length}</span>
                </div>
                <div className={styles.criteriaValues}>
                  {criteria.values.map((val, i) => (
                    <span key={i} className={styles.criteriaChip}>
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Exclusion Criteria */}
      {excludeCriteria.length > 0 && (
        <div className={styles.section}>
          <h4 className={`${styles.sectionTitle} ${styles.sectionTitleExclude}`}>
            <ShieldOff size={14} />
            Exclusions
          </h4>
          <div className={styles.criteriaGrid}>
            {excludeCriteria.map((criteria) => (
              <div
                key={criteria.label}
                className={`${styles.criteriaCard} ${styles.criteriaCardExclude}`}
              >
                <div className={styles.criteriaHeader}>
                  <criteria.icon size={13} />
                  <span className={styles.criteriaLabel}>{criteria.label}</span>
                  <span className={`${styles.criteriaCount} ${styles.criteriaCountExclude}`}>
                    {criteria.values.length}
                  </span>
                </div>
                <div className={styles.criteriaValues}>
                  {criteria.values.map((val, i) => (
                    <span
                      key={i}
                      className={`${styles.criteriaChip} ${styles.criteriaChipExclude}`}
                    >
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule */}
      {!isImmediate && intent.scheduleCron && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            <Clock size={14} />
            Schedule
          </h4>
          <div className={styles.scheduleDisplay}>
            <code className={styles.cronCode}>{intent.scheduleCron}</code>
            {cronDescription && <span className={styles.cronDescription}>{cronDescription}</span>}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className={styles.metaRow}>
        {intent.lastEvaluatedAt && (
          <span className={styles.metaItem}>Last run: {formatDate(intent.lastEvaluatedAt)}</span>
        )}
        {intent.createdAt && (
          <span className={styles.metaItem}>Created: {formatDate(intent.createdAt)}</span>
        )}
      </div>
    </div>
  );
}

ConfigTab.propTypes = {
  intent: PropTypes.object,
  portainerInstances: PropTypes.array,
};

/* ==========================================
   Matches Tab
   ========================================== */

function MatchesTab({ intent, previewData, loading }) {
  if (loading) {
    return <LoadingSpinner size="sm" message="Loading matches..." />;
  }

  if (!previewData) {
    return <EmptyState icon={Target} message="No match data available." />;
  }

  const matches = previewData.currentMatches || [];

  if (matches.length === 0) {
    return <EmptyState icon={Target} message="No containers currently match this intent." />;
  }

  return (
    <div className={styles.matchesContent}>
      <div className={styles.matchesHeader}>
        <span className={styles.matchesCount}>
          <Container size={14} />
          {matches.length} container{matches.length !== 1 ? "s" : ""} matched
        </span>
      </div>
      <div className={styles.containerList}>
        {matches.map((container, i) => (
          <div key={i} className={styles.containerCard}>
            <div className={styles.containerCardHeader}>
              <Container size={14} className={styles.containerIcon} />
              <span className={styles.containerCardName}>{container.containerName}</span>
            </div>
            <div className={styles.containerCardDetails}>
              <div className={styles.containerDetail}>
                <span className={styles.detailLabel}>Image:</span>
                <span className={styles.detailValueCode}>{container.imageName || "-"}</span>
              </div>
              {container.stackName && (
                <div className={styles.containerDetail}>
                  <span className={styles.detailLabel}>Stack:</span>
                  <span className={styles.detailValue}>{container.stackName}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

MatchesTab.propTypes = {
  intent: PropTypes.object,
  previewData: PropTypes.object,
  loading: PropTypes.bool,
};

/* ==========================================
   Preview Tab
   ========================================== */

function PreviewTab({ intent, previewData, loading }) {
  if (loading) {
    return <LoadingSpinner size="sm" message="Loading preview..." />;
  }

  if (!previewData) {
    return <EmptyState icon={Calendar} message="No preview data available." />;
  }

  const preview = previewData.nextExecutionPreview;
  const containers = preview?.containers || [];

  if (containers.length === 0) {
    return (
      <EmptyState icon={Calendar} message="No containers would be upgraded on next execution." />
    );
  }

  // Count statuses
  const statusCounts = containers.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className={styles.previewContent}>
      {/* Summary counters */}
      <div className={styles.previewSummary}>
        <div className={styles.summaryCounters}>
          <div className={styles.counter}>
            <span className={styles.counterNumber}>{containers.length}</span>
            <span className={styles.counterLabel}>Total</span>
          </div>
          {statusCounts.would_upgrade > 0 && (
            <div className={`${styles.counter} ${styles.counterDryRun}`}>
              <span className={styles.counterNumber}>{statusCounts.would_upgrade}</span>
              <span className={styles.counterLabel}>Would Upgrade</span>
            </div>
          )}
          {statusCounts.dry_run > 0 && (
            <div className={`${styles.counter} ${styles.counterDryRun}`}>
              <span className={styles.counterNumber}>{statusCounts.dry_run}</span>
              <span className={styles.counterLabel}>Would Upgrade</span>
            </div>
          )}
          {statusCounts.upgraded > 0 && (
            <div className={`${styles.counter} ${styles.counterSuccess}`}>
              <span className={styles.counterNumber}>{statusCounts.upgraded}</span>
              <span className={styles.counterLabel}>Upgrade</span>
            </div>
          )}
          {statusCounts.skipped > 0 && (
            <div className={`${styles.counter} ${styles.counterSkipped}`}>
              <span className={styles.counterNumber}>{statusCounts.skipped}</span>
              <span className={styles.counterLabel}>Skip</span>
            </div>
          )}
        </div>
      </div>

      {/* Container list */}
      <div className={styles.containerList}>
        {containers.map((container, i) => (
          <div key={i} className={styles.containerCard}>
            <div className={styles.containerCardHeader}>
              <span
                className={styles.previewStatus}
                style={{
                  color: CONTAINER_STATUS_COLORS[container.status] || "var(--text-secondary)",
                }}
              >
                {getContainerStatusIcon(container.status)}
                {CONTAINER_STATUS_LABELS[container.status] || container.status}
              </span>
              <span className={styles.containerCardName}>{container.containerName}</span>
            </div>
            <div className={styles.containerCardDetails}>
              <div className={styles.containerDetail}>
                <span className={styles.detailLabel}>Image:</span>
                <span className={styles.detailValueCode}>{container.imageName || "-"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

PreviewTab.propTypes = {
  intent: PropTypes.object,
  previewData: PropTypes.object,
  loading: PropTypes.bool,
};

/* ==========================================
   History Tab (with inline detail)
   ========================================== */

function HistoryTab({ intent, executions, loading, fetchExecutionDetail }) {
  const [selectedExecId, setSelectedExecId] = useState(null);
  const [detailExec, setDetailExec] = useState(null);
  const [detailContainers, setDetailContainers] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleViewDetail = useCallback(
    async (executionId) => {
      if (!fetchExecutionDetail) return;
      setSelectedExecId(executionId);
      setLoadingDetail(true);
      try {
        const result = await fetchExecutionDetail(executionId);
        if (result.success) {
          setDetailExec(result.execution);
          setDetailContainers(result.containers);
        }
      } catch (err) {
        console.error("Failed to load execution detail:", err);
      } finally {
        setLoadingDetail(false);
      }
    },
    [fetchExecutionDetail]
  );

  const handleBack = useCallback(() => {
    setSelectedExecId(null);
    setDetailExec(null);
    setDetailContainers([]);
  }, []);

  if (loading) {
    return <LoadingSpinner size="sm" message="Loading executions..." />;
  }

  // Detail view
  if (selectedExecId) {
    if (loadingDetail) {
      return <LoadingSpinner size="sm" message="Loading execution detail..." />;
    }

    if (!detailExec) {
      return (
        <div>
          <button type="button" className={styles.backButton} onClick={handleBack}>
            <ChevronLeft size={16} />
            <span>Back to History</span>
          </button>
          <div className={styles.errorText}>Failed to load execution detail.</div>
        </div>
      );
    }

    return (
      <div className={styles.historyDetail}>
        <button type="button" className={styles.backButton} onClick={handleBack}>
          <ChevronLeft size={16} />
          <span>Back to History</span>
        </button>

        {/* Summary */}
        <div className={styles.detailSummary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Status</span>
            <span
              className={styles.statusBadge}
              style={{
                color: EXECUTION_STATUS_COLORS[detailExec.status],
                background: `color-mix(in srgb, ${EXECUTION_STATUS_COLORS[detailExec.status]} 12%, transparent)`,
              }}
            >
              {getStatusIcon(detailExec.status)}
              {EXECUTION_STATUS_LABELS[detailExec.status] || detailExec.status}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Trigger</span>
            <span className={styles.summaryValue}>
              {TRIGGER_TYPE_LABELS[detailExec.triggerType] || detailExec.triggerType}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Started</span>
            <span className={styles.summaryValue}>{formatDateFull(detailExec.startedAt)}</span>
          </div>
          {detailExec.completedAt && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Completed</span>
              <span className={styles.summaryValue}>{formatDateFull(detailExec.completedAt)}</span>
            </div>
          )}
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Duration</span>
            <span className={styles.summaryValue}>{formatDuration(detailExec.durationMs)}</span>
          </div>

          <div className={styles.summaryCounters}>
            <div className={styles.counter}>
              <span className={styles.counterNumber}>{detailExec.containersMatched ?? 0}</span>
              <span className={styles.counterLabel}>Matched</span>
            </div>
            <div className={`${styles.counter} ${styles.counterSuccess}`}>
              <span className={styles.counterNumber}>{detailExec.containersUpgraded ?? 0}</span>
              <span className={styles.counterLabel}>Upgraded</span>
            </div>
            <div className={`${styles.counter} ${styles.counterFailed}`}>
              <span className={styles.counterNumber}>{detailExec.containersFailed ?? 0}</span>
              <span className={styles.counterLabel}>Failed</span>
            </div>
            <div className={`${styles.counter} ${styles.counterSkipped}`}>
              <span className={styles.counterNumber}>{detailExec.containersSkipped ?? 0}</span>
              <span className={styles.counterLabel}>Skipped</span>
            </div>
          </div>

          {detailExec.errorMessage && (
            <div className={styles.executionError}>
              <XCircle size={14} />
              {detailExec.errorMessage}
            </div>
          )}
        </div>

        {/* Container results */}
        <div className={styles.containerSection}>
          <h4 className={styles.containerSectionTitle}>
            <Container size={14} />
            Container Results ({detailContainers.length})
          </h4>
          {detailContainers.length === 0 ? (
            <div className={styles.emptySection}>No container results recorded.</div>
          ) : (
            <div className={styles.containerList}>
              {detailContainers.map((container) => (
                <div key={container.id} className={styles.containerCard}>
                  <div className={styles.containerCardHeader}>
                    <span
                      className={styles.previewStatus}
                      style={{ color: CONTAINER_STATUS_COLORS[container.status] }}
                    >
                      {getContainerStatusIcon(container.status)}
                      {CONTAINER_STATUS_LABELS[container.status] || container.status}
                    </span>
                    <span className={styles.containerCardName}>{container.containerName}</span>
                    {container.durationMs != null && (
                      <span className={styles.containerDuration}>
                        {formatDuration(container.durationMs)}
                      </span>
                    )}
                  </div>
                  <div className={styles.containerCardDetails}>
                    <div className={styles.containerDetail}>
                      <span className={styles.detailLabel}>Image:</span>
                      <span className={styles.detailValueCode}>{container.imageName || "-"}</span>
                    </div>
                    {container.oldImage &&
                      container.newImage &&
                      container.oldImage !== container.newImage && (
                        <div className={styles.containerDetail}>
                          <span className={styles.detailLabel}>Updated:</span>
                          <span className={styles.detailValueCode}>
                            {container.oldImage} &rarr; {container.newImage}
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

  // List view
  if (executions.length === 0) {
    return <EmptyState icon={HistoryIcon} message="No executions yet for this intent." />;
  }

  return (
    <div className={styles.historyContent}>
      <div className={styles.historyHeader}>
        <span className={styles.historyCount}>{executions.length} execution(s)</span>
      </div>
      <div className={styles.historyList}>
        {executions.map((exec) => (
          <button
            key={exec.id}
            type="button"
            className={styles.executionRow}
            onClick={() => handleViewDetail(exec.id)}
          >
            <div className={styles.execRowLeft}>
              <span
                className={styles.execStatusIcon}
                style={{ color: EXECUTION_STATUS_COLORS[exec.status] }}
              >
                {getStatusIcon(exec.status)}
              </span>
              <div className={styles.execRowInfo}>
                <span className={styles.execRowStatus}>
                  {EXECUTION_STATUS_LABELS[exec.status] || exec.status}
                </span>
                <span className={styles.execRowMeta}>
                  {TRIGGER_TYPE_LABELS[exec.triggerType] || exec.triggerType}
                  {" \u00B7 "}
                  {formatDate(exec.startedAt)}
                </span>
              </div>
            </div>
            <div className={styles.execRowRight}>
              <div className={styles.execRowCounts}>
                {exec.containersMatched > 0 && (
                  <span className={styles.countChip}>{exec.containersMatched} matched</span>
                )}
                {exec.containersUpgraded > 0 && (
                  <span className={`${styles.countChip} ${styles.countSuccess}`}>
                    {exec.containersUpgraded} upgraded
                  </span>
                )}
                {exec.containersFailed > 0 && (
                  <span className={`${styles.countChip} ${styles.countFailed}`}>
                    {exec.containersFailed} failed
                  </span>
                )}
              </div>
              <span className={styles.execDuration}>{formatDuration(exec.durationMs)}</span>
              <ChevronRight size={14} className={styles.chevron} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

HistoryTab.propTypes = {
  intent: PropTypes.object,
  executions: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  fetchExecutionDetail: PropTypes.func,
};

/* ==========================================
   Main Modal Component
   ========================================== */

function IntentDetailModal({
  intent,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  initialTab,
  portainerInstances,
}) {
  const [activeTab, setActiveTab] = useState(initialTab || TAB_CONFIG);
  const { fetchIntentPreview, fetchExecutions, fetchExecutionDetail } = useIntents();
  const [previewData, setPreviewData] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingExecutions, setLoadingExecutions] = useState(false);

  // Reset state when modal opens with a new intent
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || TAB_CONFIG);
      setPreviewData(null);
      setExecutions([]);
    }
  }, [isOpen, intent?.id, initialTab]);

  const loadPreview = useCallback(async () => {
    if (!intent?.id) return;
    setLoadingPreview(true);
    try {
      const data = await fetchIntentPreview(intent.id);
      setPreviewData(data);
    } catch (error) {
      console.error("Failed to load preview:", error);
    } finally {
      setLoadingPreview(false);
    }
  }, [intent?.id, fetchIntentPreview]);

  const loadExecutions = useCallback(async () => {
    if (!intent?.id) return;
    setLoadingExecutions(true);
    try {
      const result = await fetchExecutions(intent.id, 25);
      if (result.success) {
        setExecutions(result.executions);
      }
    } catch (error) {
      console.error("Failed to load executions:", error);
    } finally {
      setLoadingExecutions(false);
    }
  }, [intent?.id, fetchExecutions]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === TAB_MATCHES || activeTab === TAB_PREVIEW) {
      loadPreview();
    }
    if (activeTab === TAB_HISTORY) {
      loadExecutions();
    }
  }, [isOpen, activeTab, loadPreview, loadExecutions]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case TAB_CONFIG:
        return <ConfigTab intent={intent} portainerInstances={portainerInstances} />;
      case TAB_MATCHES:
        return <MatchesTab intent={intent} previewData={previewData} loading={loadingPreview} />;
      case TAB_PREVIEW:
        return <PreviewTab intent={intent} previewData={previewData} loading={loadingPreview} />;
      case TAB_HISTORY:
        return (
          <HistoryTab
            intent={intent}
            executions={executions}
            loading={loadingExecutions}
            fetchExecutionDetail={fetchExecutionDetail}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={intent?.name || "Intent Details"}
      size="lg"
      fullScreenMobile
    >
      <div className={styles.modalBody}>
        <div className={styles.tabsWrapper}>
          <Tabs options={TAB_OPTIONS} active={activeTab} onChange={handleTabChange} />
        </div>

        <div className={styles.tabContent}>{renderTabContent()}</div>

        <div className={styles.footer}>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => {
              onClose();
              if (onDelete) onDelete(intent.id, intent.name);
            }}
          >
            Delete
          </Button>
          <div className={styles.footerRight}>
            <button type="button" className={styles.editButton} onClick={() => onEdit(intent)}>
              <Pencil size={16} className={styles.editButtonIcon} />
              <span className={styles.editButtonText}>Edit Intent</span>
            </button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

IntentDetailModal.propTypes = {
  intent: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  initialTab: PropTypes.string,
  portainerInstances: PropTypes.array,
};

export default IntentDetailModal;
