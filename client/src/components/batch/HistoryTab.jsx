import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { Clock, History as HistoryIcon, ChevronDown } from "lucide-react";
import { useBatchLogs } from "../../hooks/useBatchLogs";
import ScheduledRunRow from "./ScheduledRunRow";
import RunCard from "./RunCard";
import LogViewer from "./LogViewer";
import Alert from "../ui/Alert";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import Button from "../ui/Button";
import { BATCH_JOB_TYPES } from "../../constants/batch";
import styles from "./HistoryTab.module.css";

/**
 * HistoryTab Component
 * Displays batch run history and logs
 */
const HistoryTab = React.memo(function HistoryTab({ onTriggerBatch, onTriggerTrackedAppsBatch }) {
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [displayCount, setDisplayCount] = useState(8);

  const {
    latestRunsByJobType,
    recentRuns,
    selectedRun,
    setSelectedRun,
    loading,
    error,
    triggeringBatch,
    triggeringTrackedAppsBatch,
    nextScheduledRunDockerHub,
    nextScheduledRunTrackedApps,
    hasEnabledJobs,
    batchConfigs,
    handleTriggerBatch,
    handleTriggerTrackedAppsBatch,
  } = useBatchLogs(onTriggerBatch, onTriggerTrackedAppsBatch);

  // Removed scroll listener - no longer needed with grid layout

  const handleToggleSection = (sectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  // Count enabled jobs for Batch Jobs
  const enabledJobsCount = [
    batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled,
    batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled,
  ].filter(Boolean).length;

  // Pagination for run history
  const displayedRuns = useMemo(() => {
    return recentRuns.slice(0, displayCount);
  }, [recentRuns, displayCount]);

  const hasMoreRuns = recentRuns.length > displayCount;
  const canShowMore = displayCount < recentRuns.length;

  const handleShowMore = () => {
    setDisplayCount(displayCount + 8);
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className={styles.historyTab}>
      {error && (
        <Alert variant="error" className={styles.error}>
          {error}
        </Alert>
      )}

      {/* Batch Jobs */}
      <div className={styles.section}>
        <div
          className={styles.stackHeader}
          onClick={(e) => {
            // Focus header to prevent hiding a focused descendant via aria-hidden
            try {
              e.currentTarget?.focus();
            } catch {
              // Intentionally ignore focus errors (some browsers may throw when focusing)
            }
            handleToggleSection("next-scheduled-runs");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleSection("next-scheduled-runs");
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsedSections.has("next-scheduled-runs")}
          aria-label={`Batch Jobs - ${collapsedSections.has("next-scheduled-runs") ? "Expand" : "Collapse"}`}
        >
          <div className={styles.stackHeaderLeft}>
            <button
              className={styles.stackToggle}
              aria-label={
                collapsedSections.has("next-scheduled-runs") ? "Expand section" : "Collapse section"
              }
              aria-hidden="true"
              tabIndex={-1}
            >
              {collapsedSections.has("next-scheduled-runs") ? "▶" : "▼"}
            </button>
            <Clock size={18} className={styles.stackIcon} />
            <h3 className={styles.stackName}>Batch Jobs</h3>
          </div>
          {hasEnabledJobs && (
            <span className={styles.stackCount}>
              {enabledJobsCount} job{enabledJobsCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {!collapsedSections.has("next-scheduled-runs") && (
          <Card>
            {hasEnabledJobs ? (
              <div className={styles.scheduledRunsTable}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.tableHeader}>Job Type</th>
                      <th className={styles.tableHeader}>Next Run</th>
                      <th className={styles.tableHeader}>Last Run</th>
                      <th className={styles.tableHeader}>Interval</th>
                      <th className={styles.tableHeader}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled && (
                      <ScheduledRunRow
                        jobType={BATCH_JOB_TYPES.DOCKER_HUB_PULL}
                        config={batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
                        nextRunDate={nextScheduledRunDockerHub}
                        lastRun={latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
                        isTriggering={triggeringBatch}
                        onTrigger={handleTriggerBatch}
                      />
                    )}
                    {batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled && (
                      <ScheduledRunRow
                        jobType={BATCH_JOB_TYPES.TRACKED_APPS_CHECK}
                        config={batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
                        nextRunDate={nextScheduledRunTrackedApps}
                        lastRun={latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
                        isTriggering={triggeringTrackedAppsBatch}
                        onTrigger={handleTriggerTrackedAppsBatch}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                message="No batch jobs are currently scheduled. Enable batch processing in Settings to schedule automatic runs."
                icon={Clock}
                className={styles.emptyState}
              />
            )}
          </Card>
        )}
      </div>

      {/* Unified Run History and Logs */}
      <div className={styles.section}>
        <div
          className={styles.stackHeader}
          onClick={(e) => {
            try {
              e.currentTarget?.focus();
            } catch {
              // Intentionally ignore focus errors
            }
            handleToggleSection("run-history");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleSection("run-history");
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsedSections.has("run-history")}
          aria-label={`Run History - ${collapsedSections.has("run-history") ? "Expand" : "Collapse"}`}
        >
          <div className={styles.stackHeaderLeft}>
            <button
              className={styles.stackToggle}
              aria-label={
                collapsedSections.has("run-history") ? "Expand section" : "Collapse section"
              }
              aria-hidden="true"
              tabIndex={-1}
            >
              {collapsedSections.has("run-history") ? "▶" : "▼"}
            </button>
            <HistoryIcon size={18} className={styles.stackIcon} />
            <h3 className={styles.stackName}>Run History</h3>
          </div>
          <span className={styles.stackCount}>
            {recentRuns.length} run{recentRuns.length !== 1 ? "s" : ""}
          </span>
        </div>
        {!collapsedSections.has("run-history") && (
          <div className={styles.historyAndLogs}>
            {/* Logs Display - Top, takes 2 card widths */}
            <div className={styles.logsSection}>
              <LogViewer selectedRun={selectedRun} />
            </div>

            {/* Run History Grid - Below logs, 4 cards per row */}
            <div className={styles.runHistorySection}>
              <div className={styles.runHistoryHeader}>
                <HistoryIcon size={18} className={styles.runHistoryIcon} />
                <h4 className={styles.runHistoryTitle}>All Runs</h4>
              </div>
              {recentRuns.length === 0 ? (
                <EmptyState
                  message="No batch runs yet"
                  icon={HistoryIcon}
                  className={styles.emptyState}
                />
              ) : (
                <>
                  <div className={styles.runHistoryGrid}>
                    {displayedRuns.map((run) => (
                      <RunCard
                        key={run.id}
                        run={run}
                        isSelected={selectedRun?.id === run.id}
                        onClick={setSelectedRun}
                      />
                    ))}
                  </div>
                  {hasMoreRuns && canShowMore && (
                    <div className={styles.showMoreContainer}>
                      <Button
                        variant="outline"
                        onClick={handleShowMore}
                        icon={ChevronDown}
                        iconPosition="right"
                        className={styles.showMoreButton}
                      >
                        Show More ({displayCount} of {recentRuns.length})
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

HistoryTab.propTypes = {
  onTriggerBatch: PropTypes.func,
  onTriggerTrackedAppsBatch: PropTypes.func,
};

export default HistoryTab;
