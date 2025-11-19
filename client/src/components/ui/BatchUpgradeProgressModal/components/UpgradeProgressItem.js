/**
 * Individual container progress item component
 */

import React from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Upgrade progress item component
 * @param {Object} props
 * @param {Object} props.container - Container object
 * @param {Object} props.containerState - Container state object
 * @param {Array} props.steps - Steps array
 */
const UpgradeProgressItem = ({ container, containerState, steps }) => {
  const isActive = containerState.status === "upgrading";
  const isCompleted = containerState.status === "success";
  const isError = containerState.status === "error";
  const isPending = containerState.status === "pending";

  return (
    <div
      className={`${styles.containerProgressItem} ${
        isActive ? styles.containerActive : ""
      } ${isCompleted ? styles.containerCompleted : ""} ${
        isError ? styles.containerError : ""
      } ${isPending ? styles.containerPending : ""}`}
    >
      <div className={styles.containerProgressHeader}>
        <div className={styles.containerStatusIcon}>
          {isCompleted ? (
            <CheckCircle2 size={20} className={styles.checkIcon} />
          ) : isError ? (
            <XCircle size={20} className={styles.errorIcon} />
          ) : isActive ? (
            <Loader2 size={20} className={styles.stepSpinner} />
          ) : (
            <div className={styles.stepDot} />
          )}
        </div>
        <span className={styles.containerName}>{container.name}</span>
      </div>
      {isActive && containerState.currentStep !== undefined && (
        <div className={styles.containerStep}>
          {steps[containerState.currentStep]?.label || "Processing..."}
        </div>
      )}
      {isError && containerState.error && (
        <div className={styles.containerErrorText}>{containerState.error}</div>
      )}
    </div>
  );
};

UpgradeProgressItem.propTypes = {
  container: PropTypes.object.isRequired,
  containerState: PropTypes.object.isRequired,
  steps: PropTypes.array.isRequired,
};

export default UpgradeProgressItem;
