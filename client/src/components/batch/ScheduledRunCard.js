import React from "react";
import PropTypes from "prop-types";
import { RefreshCw } from "lucide-react";
import { JobTypeBadge } from "./Badge";
import Button from "../ui/Button";
import { formatNextRun, formatInterval } from "../../utils/batchFormatters";
import { BATCH_JOB_TYPES } from "../../constants/batch";
import styles from "./ScheduledRunCard.module.css";

/**
 * ScheduledRunCard Component
 * Displays a scheduled run with trigger button
 */
const ScheduledRunCard = React.memo(function ScheduledRunCard({
  jobType,
  config,
  nextRunDate,
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
          <span className={styles.nextRun}>
            {formatNextRun(nextRunDate)}
          </span>
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
  isTriggering: PropTypes.bool,
  onTrigger: PropTypes.func,
};

export default ScheduledRunCard;

