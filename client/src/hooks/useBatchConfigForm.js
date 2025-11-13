import { useState, useEffect, useCallback } from "react";
import { BATCH_JOB_TYPES } from "../constants/batch";
import { DEFAULT_INTERVAL_MINUTES } from "../constants/numbers";

/**
 * Custom hook for managing batch configuration form state
 * Extracts form logic from BatchTab component
 */
export function useBatchConfigForm(batchConfigs) {
  const [localConfigs, setLocalConfigs] = useState(batchConfigs);
  const [hasChanges, setHasChanges] = useState(false);
  const [intervalInputs, setIntervalInputs] = useState({
    [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: String(
      batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.intervalValue || DEFAULT_INTERVAL_MINUTES
    ),
    [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: String(
      batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.intervalValue || DEFAULT_INTERVAL_MINUTES
    ),
  });

  // Update local configs when batchConfigs change from the hook
  useEffect(() => {
    setLocalConfigs(batchConfigs);
    setHasChanges(false);
    setIntervalInputs({
      [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: String(
        batchConfigs[BATCH_JOB_TYPES.DOCKER_HUB_PULL]?.intervalValue || DEFAULT_INTERVAL_MINUTES
      ),
      [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: String(
        batchConfigs[BATCH_JOB_TYPES.TRACKED_APPS_CHECK]?.intervalValue || DEFAULT_INTERVAL_MINUTES
      ),
    });
  }, [batchConfigs]);

  const handleConfigChange = useCallback(
    (jobType, field, value) => {
      setLocalConfigs((prev) => {
        const updated = {
          ...prev,
          [jobType]: {
            ...prev[jobType],
            [field]: value,
          },
        };
        // Check if there are changes compared to original batchConfigs
        const hasAnyChanges = Object.keys(updated).some(
          (key) => JSON.stringify(updated[key]) !== JSON.stringify(batchConfigs[key])
        );
        setHasChanges(hasAnyChanges);
        return updated;
      });
    },
    [batchConfigs]
  );

  const handleIntervalInputChange = useCallback(
    (jobType, value) => {
      // Update the input string value
      setIntervalInputs((prev) => ({
        ...prev,
        [jobType]: value,
      }));

      // Only update the config if it's a valid number
      if (value === "" || value === "-") {
        // Allow empty or negative sign for typing
        return;
      }

      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1) {
        handleConfigChange(jobType, "intervalValue", numValue);
      }
    },
    [handleConfigChange]
  );

  const handleIntervalBlur = useCallback(
    (jobType) => {
      // On blur, ensure we have a valid value
      const currentValue = intervalInputs[jobType];
      const numValue = parseInt(currentValue, 10);

      if (isNaN(numValue) || numValue < 1 || currentValue === "") {
        // Reset to minimum value if invalid
        const defaultValue =
          localConfigs[jobType]?.intervalValue || DEFAULT_INTERVAL_MINUTES;
        setIntervalInputs((prev) => ({
          ...prev,
          [jobType]: String(defaultValue),
        }));
        handleConfigChange(jobType, "intervalValue", defaultValue);
      } else {
        // Ensure the input string matches the parsed value
        setIntervalInputs((prev) => ({
          ...prev,
          [jobType]: String(numValue),
        }));
      }
    },
    [intervalInputs, localConfigs, handleConfigChange]
  );

  return {
    localConfigs,
    intervalInputs,
    hasChanges,
    handleConfigChange,
    handleIntervalInputChange,
    handleIntervalBlur,
  };
}

