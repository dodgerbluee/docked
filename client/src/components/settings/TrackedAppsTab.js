import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import Card from "../ui/Card";
import { usePageVisibilitySettings } from "../../hooks/usePageVisibilitySettings";
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

  const {
    disableTrackedAppsPage: initialDisableTrackedAppsPage,
    updateDisableTrackedAppsPage,
    refreshSettings,
  } = usePageVisibilitySettings();

  const [localDisableTrackedAppsPage, setLocalDisableTrackedAppsPage] = useState(
    initialDisableTrackedAppsPage
  );
  const [saving, setSaving] = useState(false);

  // Update local state when initial value changes
  useEffect(() => {
    setLocalDisableTrackedAppsPage(initialDisableTrackedAppsPage);
  }, [initialDisableTrackedAppsPage]);

  const handleDisableTrackedAppsPageChange = (e) => {
    setLocalDisableTrackedAppsPage(e.target.checked);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await updateDisableTrackedAppsPage(localDisableTrackedAppsPage);
      if (success) {
        // Refresh settings to ensure sync
        await refreshSettings();
        // Dispatch custom event to notify HomePage to refresh
        window.dispatchEvent(new CustomEvent("pageVisibilitySettingsUpdated"));
      }
    } catch (error) {
      console.error("Error saving page visibility settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleClearTrackedAppData = async () => {
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
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Tracked Apps Settings</h3>
      <p className={styles.description}>Manage your tracked app data and configurations.</p>

      <div className={styles.pageVisibilitySection}>
        <Card variant="default" padding="md" className={styles.visibilityCard}>
          <div className={styles.checkboxContainer}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={localDisableTrackedAppsPage}
                onChange={handleDisableTrackedAppsPageChange}
                className={styles.checkbox}
              />
              <span className={styles.checkboxText}>Disable Tracked Apps Page</span>
            </label>
            <p className={styles.checkboxNote}>
              This will disable the functionality of the Tracked Apps page. The Tracked Apps tab
              will be hidden from the home page navigation.
            </p>
          </div>
          <div className={styles.formActions}>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={saving || localDisableTrackedAppsPage === initialDisableTrackedAppsPage}
              className={styles.saveButton}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </Card>
      </div>

      <div className={styles.dataManagement}>
        <h4 className={styles.sectionTitle}>Data Management</h4>
        <div className={styles.dataActions}>
          <div className={styles.dataActionItem}>
            <Button
              type="button"
              variant="danger"
              onClick={() => setTrackedAppConfirm(true)}
              disabled={clearingTrackedAppData}
              className={styles.dangerButton}
            >
              {clearingTrackedAppData ? "Clearing..." : "Clear Tracked App Data"}
            </Button>
            <small className={styles.dataActionHelper}>
              Clears the latest version data for all tracked apps. This will reset the "Latest"
              version information and force fresh data to be fetched on the next check. Your tracked
              app configurations will be preserved.
            </small>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={trackedAppConfirm}
        onClose={() => setTrackedAppConfirm(false)}
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
