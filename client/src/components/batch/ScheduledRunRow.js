import React from "react";
import PropTypes from "prop-types";
import { RefreshCw } from "lucide-react";
import { JobTypeBadge } from "./Badge";
import Button from "../ui/Button";
import { formatNextRun, formatInterval, formatDate } from "../../utils/batchFormatters";
import styles from "./ScheduledRunRow.module.css";

/**
 * ScheduledRunRow Component
 * Displays a scheduled run as a table row
 */
const ScheduledRunRow = React.memo(function ScheduledRunRow({
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
    <tr className={styles.tableRow}>
      <td className={styles.tableCell}>
        <JobTypeBadge jobType={jobType} />
      </td>
      <td className={styles.tableCell}>
        <span className={styles.nextRun}>
          {formatNextRun(nextRunDate)}
        </span>
      </td>
      <td className={styles.tableCell}>
        {lastRun ? (
          <span className={styles.lastRun}>
            {formatDate(lastRun.completed_at || lastRun.started_at)}
          </span>
        ) : (
          <span className={styles.noData}>N/A</span>
        )}
      </td>
      <td className={styles.tableCell}>
        <span className={styles.interval}>
          {formatInterval(config?.intervalMinutes)}
        </span>
      </td>
      <td className={styles.tableCell}>
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
      </td>
    </tr>
  );
});

ScheduledRunRow.propTypes = {
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

export default ScheduledRunRow;

