import React from "react";
import PropTypes from "prop-types";
import { RefreshCw } from "lucide-react";
import { JobTypeBadge } from "./Badge";
import Button from "../ui/Button";
import { formatNextRun, formatInterval, formatDate } from "../../utils/batchFormatters";
// BATCH_JOB_TYPES is not currently used but kept for potential future use
import styles from "./ScheduledRunCard.module.css";

/**
 * ScheduledRunCard Component
 * Displays a scheduled run with trigger button, next run, and last run times
 */
const ScheduledRunCard = React.memo(function ScheduledRunCard({
  jobType,
  config,
  nextRunDate,
  lastRun,
  isTriggering,
  onTrigger,
}) {
  const handleTrigger = async () => {
    if (onTrigger && !isTriggering) {
      await onTrigger();
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.badgeContainer}>
        <JobTypeBadge jobType={jobType} />
      </div>
      <div className={styles.content}>
        <div className={styles.info}>
          <div className={styles.runInfoRow}>
            <span className={styles.runLabel}>Next Run:</span>
            <span className={styles.nextRun}>
              {formatNextRun(nextRunDate)}
            </span>
          </div>
          {lastRun && (
            <div className={styles.runInfoRow}>
              <span className={styles.runLabel}>Last Run:</span>
              <span className={styles.lastRun}>
                {formatDate(lastRun.completed_at || lastRun.started_at)}
              </span>
            </div>
          )}
          <span className={styles.interval}>
            (Interval: {formatInterval(config?.intervalMinutes)})
          </span>
        </div>
        <Button
          onClick={handleTrigger}
          disabled={isTriggering}
          variant="outline"
          size="sm"
          icon={RefreshCw}
          iconPosition="left"
        >
          {isTriggering ? "Running..." : "Run Now"}
        </Button>
      </div>
    </div>
  );
});

ScheduledRunCard.propTypes = {
  jobType: PropTypes.string.isRequired,
  config: PropTypes.shape({
    enabled: PropTypes.bool,
    intervalMinutes: PropTypes.number,
  }),
  nextRunDate: PropTypes.instanceOf(Date),
  lastRun: PropTypes.shape({
    started_at: PropTypes.string,
    completed_at: PropTypes.string,
  }),
  isTriggering: PropTypes.bool,
  onTrigger: PropTypes.func,
};

export default ScheduledRunCard;

