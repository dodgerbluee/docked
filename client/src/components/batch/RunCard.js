import React, { useState } from "react";
import PropTypes from "prop-types";
import { CheckCircle2, XCircle } from "lucide-react";
import { JobTypeBadge, ManualBadge } from "./Badge";
import { formatDate, formatDuration } from "../../utils/batchFormatters";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import styles from "./RunCard.module.css";

/**
 * RunCard Component
 * Displays a single batch run in the history list with all details
 */
const RunCard = React.memo(function RunCard({ run, isSelected, onClick }) {
  const [showErrorModal, setShowErrorModal] = useState(false);

  const handleClick = (e) => {
    // Don't trigger card selection if clicking the error icon
    if (e.target.closest(`.${styles.errorIconContainer}`)) {
      return;
    }
    if (onClick) {
      onClick(run);
    }
  };

  const handleErrorIconClick = (e) => {
    e.stopPropagation();
    if (run.error_message) {
      setShowErrorModal(true);
    }
  };

  const isContainer = run.job_type === "docker-hub-pull";
  const hasDetails = run.containers_checked !== null;

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
          {run.status === "completed" && <CheckCircle2 size={18} className={styles.successIcon} />}
          {run.status === "failed" && (
            <div
              className={styles.errorIconContainer}
              onClick={handleErrorIconClick}
              title={run.error_message || "Failed"}
            >
              <XCircle size={18} className={styles.errorIcon} />
            </div>
          )}
          {Number(run.is_manual) === 1 && <ManualBadge />}
        </div>
      </div>

      <div className={styles.timestamps}>
        <div className={styles.timestampRow}>
          <span className={styles.timestampLabel}>Started:</span>
          <span className={styles.timestampValue}>{formatDate(run.started_at)}</span>
        </div>
        {run.completed_at && (
          <div className={styles.timestampRow}>
            <span className={styles.timestampLabel}>Completed:</span>
            <span className={styles.timestampValue}>{formatDate(run.completed_at)}</span>
          </div>
        )}
        {run.duration_ms && (
          <div className={styles.timestampRow}>
            <span className={styles.timestampLabel}>Duration:</span>
            <span className={styles.timestampValue}>{formatDuration(run.duration_ms)}</span>
          </div>
        )}
      </div>

      {hasDetails && (
        <div className={styles.stats}>
          <div className={styles.statItem}>
            {run.containers_checked || 0} {isContainer ? "containers" : "apps"} checked •{" "}
            {run.containers_updated || 0} updates found
          </div>
        </div>
      )}

      {/* Error Modal */}
      {run.error_message && (
        <Modal
          isOpen={showErrorModal}
          onClose={() => setShowErrorModal(false)}
          title="Run Failed"
          size="md"
          showCloseButton={true}
          className={`${styles.errorModal} error-modal-red`}
        >
          <div className={styles.errorModalContent}>
            <div className={styles.errorModalMessage}>
              {run.error_message.split("\n").map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  {i < run.error_message.split("\n").length - 1 && <br />}
                </React.Fragment>
              ))}
            </div>
            <div className={styles.errorModalActions}>
              <Button variant="primary" onClick={() => setShowErrorModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
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
    completed_at: PropTypes.string,
    duration_ms: PropTypes.number,
    is_manual: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
    containers_checked: PropTypes.number,
    containers_updated: PropTypes.number,
    error_message: PropTypes.string,
  }).isRequired,
  isSelected: PropTypes.bool,
  onClick: PropTypes.func,
};

export default RunCard;
