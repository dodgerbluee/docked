/**
 * Error stage component
 */

import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import Button from "../../Button";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Error stage component
 * @param {Object} props
 * @param {string} props.overallError - Overall error message
 * @param {Function} props.onNavigateToLogs - Navigate to logs handler
 * @param {Function} props.onClose - Close handler
 * @param {Function} props.onRetry - Retry handler
 */
const ErrorStage = ({ overallError, onNavigateToLogs, onClose, onRetry }) => {
  return (
    <div className={styles.errorStage}>
      <div className={styles.iconContainer}>
        <AlertCircle size={48} className={styles.errorIcon} />
      </div>
      <h3 className={styles.title}>Batch Upgrade Failed</h3>
      <p className={styles.message}>Failed to start batch upgrade</p>
      <div className={styles.errorMessage}>{overallError}</div>
      <div className={styles.actions}>
        {onNavigateToLogs && (
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
        )}
        <Button variant="outline" onClick={onClose} className={styles.cancelButton}>
          Close
        </Button>
        <Button variant="primary" onClick={onRetry} className={styles.retryButton}>
          Try Again
        </Button>
      </div>
    </div>
  );
};

ErrorStage.propTypes = {
  overallError: PropTypes.string.isRequired,
  onNavigateToLogs: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
};

export default ErrorStage;
