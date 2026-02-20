/**
 * Success stage component
 */

import React from "react";
import PropTypes from "prop-types";
import { CheckCircle2, XCircle } from "lucide-react";
import Button from "../../Button";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Success stage component
 * @param {Object} props
 * @param {Array} props.containers - Containers array
 * @param {Object} props.containerStates - Container states object
 * @param {number} props.successCount - Number of successful containers
 * @param {number} props.errorCount - Number of failed containers
 * @param {Function} props.onNavigateToLogs - Navigate to logs handler
 */
const SuccessStage = ({
  containers,
  containerStates,
  successCount,
  errorCount,
  onNavigateToLogs,
}) => {
  return (
    <div className={styles.successStage}>
      <div className={styles.iconContainer}>
        <CheckCircle2 size={64} className={styles.successIcon} />
      </div>
      <h3 className={styles.title}>
        {errorCount === 0 ? "All Upgrades Complete!" : "Upgrades Completed with Errors"}
      </h3>
      <p className={styles.message}>
        {successCount > 0 && (
          <>
            <strong>{successCount}</strong> container{successCount !== 1 ? "s" : ""} upgraded
            successfully.
          </>
        )}
        {errorCount > 0 && (
          <>
            <br />
            <strong>{errorCount}</strong> container{errorCount !== 1 ? "s" : ""} failed to upgrade.
          </>
        )}
      </p>
      {errorCount > 0 && (
        <>
          <div className={styles.errorList}>
            {containers
              .filter((c) => containerStates[c.id]?.status === "error")
              .map((container) => (
                <div key={container.id} className={styles.errorItem}>
                  <XCircle size={16} className={styles.errorIconSmall} />
                  <span className={styles.errorItemName}>{container.name}</span>
                  <span className={styles.errorItemMessage}>
                    {containerStates[container.id]?.error || "Unknown error"}
                  </span>
                </div>
              ))}
          </div>
          {onNavigateToLogs && (
            <div className={styles.actions}>
              <Button
                variant="outline"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigateToLogs();
                }}
                className={styles.viewLogsButton}
              >
                View Logs
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

SuccessStage.propTypes = {
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  containerStates: PropTypes.object.isRequired,
  successCount: PropTypes.number.isRequired,
  errorCount: PropTypes.number.isRequired,
  onNavigateToLogs: PropTypes.func,
};

export default SuccessStage;
