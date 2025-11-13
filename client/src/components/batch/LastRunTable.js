import React from "react";
import PropTypes from "prop-types";
import { JobTypeBadge, StatusBadge } from "./Badge";
import { formatDate, formatDuration } from "../../utils/batchFormatters";
import { BATCH_JOB_TYPES } from "../../constants/batch";
import Alert from "../ui/Alert";
import Card from "../ui/Card";
import styles from "./LastRunTable.module.css";

/**
 * LastRunTable Component
 * Displays a table of the last run for each job type
 */
const LastRunTable = React.memo(function LastRunTable({ latestRunsByJobType }) {
  const hasRuns =
    latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL] ||
    latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK];

  if (!hasRuns) {
    return null;
  }

  return (
    <Card className={styles.container}>
      <h3 className={styles.title}>Last Run</h3>
      <div className={styles.table}>
        {/* Table Header */}
        <div className={styles.tableHeader}>
          <div className={styles.headerCell}>Job Type</div>
          <div className={styles.headerCell}>Status</div>
          <div className={styles.headerCell}>Start Time</div>
          <div className={styles.headerCell}>Completed Time</div>
          <div className={styles.headerCell}>Duration</div>
          <div className={styles.headerCell}>Details</div>
        </div>

        {/* Table Rows */}
        {latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL] && (
          <LastRunRow
            run={latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
            jobType={BATCH_JOB_TYPES.DOCKER_HUB_PULL}
            isContainer={true}
          />
        )}
        {latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK] && (
          <LastRunRow
            run={latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
            jobType={BATCH_JOB_TYPES.TRACKED_APPS_CHECK}
            isContainer={false}
          />
        )}
      </div>

      {/* Error messages */}
      {latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.error_message && (
        <Alert variant="error" className={styles.error}>
          <strong>Docker Hub Scan Error:</strong>{" "}
          {latestRunsByJobType[BATCH_JOB_TYPES.DOCKER_HUB_PULL].error_message}
        </Alert>
      )}
      {latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.error_message && (
        <Alert variant="error" className={styles.error}>
          <strong>Tracked Apps Scan Error:</strong>{" "}
          {
            latestRunsByJobType[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]
              .error_message
          }
        </Alert>
      )}
    </Card>
  );
});

/**
 * LastRunRow Component
 * Individual row in the last run table
 */
const LastRunRow = React.memo(function LastRunRow({ run, jobType, isContainer }) {
  return (
    <div className={styles.tableRow}>
      <div className={styles.tableCell}>
        <JobTypeBadge jobType={jobType} />
      </div>
      <div className={styles.tableCell}>
        <StatusBadge status={run.status} />
      </div>
      <div className={styles.tableCell}>{formatDate(run.started_at)}</div>
      <div className={styles.tableCell}>
        {run.completed_at ? formatDate(run.completed_at) : "N/A"}
      </div>
      <div className={styles.tableCell}>
        {run.duration_ms ? formatDuration(run.duration_ms) : "N/A"}
      </div>
      <div className={styles.tableCell}>
        <div className={styles.detailItem}>
          {run.containers_checked || 0} {isContainer ? "containers" : "apps"}{" "}
          checked
        </div>
        <div className={styles.detailItem}>
          {run.containers_updated || 0} updates found
        </div>
      </div>
    </div>
  );
});

LastRunRow.propTypes = {
  run: PropTypes.object.isRequired,
  jobType: PropTypes.string.isRequired,
  isContainer: PropTypes.bool.isRequired,
};

LastRunTable.propTypes = {
  latestRunsByJobType: PropTypes.object.isRequired,
};

export default LastRunTable;

