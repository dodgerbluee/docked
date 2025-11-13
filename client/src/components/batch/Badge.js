import React from "react";
import PropTypes from "prop-types";
import {
  BATCH_JOB_TYPES,
  BATCH_JOB_TYPE_LABELS,
  BATCH_STATUS,
  BATCH_STATUS_LABELS,
} from "../../constants/batch";
import styles from "./Badge.module.css";

/**
 * JobTypeBadge Component
 * Displays a badge for the job type
 */
export const JobTypeBadge = React.memo(function JobTypeBadge({ jobType }) {
  const getJobTypeClass = (type) => {
    switch (type) {
      case BATCH_JOB_TYPES.DOCKER_HUB_PULL:
        return styles.jobTypeDockerHub;
      case BATCH_JOB_TYPES.TRACKED_APPS_CHECK:
        return styles.jobTypeTrackedApps;
      default:
        return styles.jobTypeUnknown;
    }
  };

  const jobTypeLabel =
    BATCH_JOB_TYPE_LABELS[jobType] || jobType || "Unknown Job";

  return (
    <span className={`${styles.badge} ${getJobTypeClass(jobType)}`}>
      {jobTypeLabel}
    </span>
  );
});

JobTypeBadge.propTypes = {
  jobType: PropTypes.string.isRequired,
};

/**
 * StatusBadge Component
 * Displays a badge for the run status
 */
export const StatusBadge = React.memo(function StatusBadge({ status }) {
  const getStatusClass = (statusType) => {
    switch (statusType) {
      case BATCH_STATUS.RUNNING:
        return styles.statusRunning;
      case BATCH_STATUS.COMPLETED:
        return styles.statusCompleted;
      case BATCH_STATUS.FAILED:
        return styles.statusFailed;
      default:
        return styles.statusRunning;
    }
  };

  const statusLabel =
    BATCH_STATUS_LABELS[status] || BATCH_STATUS_LABELS[BATCH_STATUS.RUNNING];

  return (
    <span className={`${styles.badge} ${getStatusClass(status)}`}>
      {statusLabel}
    </span>
  );
});

StatusBadge.propTypes = {
  status: PropTypes.string.isRequired,
};

/**
 * ManualBadge Component
 * Displays a badge indicating manual run
 */
export const ManualBadge = React.memo(function ManualBadge() {
  return (
    <span className={`${styles.badge} ${styles.manualBadge}`}>
      Manual
    </span>
  );
});

