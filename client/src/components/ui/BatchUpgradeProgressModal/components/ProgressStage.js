/**
 * Progress stage component
 */

import React from "react";
import PropTypes from "prop-types";
import { Loader2 } from "lucide-react";
import UpgradeProgressList from "./UpgradeProgressList";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Progress stage component
 * @param {Object} props
 * @param {Array} props.containers - Containers array
 * @param {Object} props.containerStates - Container states object
 * @param {Array} props.steps - Steps array
 * @param {number} props.completedCount - Number of completed containers
 * @param {number} props.totalCount - Total number of containers
 * @param {number} props.successCount - Number of successful containers
 * @param {number} props.errorCount - Number of failed containers
 */
const ProgressStage = ({
  containers,
  containerStates,
  steps,
  completedCount,
  totalCount,
  successCount,
  errorCount,
}) => {
  return (
    <div className={styles.progressStage}>
      <div className={styles.progressHeader}>
        <div className={styles.progressIconContainer}>
          <Loader2 size={32} className={styles.spinner} />
        </div>
        <div className={styles.progressInfo}>
          <h3 className={styles.title}>Upgrading Containers</h3>
          <p className={styles.progressText}>
            {completedCount} of {totalCount} completed
            {successCount > 0 && ` • ${successCount} successful`}
            {errorCount > 0 && ` • ${errorCount} failed`}
          </p>
        </div>
      </div>
      <UpgradeProgressList
        containers={containers}
        containerStates={containerStates}
        steps={steps}
      />
    </div>
  );
};

ProgressStage.propTypes = {
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  containerStates: PropTypes.object.isRequired,
  steps: PropTypes.array.isRequired,
  completedCount: PropTypes.number.isRequired,
  totalCount: PropTypes.number.isRequired,
  successCount: PropTypes.number.isRequired,
  errorCount: PropTypes.number.isRequired,
};

export default ProgressStage;
