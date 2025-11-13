import React from "react";
import PropTypes from "prop-types";
import { useBatchLogs } from "../../hooks/useBatchLogs";
import ScheduledRunCard from "./ScheduledRunCard";
import LastRunTable from "./LastRunTable";
import RunCard from "./RunCard";
import LogViewer from "./LogViewer";
import Alert from "../ui/Alert";
import Card from "../ui/Card";
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

  if (loading) {
    return (
      <div className={styles.loading}>
        <p>Loading batch logs...</p>
      </div>
    );
  }

  return (
    <div className={styles.historyTab}>
      {error && <Alert variant="error" className={styles.error}>{error}</Alert>}

      {/* Next Scheduled Runs */}
      <Card className={styles.section}>
        <h3 className={styles.sectionTitle}>Next Scheduled Runs</h3>
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
          <div className={styles.emptyState}>
            No batch jobs are currently scheduled. Enable batch processing in
            Settings to schedule automatic runs.
          </div>
        )}
      </Card>

      {/* Last Run Summary */}
      <LastRunTable latestRunsByJobType={latestRunsByJobType} />

      {/* Run History and Logs */}
      <div className={styles.historyAndLogs}>
        {/* Run History List */}
        <Card className={styles.runHistory}>
          <div className={styles.runHistoryHeader}>
            <h4 className={styles.runHistoryTitle}>Run History</h4>
          </div>
          <div className={styles.runHistoryList}>
            {recentRuns.length === 0 ? (
              <div className={styles.emptyState}>No batch runs yet</div>
            ) : (
              recentRuns.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  isSelected={selectedRun?.id === run.id}
                  onClick={setSelectedRun}
                />
              ))
            )}
          </div>
        </Card>

        {/* Logs Display */}
        <LogViewer selectedRun={selectedRun} />
      </div>
    </div>
  );
});

HistoryTab.propTypes = {
  onTriggerBatch: PropTypes.func,
  onTriggerTrackedAppsBatch: PropTypes.func,
};

export default HistoryTab;

