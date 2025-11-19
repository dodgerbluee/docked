/**
 * Portainer status alerts component
 */

import React from "react";
import PropTypes from "prop-types";
import Alert from "../../../components/ui/Alert";
import styles from "../../PortainerPage.module.css";

/**
 * Portainer status alerts component
 * @param {Object} props
 * @param {boolean} props.pullingDockerHub - Whether pulling from Docker Hub
 * @param {boolean} props.pullingPortainerOnly - Whether pulling Portainer data only
 * @param {string} props.localPullError - Local pull error message
 * @param {Function} props.onDismissError - Error dismiss handler
 */
const PortainerStatusAlerts = ({
  pullingDockerHub,
  pullingPortainerOnly,
  localPullError,
  onDismissError,
}) => {
  if (!pullingDockerHub && !pullingPortainerOnly && !localPullError) {
    return null;
  }

  return (
    <div className={styles.alertContainer}>
      {pullingDockerHub && (
        <Alert variant="info" className={styles.alert}>
          <div className={styles.pullStatusContent}>
            <div className={styles.pullSpinner}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
            <div className={styles.pullStatusText}>
              <strong>Pulling fresh data from Docker Hub...</strong>
              <span>This may take a few moments</span>
            </div>
          </div>
        </Alert>
      )}
      {pullingPortainerOnly && (
        <Alert variant="info" className={styles.alert}>
          <div className={styles.pullStatusContent}>
            <div className={styles.pullSpinner}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
            <div className={styles.pullStatusText}>
              <strong>Updating Portainer data...</strong>
              <span>Fetching container information from Portainer</span>
            </div>
          </div>
        </Alert>
      )}
      {!pullingDockerHub && !pullingPortainerOnly && localPullError && (
        <Alert variant="error" className={styles.alert}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <span>{localPullError}</span>
            <button
              onClick={onDismissError}
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: "18px",
                padding: "0 8px",
                marginLeft: "12px",
              }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </Alert>
      )}
    </div>
  );
};

PortainerStatusAlerts.propTypes = {
  pullingDockerHub: PropTypes.bool.isRequired,
  pullingPortainerOnly: PropTypes.bool.isRequired,
  localPullError: PropTypes.string.isRequired,
  onDismissError: PropTypes.func.isRequired,
};

export default PortainerStatusAlerts;

