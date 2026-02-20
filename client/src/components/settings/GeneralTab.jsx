import React from "react";
import PropTypes from "prop-types";
import { Monitor, Sun, Moon, Power, PowerOff } from "lucide-react";
import { COLOR_SCHEMES } from "../../constants/settings";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
// Card is not currently used but kept for potential future use
import ToggleButton from "../ui/ToggleButton";
import AboutSection from "./AboutSection";
import styles from "./GeneralTab.module.css";

/**
 * GeneralTab Component
 * Handles general settings like color scheme and log level
 */
const GeneralTab = React.memo(function GeneralTab({
  localColorScheme,
  setLocalColorScheme,
  localRefreshingTogglesEnabled,
  handleRefreshingTogglesChange,
  generalSettingsChanged,
  generalSettingsSaving,
  generalSettingsSuccess,
  handleSaveGeneralSettings,
}) {
  const colorSchemeOptions = [
    { value: COLOR_SCHEMES.SYSTEM, label: "System", icon: Monitor },
    { value: COLOR_SCHEMES.LIGHT, label: "Light", icon: Sun },
    { value: COLOR_SCHEMES.DARK, label: "Dark", icon: Moon },
  ];

  const refreshingTogglesOptions = [
    { value: "off", label: "Off", icon: PowerOff },
    { value: "on", label: "On", icon: Power },
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
          <label htmlFor="colorScheme" className={styles.label}>
            Color Scheme Preference
          </label>
          <ToggleButton
            options={colorSchemeOptions}
            value={localColorScheme}
            onChange={setLocalColorScheme}
          />
          <small className={styles.helperText}>
            Choose how the application theme is determined. {'"'}System{'"'} will follow your
            browser or operating system preference.
          </small>
        </div>
        {/* When enabled, allows stopping, removing, repulling, starting, and verifying that the new container is up */}
        <div className={styles.formGroup}>
          <label htmlFor="refreshingToggles" className={styles.label}>
            Developer Mode
          </label>
          <ToggleButton
            options={refreshingTogglesOptions}
            value={
              localRefreshingTogglesEnabled === null
                ? "off"
                : localRefreshingTogglesEnabled
                  ? "on"
                  : "off"
            }
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

      <div className={styles.supportSection}>
        <h4 className={styles.sectionTitle}>Support</h4>
        <div className={styles.supportContent}>
          <a
            href="https://www.buymeacoffee.com/dodgerbluel"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.coffeeLink}
          >
            <img
              src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png"
              alt="Buy Me A Coffee"
              className={styles.coffeeButton}
            />
          </a>
          <p className={styles.supportText}>
            Enjoying Docked? Consider supporting the project to help keep it running and improving.
          </p>
        </div>
      </div>

      <AboutSection />
    </div>
  );
});

GeneralTab.propTypes = {
  localColorScheme: PropTypes.string.isRequired,
  setLocalColorScheme: PropTypes.func.isRequired,
  localRefreshingTogglesEnabled: PropTypes.bool.isRequired,
  handleRefreshingTogglesChange: PropTypes.func.isRequired,
  generalSettingsChanged: PropTypes.bool.isRequired,
  generalSettingsSaving: PropTypes.bool.isRequired,
  generalSettingsSuccess: PropTypes.string,
  handleSaveGeneralSettings: PropTypes.func.isRequired,
};

export default GeneralTab;
