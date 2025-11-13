import React from "react";
import PropTypes from "prop-types";
import { JobTypeBadge, StatusBadge, ManualBadge } from "./Badge";
import { formatDate } from "../../utils/batchFormatters";
import styles from "./RunCard.module.css";

/**
 * RunCard Component
 * Displays a single batch run in the history list
 */
const RunCard = React.memo(function RunCard({ run, isSelected, onClick }) {
  const handleClick = () => {
    if (onClick) {
      onClick(run);
    }
  };

  return (
    <div
      className={`${styles.runCard} ${isSelected ? styles.selected : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className={styles.header}>
        <span className={styles.runId}>Run #{run.id}</span>
        <div className={styles.badges}>
          <JobTypeBadge jobType={run.job_type} />
          <StatusBadge status={run.status} />
          {Number(run.is_manual) === 1 && <ManualBadge />}
        </div>
      </div>
      <div className={styles.date}>{formatDate(run.started_at)}</div>
      {run.containers_checked !== null && (
        <div className={styles.stats}>
          {run.job_type === "tracked-apps-check"
            ? `${run.containers_checked} apps, ${run.containers_updated || 0} updates`
            : `${run.containers_checked} containers, ${run.containers_updated || 0} updates`}
        </div>
      )}
    </div>
  );
});

RunCard.propTypes = {
  run: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    job_type: PropTypes.string.isRequired,
    status: PropTypes.string.isRequired,
    started_at: PropTypes.string,
    is_manual: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
    containers_checked: PropTypes.number,
    containers_updated: PropTypes.number,
  }).isRequired,
  isSelected: PropTypes.bool,
  onClick: PropTypes.func,
};

export default RunCard;

