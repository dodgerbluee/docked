/**
 * Confirmation stage component
 */

import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import Button from "../../Button";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Confirmation stage component
 * @param {Object} props
 * @param {number} props.totalCount - Total number of containers
 * @param {Array} props.containers - Containers array
 * @param {Function} props.onConfirm - Confirm handler
 * @param {Function} props.onCancel - Cancel handler
 */
const ConfirmStage = ({ totalCount, containers, onConfirm, onCancel }) => {
  return (
    <div className={styles.confirmStage}>
      <div className={styles.iconContainer}>
        <AlertCircle size={48} className={styles.warningIcon} />
      </div>
      <h3 className={styles.title}>
        Upgrade {totalCount} Container{totalCount !== 1 ? "s" : ""}?
      </h3>
      <p className={styles.message}>
        Are you sure you want to upgrade{" "}
        <strong>
          {totalCount} selected container{totalCount !== 1 ? "s" : ""}
        </strong>
        ?
      </p>
      <p className={styles.warning}>
        Each container will be stopped, removed, and recreated with the latest image. This may cause
        brief service interruptions. Containers will be upgraded concurrently.
      </p>
      <div className={styles.containerList}>
        <div className={styles.containerGrid}>
          {containers.slice(0, 8).map((container) => (
            <div key={container.id} className={styles.containerBadge}>
              <span className={styles.containerBadgeName}>{container.name}</span>
            </div>
          ))}
        </div>
        {containers.length > 8 && (
          <div className={styles.containerMore}>
            +{containers.length - 8} more container{containers.length - 8 !== 1 ? "s" : ""}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="outline" onClick={onCancel} className={styles.cancelButton}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} className={styles.confirmButton}>
          Yes, Upgrade All
        </Button>
      </div>
    </div>
  );
};

ConfirmStage.propTypes = {
  totalCount: PropTypes.number.isRequired,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default ConfirmStage;
