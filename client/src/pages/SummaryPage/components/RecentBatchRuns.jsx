import React from "react";
import PropTypes from "prop-types";
import { Play, CheckCircle, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./RecentBatchRuns.module.css";

/**
 * Recent batch runs display component
 */
const RecentBatchRuns = ({ recentRuns, latestRunsByJobType }) => {
  const displayRuns = recentRuns; // Show all runs, CSS will handle visible height with scroll

  const getStatusIcon = (status) => {
    switch (status) {
      case "completed":
        return CheckCircle;
      case "failed":
        return XCircle;
      case "running":
        return Play;
      default:
        return Clock;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "success";
      case "failed":
        return "error";
      case "running":
        return "running";
      default:
        return "default";
    }
  };

  return (
    <div className={styles.recentRuns}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Play size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Recent Batch Runs</h3>
        </div>
      </div>

      <div className={styles.content}>
        {displayRuns.length === 0 ? (
          <div className={styles.emptyState}>
            <Clock size={32} className={styles.emptyIcon} />
            <p className={styles.emptyText}>No batch runs yet</p>
          </div>
        ) : (
          <div className={styles.runsList}>
            {displayRuns.map((run) => {
              const StatusIcon = getStatusIcon(run.status);
              const statusColor = getStatusColor(run.status);

              // Safely handle timestamp
              const startTime = run.start_time ? new Date(run.start_time) : null;
              const timeDisplay =
                startTime && !isNaN(startTime.getTime())
                  ? formatDistanceToNow(startTime, { addSuffix: true })
                  : "Recently";

              return (
                <div key={run.id} className={styles.runItem}>
                  <div className={`${styles.statusIcon} ${styles[statusColor]}`}>
                    <StatusIcon size={16} />
                  </div>
                  <div className={styles.runContent}>
                    <div className={styles.runHeader}>
                      <span className={styles.runType}>
                        {run.job_type === "docker-hub-pull" ? "Container Check" : "Apps Check"}
                      </span>
                      <span className={styles.runTime}>{timeDisplay}</span>
                    </div>
                    <div className={styles.runStats}>
                      {run.containers_checked > 0 && (
                        <span className={styles.statBadge}>{run.containers_checked} checked</span>
                      )}
                      {run.containers_updated > 0 && (
                        <span className={`${styles.statBadge} ${styles.updated}`}>
                          {run.containers_updated} updated
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

RecentBatchRuns.propTypes = {
  recentRuns: PropTypes.array,
  latestRunsByJobType: PropTypes.object,
};

RecentBatchRuns.defaultProps = {
  recentRuns: [],
  latestRunsByJobType: {},
};

export default RecentBatchRuns;
