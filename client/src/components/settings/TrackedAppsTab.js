import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./TrackedAppsTab.module.css";

/**
 * TrackedAppsTab Component
 * Manages tracked app data
 */
const TrackedAppsTab = React.memo(function TrackedAppsTab({
  onClearTrackedAppData,
  clearingTrackedAppData,
}) {
  const [trackedAppConfirm, setTrackedAppConfirm] = useState(false);

  const handleClearTrackedAppData = useCallback(async () => {
    if (!onClearTrackedAppData) {
      alert("Error: Clear Tracked App Data handler is not available. Please refresh the page.");
      return;
    }
    try {
      await onClearTrackedAppData();
      setTrackedAppConfirm(false);
    } catch (error) {
      console.error("Error clearing tracked app data:", error);
      alert("Error clearing tracked app data: " + (error.message || "Unknown error"));
    }
  }, [onClearTrackedAppData]);

  const handleConfirmOpen = useCallback(() => {
    setTrackedAppConfirm(true);
  }, []);

  const handleConfirmClose = useCallback(() => {
    setTrackedAppConfirm(false);
  }, []);

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Tracked Apps Settings</h3>
      <p className={styles.description}>Manage your tracked app data and configurations.</p>

      <div className={styles.dataManagement}>
        <h4 className={styles.sectionTitle}>Data Management</h4>
        <div className={styles.dataActions}>
          <div className={styles.dataActionItem}>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmOpen}
              disabled={clearingTrackedAppData}
              className={styles.dangerButton}
            >
              {clearingTrackedAppData ? "Clearing..." : "Clear Tracked App Data"}
            </Button>
            <small className={styles.dataActionHelper}>
              Clears the latest version data for all tracked apps. This will reset the {'"'}Latest
              {'"'}
              version information and force fresh data to be fetched on the next check. Your tracked
              app configurations will be preserved.
            </small>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={trackedAppConfirm}
        onClose={handleConfirmClose}
        onConfirm={handleClearTrackedAppData}
        title="Clear Tracked Application Data?"
        message="This will clear the latest version data for all tracked apps. This action cannot be undone."
        confirmText="Clear Data"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
});

TrackedAppsTab.propTypes = {
  onClearTrackedAppData: PropTypes.func,
  clearingTrackedAppData: PropTypes.bool,
};

export default TrackedAppsTab;
