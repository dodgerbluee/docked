import React from "react";
import PropTypes from "prop-types";
import { Info, Search } from "lucide-react";
import { LOG_LEVELS } from "../../constants/settings";
import ToggleButton from "../ui/ToggleButton";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import styles from "./AdminGeneralTab.module.css";

/**
 * AdminGeneralTab Component
 * Handles admin general settings like log level
 */
const AdminGeneralTab = React.memo(function AdminGeneralTab({
  localLogLevel,
  handleLogLevelChange,
  generalSettingsChanged,
  generalSettingsSaving,
  generalSettingsSuccess,
  handleSaveGeneralSettings,
}) {
  const logLevelOptions = [
    { value: LOG_LEVELS.INFO, label: "Info", icon: Info },
    { value: LOG_LEVELS.DEBUG, label: "Debug", icon: Search },
  ];

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
          <label htmlFor="logLevel" className={styles.label}>
            Log Level
          </label>
          <ToggleButton
            options={logLevelOptions}
            value={localLogLevel || "info"}
            onChange={handleLogLevelChange}
            className={styles.toggle}
          />
          <small className={styles.helperText}>
            Control the verbosity of application logs. {'"'}Info{'"'} shows core events (job starts,
            completions, errors). {'"'}Debug{'"'} includes detailed scheduling, comparison, and
            diagnostic information.
          </small>
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
    </div>
  );
});

AdminGeneralTab.propTypes = {
  localLogLevel: PropTypes.string.isRequired,
  handleLogLevelChange: PropTypes.func.isRequired,
  generalSettingsChanged: PropTypes.bool.isRequired,
  generalSettingsSaving: PropTypes.bool.isRequired,
  generalSettingsSuccess: PropTypes.string,
  handleSaveGeneralSettings: PropTypes.func.isRequired,
};

export default AdminGeneralTab;
