import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { useGeneralSettings } from "../../hooks/useGeneralSettings";
import { useBatchConfigForm } from "../../hooks/useBatchConfigForm";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import TimeIntervalInput from "../ui/TimeIntervalInput";
import { BATCH_JOB_TYPES, BATCH_JOB_TYPE_LABELS } from "../../constants/batch";
import { BATCH_INTERVAL_UNITS } from "../../constants/settings";
import styles from "./BatchTab.module.css";

/**
 * BatchTab Component
 * Handles batch job configuration (Docker Hub Pull and Tracked Apps Check)
 */
const BatchTab = React.memo(function BatchTab({
  onBatchConfigUpdate,
  colorScheme,
  onColorSchemeChange,
}) {
  const {
    batchConfigs,
    batchError,
    batchSuccess,
    batchLoading,
    handleBatchConfigSubmit,
  } = useGeneralSettings({
    colorScheme,
    onColorSchemeChange,
    onBatchConfigUpdate,
  });

  // Use extracted form hook
  const {
    localConfigs,
    intervalInputs,
    hasChanges,
    handleConfigChange,
    handleIntervalInputChange,
    handleIntervalBlur,
  } = useBatchConfigForm(batchConfigs);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      // Pass localConfigs directly to submit handler to avoid stale closure issues
      await handleBatchConfigSubmit(e, localConfigs);
      // After successful save, refetch configs to ensure we have the latest from server
      // This will update batchConfigs which will sync to localConfigs via useEffect
    },
    [localConfigs, handleBatchConfigSubmit]
  );

  const isSaving = Object.values(batchLoading).some(loading => loading);

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Batch Configuration</h3>
      
      {batchError && <Alert variant="error" className={styles.alert}>{batchError}</Alert>}
      {batchSuccess && <Alert variant="info" className={styles.alert}>{batchSuccess}</Alert>}

      <form className={styles.form} onSubmit={handleSubmit}>
        {/* Docker Hub Pull Configuration */}
        <div className={styles.jobConfig}>
          <h4 className={styles.jobTitle}>
            {BATCH_JOB_TYPE_LABELS[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
          </h4>
          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={localConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled || false}
                onChange={(e) =>
                  handleConfigChange(BATCH_JOB_TYPES.DOCKER_HUB_PULL, "enabled", e.target.checked)
                }
                className={styles.checkbox}
              />
              <span>Enable automatic Docker Hub scanning</span>
            </label>
          </div>
          {localConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.enabled && (
            <div className={styles.intervalContainer}>
              <TimeIntervalInput
                label="Interval"
                value={intervalInputs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]}
                unit={localConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.intervalUnit || BATCH_INTERVAL_UNITS.MINUTES}
                onChange={(value) =>
                  handleIntervalInputChange(BATCH_JOB_TYPES.DOCKER_HUB_PULL, value)
                }
                onUnitChange={(unit) =>
                  handleConfigChange(BATCH_JOB_TYPES.DOCKER_HUB_PULL, "intervalUnit", unit)
                }
                onBlur={() => handleIntervalBlur(BATCH_JOB_TYPES.DOCKER_HUB_PULL)}
                min={1}
                required
              />
            </div>
          )}
        </div>

        {/* Tracked Apps Check Configuration */}
        <div className={styles.jobConfig}>
          <h4 className={styles.jobTitle}>
            {BATCH_JOB_TYPE_LABELS[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
          </h4>
          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={localConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled || false}
                onChange={(e) =>
                  handleConfigChange(
                    BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
                    "enabled",
                    e.target.checked
                  )
                }
                className={styles.checkbox}
              />
              <span>Enable automatic tracked apps checking</span>
            </label>
          </div>
          {localConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.enabled && (
            <div className={styles.intervalContainer}>
              <TimeIntervalInput
                label="Interval"
                value={intervalInputs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]}
                unit={localConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.intervalUnit || BATCH_INTERVAL_UNITS.MINUTES}
                onChange={(value) =>
                  handleIntervalInputChange(BATCH_JOB_TYPES.TRACKED_APPS_CHECK, value)
                }
                onUnitChange={(unit) =>
                  handleConfigChange(BATCH_JOB_TYPES.TRACKED_APPS_CHECK, "intervalUnit", unit)
                }
                onBlur={() => handleIntervalBlur(BATCH_JOB_TYPES.TRACKED_APPS_CHECK)}
                min={1}
                required
              />
            </div>
          )}
        </div>

        <div className={styles.formActions}>
          <Button
            type="submit"
            variant="primary"
            disabled={!hasChanges || isSaving}
            className={styles.saveButton}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
});

BatchTab.propTypes = {
  onBatchConfigUpdate: PropTypes.func,
  colorScheme: PropTypes.string,
  onColorSchemeChange: PropTypes.func,
};

export default BatchTab;

