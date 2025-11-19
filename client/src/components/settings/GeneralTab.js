import React, { useState } from "react";
import PropTypes from "prop-types";
import { Monitor, Sun, Moon, Info, Search, Power, PowerOff } from "lucide-react";
import { COLOR_SCHEMES, LOG_LEVELS } from "../../constants/settings";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
// Card is not currently used but kept for potential future use
import ToggleButton from "../ui/ToggleButton";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./GeneralTab.module.css";

/**
 * GeneralTab Component
 * Handles general settings like color scheme and log level
 */
const GeneralTab = React.memo(function GeneralTab({
  localColorScheme,
  setLocalColorScheme,
  localLogLevel,
  handleLogLevelChange,
  localRefreshingTogglesEnabled,
  handleRefreshingTogglesChange,
  generalSettingsChanged,
  generalSettingsSaving,
  generalSettingsSuccess,
  handleSaveGeneralSettings,
  onClearPortainerData,
  onClearTrackedAppData,
  clearingPortainerData,
  clearingTrackedAppData,
}) {
  const [portainerConfirm, setPortainerConfirm] = useState(false);
  const [trackedAppConfirm, setTrackedAppConfirm] = useState(false);

  const colorSchemeOptions = [
    { value: COLOR_SCHEMES.SYSTEM, label: "System", icon: Monitor },
    { value: COLOR_SCHEMES.LIGHT, label: "Light", icon: Sun },
    { value: COLOR_SCHEMES.DARK, label: "Dark", icon: Moon },
  ];

  const logLevelOptions = [
    { value: LOG_LEVELS.INFO, label: "Info", icon: Info },
    { value: LOG_LEVELS.DEBUG, label: "Debug", icon: Search },
  ];

  const refreshingTogglesOptions = [
    { value: "off", label: "Off", icon: PowerOff },
    { value: "on", label: "On", icon: Power },
  ];

  const handleClearPortainerData = async () => {
    if (!onClearPortainerData) {
      alert("Error: Clear Portainer Data handler is not available. Please refresh the page.");
      return;
    }
    try {
      await onClearPortainerData();
    } catch (error) {
      console.error("Error clearing Portainer data:", error);
      alert("Error clearing Portainer data: " + (error.message || "Unknown error"));
    }
  };

  const handleClearTrackedAppData = async () => {
    if (!onClearTrackedAppData) {
      alert("Error: Clear Tracked App Data handler is not available. Please refresh the page.");
      return;
    }
    try {
      await onClearTrackedAppData();
    } catch (error) {
      console.error("Error clearing tracked app data:", error);
      alert("Error clearing tracked app data: " + (error.message || "Unknown error"));
    }
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>General Settings</h3>
      {generalSettingsSuccess && <Alert variant={"info"}>{generalSettingsSuccess}</Alert>}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveGeneralSettings();
        }}
      >
        <div className={styles.formGroup}>
          <label htmlFor="colorScheme" className={styles.label}>
            Color Scheme Preference
          </label>
          <ToggleButton
            options={colorSchemeOptions}
            value={localColorScheme}
            onChange={setLocalColorScheme}
          />
          <small className={styles.helperText}>
            Choose how the application theme is determined. "System" will follow your browser or
            operating system preference.
          </small>
        </div>
        {/* When enabled, allows stopping, removing, repulling, starting, and verifying that the new container is up */}
        <div className={styles.formGroup}>
          <label htmlFor="refreshingToggles" className={styles.label}>
            Developer Mode
          </label>
          <ToggleButton
            options={refreshingTogglesOptions}
            value={localRefreshingTogglesEnabled === null ? "off" : localRefreshingTogglesEnabled ? "on" : "off"}
            onChange={handleRefreshingTogglesChange}
            className={styles.toggle}
          />
          <small className={styles.helperText}>Enables some testing features.</small>
        </div>
        <div className={styles.formActions}>
          <Button
            type="submit"
            variant="primary"
            disabled={!generalSettingsChanged || generalSettingsSaving}
            className={styles.saveButton}
          >
            {generalSettingsSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

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

GeneralTab.propTypes = {
  localColorScheme: PropTypes.string.isRequired,
  setLocalColorScheme: PropTypes.func.isRequired,
  localLogLevel: PropTypes.string.isRequired,
  handleLogLevelChange: PropTypes.func.isRequired,
  localRefreshingTogglesEnabled: PropTypes.bool.isRequired,
  handleRefreshingTogglesChange: PropTypes.func.isRequired,
  generalSettingsChanged: PropTypes.bool.isRequired,
  generalSettingsSaving: PropTypes.bool.isRequired,
  generalSettingsSuccess: PropTypes.string,
  handleSaveGeneralSettings: PropTypes.func.isRequired,
  onClearPortainerData: PropTypes.func,
  onClearTrackedAppData: PropTypes.func,
  clearingPortainerData: PropTypes.bool,
  clearingTrackedAppData: PropTypes.bool,
};

export default GeneralTab;
