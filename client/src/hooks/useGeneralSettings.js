import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { BATCH_JOB_TYPES, DEFAULT_BATCH_CONFIG } from "../constants/settings";

/**
 * useGeneralSettings Hook
 * Manages general settings like color scheme, log level, and batch config
 */
export function useGeneralSettings({
  colorScheme: initialColorScheme = "system",
  onColorSchemeChange,
  onBatchConfigUpdate,
}) {
  const [localColorScheme, setLocalColorScheme] = useState(initialColorScheme);
  const [logLevel, setLogLevel] = useState("info");
  const [localLogLevel, setLocalLogLevel] = useState("info");
  const [generalSettingsChanged, setGeneralSettingsChanged] = useState(false);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSuccess, setGeneralSettingsSuccess] = useState("");

  const [batchConfigs, setBatchConfigs] = useState({
    [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: { ...DEFAULT_BATCH_CONFIG },
    [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: { ...DEFAULT_BATCH_CONFIG },
  });
  const [batchError, setBatchError] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batchLoading, setBatchLoading] = useState({});

  const fetchLogLevel = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/log-level`);
      if (response.data.success) {
        setLogLevel(response.data.logLevel || "info");
      }
    } catch (err) {
      console.error("Error fetching log level:", err);
    }
  }, []);

  const fetchBatchConfig = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
      if (response.data.success) {
        const configs = response.data.config || {};
        const newConfigs = {
          [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: { ...DEFAULT_BATCH_CONFIG },
          [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: { ...DEFAULT_BATCH_CONFIG },
        };

        [BATCH_JOB_TYPES.DOCKER_HUB_PULL, BATCH_JOB_TYPES.TRACKED_APPS_CHECK].forEach(
          (jobType) => {
            const config = configs[jobType] || {
              enabled: false,
              intervalMinutes: 60,
            };
            const minutes = config.intervalMinutes || 60;

            if (minutes >= 60 && minutes % 60 === 0) {
              newConfigs[jobType] = {
                enabled: config.enabled || false,
                intervalMinutes: minutes,
                intervalValue: minutes / 60,
                intervalUnit: "hours",
              };
            } else {
              newConfigs[jobType] = {
                enabled: config.enabled || false,
                intervalMinutes: minutes,
                intervalValue: minutes,
                intervalUnit: "minutes",
              };
            }
          }
        );

        setBatchConfigs(newConfigs);
      }
    } catch (err) {
      console.error("Error fetching batch config:", err);
    }
  }, []);

  useEffect(() => {
    fetchLogLevel();
    fetchBatchConfig();
  }, [fetchLogLevel, fetchBatchConfig]);

  useEffect(() => {
    setLocalColorScheme(initialColorScheme);
    setGeneralSettingsChanged(false);
  }, [initialColorScheme]);

  useEffect(() => {
    setLocalLogLevel(logLevel);
  }, [logLevel]);

  const handleSaveGeneralSettings = useCallback(async () => {
    setGeneralSettingsSaving(true);
    try {
      if (onColorSchemeChange) {
        onColorSchemeChange(localColorScheme);
      }

      const response = await axios.post(`${API_BASE_URL}/api/batch/log-level`, {
        logLevel: localLogLevel,
      });

      if (response.data.success) {
        setLogLevel(localLogLevel);
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("General settings saved successfully!");
      }
    } catch (err) {
      console.error("Error saving general settings:", err);
    } finally {
      setGeneralSettingsSaving(false);
    }
  }, [localColorScheme, localLogLevel, onColorSchemeChange]);

  const handleLogLevelChange = useCallback((newLevel) => {
    setLocalLogLevel(newLevel);
    setGeneralSettingsChanged(true);
  }, []);

  const handleBatchConfigSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setBatchError("");
      setBatchSuccess("");
      setBatchLoading({
        [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: true,
        [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: true,
      });

      try {
        const promises = [
          BATCH_JOB_TYPES.DOCKER_HUB_PULL,
          BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
        ].map(async (jobType) => {
          const config = batchConfigs[jobType];
          const intervalMinutes =
            config.intervalUnit === "hours"
              ? config.intervalValue * 60
              : config.intervalValue;

          const response = await axios.post(
            `${API_BASE_URL}/api/batch/config`,
            {
              jobType: jobType,
              enabled: config.enabled,
              intervalMinutes: intervalMinutes,
            }
          );

          if (response.data.success) {
            const updatedConfigs = { ...batchConfigs };
            updatedConfigs[jobType] = {
              ...config,
              intervalMinutes: intervalMinutes,
            };
            setBatchConfigs(updatedConfigs);
            return true;
          } else {
            throw new Error(
              response.data.error || "Failed to update batch configuration"
            );
          }
        });

        await Promise.all(promises);
        setBatchSuccess("Batch configurations updated successfully!");
        setTimeout(() => setBatchSuccess(""), 3000);

        if (onBatchConfigUpdate && typeof onBatchConfigUpdate === "function") {
          try {
            await onBatchConfigUpdate();
          } catch (err) {
            console.error("Error calling onBatchConfigUpdate:", err);
          }
        }
      } catch (err) {
        setBatchError(
          err.response?.data?.error ||
            err.message ||
            "Failed to update batch configuration. Please try again."
        );
      } finally {
        setBatchLoading({
          [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: false,
          [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: false,
        });
      }
    },
    [batchConfigs, onBatchConfigUpdate]
  );

  return {
    localColorScheme,
    setLocalColorScheme,
    logLevel,
    localLogLevel,
    generalSettingsChanged,
    setGeneralSettingsChanged,
    generalSettingsSaving,
    generalSettingsSuccess,
    handleSaveGeneralSettings,
    handleLogLevelChange,
    batchConfigs,
    setBatchConfigs,
    batchError,
    batchSuccess,
    batchLoading,
    handleBatchConfigSubmit,
    fetchBatchConfig,
  };
}

