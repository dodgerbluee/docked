import React, { useState } from "react";
import PropTypes from "prop-types";
import { Clock, PlayCircle, History as HistoryIcon } from "lucide-react";
import { useBatchLogs } from "../../hooks/useBatchLogs";
import ScheduledRunCard from "./ScheduledRunCard";
import LastRunTable from "./LastRunTable";
import RunCard from "./RunCard";
import LogViewer from "./LogViewer";
import Alert from "../ui/Alert";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import { BATCH_JOB_TYPES } from "../../constants/batch";
import styles from "./HistoryTab.module.css";

/**
 * HistoryTab Component
 * Displays batch run history and logs
 */
const HistoryTab = React.memo(function HistoryTab({
  onTriggerBatch,
  onTriggerTrackedAppsBatch,
}) {
  const [collapsedSections, setCollapsedSections] = useState(new Set());

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

  // Count enabled jobs for Next Scheduled Runs
  const enabledJobsCount = [
    batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled,
    batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled,
  ].filter(Boolean).length;

  // Count runs for Last Run section
  const lastRunCount = [
    latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL],
    latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK],
  ].filter(Boolean).length;

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
      {error && <Alert variant="error" className={styles.error}>{error}</Alert>}

      {/* Next Scheduled Runs */}
      <div className={styles.section}>
        <div
          className={styles.stackHeader}
          onClick={() => handleToggleSection('next-scheduled-runs')}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleSection('next-scheduled-runs');
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsedSections.has('next-scheduled-runs')}
          aria-label={`Next Scheduled Runs - ${collapsedSections.has('next-scheduled-runs') ? "Expand" : "Collapse"}`}
        >
          <div className={styles.stackHeaderLeft}>
            <button
              className={styles.stackToggle}
              aria-label={collapsedSections.has('next-scheduled-runs') ? "Expand section" : "Collapse section"}
              aria-hidden="true"
              tabIndex={-1}
            >
              {collapsedSections.has('next-scheduled-runs') ? "▶" : "▼"}
            </button>
            <Clock size={18} className={styles.stackIcon} />
            <h3 className={styles.stackName}>Next Scheduled Runs</h3>
          </div>
          {hasEnabledJobs && (
            <span className={styles.stackCount}>
              {enabledJobsCount} job{enabledJobsCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {!collapsedSections.has('next-scheduled-runs') && (
          <Card>
            {hasEnabledJobs ? (
              <div className={styles.scheduledRuns}>
                {batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled && (
                  <ScheduledRunCard
                    jobType={BATCH_JOB_TYPES.DOCKER_HUB_PULL}
                    config={batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
                    nextRunDate={nextScheduledRunDockerHub}
                    isTriggering={triggeringBatch}
                    onTrigger={handleTriggerBatch}
                  />
                )}
                {batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled && (
                  <ScheduledRunCard
                    jobType={BATCH_JOB_TYPES.TRACKED_APPS_CHECK}
                    config={batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
                    nextRunDate={nextScheduledRunTrackedApps}
                    isTriggering={triggeringTrackedAppsBatch}
                    onTrigger={handleTriggerTrackedAppsBatch}
                  />
                )}
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

      {/* Last Run Summary */}
      {lastRunCount > 0 && (
        <div className={styles.section}>
          <div
            className={styles.stackHeader}
            onClick={() => handleToggleSection('last-run')}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleToggleSection('last-run');
              }
            }}
            role="button"
            tabIndex={0}
            aria-expanded={!collapsedSections.has('last-run')}
            aria-label={`Last Run - ${collapsedSections.has('last-run') ? "Expand" : "Collapse"}`}
          >
            <div className={styles.stackHeaderLeft}>
              <button
                className={styles.stackToggle}
                aria-label={collapsedSections.has('last-run') ? "Expand section" : "Collapse section"}
                aria-hidden="true"
                tabIndex={-1}
              >
                {collapsedSections.has('last-run') ? "▶" : "▼"}
              </button>
              <PlayCircle size={18} className={styles.stackIcon} />
              <h3 className={styles.stackName}>Last Run</h3>
            </div>
            <span className={styles.stackCount}>
              {lastRunCount} run{lastRunCount !== 1 ? "s" : ""}
            </span>
          </div>
          {!collapsedSections.has('last-run') && (
            <LastRunTable latestRunsByJobType={latestRunsByJobType} />
          )}
        </div>
      )}

      {/* Run History and Logs */}
      <div className={styles.historyAndLogs}>
        {/* Run History Grid */}
        <div className={styles.runHistorySection}>
          <div className={styles.runHistoryHeader}>
            <HistoryIcon size={18} className={styles.runHistoryIcon} />
            <h4 className={styles.runHistoryTitle}>Run History</h4>
          </div>
          {recentRuns.length === 0 ? (
            <EmptyState
              message="No batch runs yet"
              icon={HistoryIcon}
              className={styles.emptyState}
            />
          ) : (
            <div className={styles.runHistoryGrid}>
              {recentRuns.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  isSelected={selectedRun?.id === run.id}
                  onClick={setSelectedRun}
                />
              ))}
            </div>
          )}
        </div>

        {/* Logs Display */}
        {selectedRun && (
          <div className={styles.logsSection}>
            <LogViewer selectedRun={selectedRun} />
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

