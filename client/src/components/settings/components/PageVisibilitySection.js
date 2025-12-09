/**
 * PageVisibilitySection Component
 * Reusable component for managing page visibility settings
 */

import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Power, PowerOff } from "lucide-react";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import ToggleButton from "../../ui/ToggleButton";
import styles from "./PageVisibilitySection.module.css";

/**
 * PageVisibilitySection Component
 * @param {Object} props
 * @param {boolean} props.initialDisabled - Initial disabled state
 * @param {Function} props.onUpdate - Callback to update the setting
 * @param {Function} props.onRefresh - Callback to refresh settings
 * @param {string} props.title - Title for the section
 * @param {string} props.checkboxLabel - Label for the checkbox
 * @param {string} props.checkboxNote - Note text below checkbox
 */
const PageVisibilitySection = React.memo(function PageVisibilitySection({
  initialDisabled,
  onUpdate,
  onRefresh,
  title,
  checkboxLabel,
  checkboxNote,
}) {
  const [localDisabled, setLocalDisabled] = useState(initialDisabled);
  const [saving, setSaving] = useState(false);

  // Update local state when initial value changes
  useEffect(() => {
    setLocalDisabled(initialDisabled);
  }, [initialDisabled]);

  const toggleOptions = [
    { value: "on", label: "On", icon: Power },
    { value: "off", label: "Off", icon: PowerOff },
  ];

  const handleToggleChange = useCallback((value) => {
    // Convert "on"/"off" to boolean (disabled is true when "off", false when "on")
    setLocalDisabled(value === "off");
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const success = await onUpdate(localDisabled);
      if (success) {
        // Refresh settings to ensure sync
        if (onRefresh) {
          await onRefresh();
        }
        // Dispatch custom event to notify HomePage to refresh
        window.dispatchEvent(new CustomEvent("pageVisibilitySettingsUpdated"));
      }
    } catch (error) {
      console.error("Error saving page visibility settings:", error);
    } finally {
      setSaving(false);
    }
  }, [localDisabled, onUpdate, onRefresh]);

  const hasChanges = localDisabled !== initialDisabled;

  return (
    <div className={styles.pageVisibilitySection}>
      <div className={styles.sectionHeader}>
        <h4 className={styles.sectionTitle}>{title}</h4>
      </div>
      <Card variant="default" padding="md" className={styles.visibilityCard}>
        <div className={styles.toggleContainer}>
          <label className={styles.toggleLabel}>{checkboxLabel}</label>
          <ToggleButton
            options={toggleOptions}
            value={localDisabled ? "off" : "on"}
            onChange={handleToggleChange}
            className={styles.toggle}
          />
          {checkboxNote && <p className={styles.toggleNote}>{checkboxNote}</p>}
        </div>
        <div className={styles.formActions}>
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={styles.saveButton}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
});

PageVisibilitySection.propTypes = {
  initialDisabled: PropTypes.bool.isRequired,
  onUpdate: PropTypes.func.isRequired,
  onRefresh: PropTypes.func,
  title: PropTypes.string.isRequired,
  checkboxLabel: PropTypes.string.isRequired,
  checkboxNote: PropTypes.string,
};

export default PageVisibilitySection;
