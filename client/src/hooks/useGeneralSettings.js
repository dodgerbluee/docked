import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { BATCH_JOB_TYPES, DEFAULT_BATCH_CONFIG } from "../constants/settings";
import { getErrorMessage, SUCCESS_MESSAGES } from "../utils/errorMessages";

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
      // Save color scheme to DB
      const colorSchemeResponse = await axios.post(`${API_BASE_URL}/api/settings/color-scheme`, {
        colorScheme: localColorScheme,
      });

      // Save log level to DB
      const logLevelResponse = await axios.post(`${API_BASE_URL}/api/batch/log-level`, {
        logLevel: localLogLevel,
      });

      if (colorSchemeResponse.data.success && logLevelResponse.data.success) {
        if (onColorSchemeChange) {
          onColorSchemeChange(localColorScheme);
        }
        setLogLevel(localLogLevel);
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("General settings saved successfully!");
      } else {
        throw new Error("Failed to save one or more settings");
      }
    } catch (err) {
      console.error("Error saving general settings:", err);
      setGeneralSettingsSuccess("");
    } finally {
      setGeneralSettingsSaving(false);
    }
  }, [localColorScheme, localLogLevel, onColorSchemeChange]);

  const handleLogLevelChange = useCallback((newLevel) => {
    setLocalLogLevel(newLevel);
    setGeneralSettingsChanged(true);
  }, []);

  const handleBatchConfigSubmit = useCallback(
    async (e, configsToSubmit = null) => {
      e.preventDefault();
      setBatchError("");
      setBatchSuccess("");
      setBatchLoading({
        [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: true,
        [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: true,
      });

      // Use provided configs or fall back to current batchConfigs
      const configs = configsToSubmit || batchConfigs;

      try {
        const responses = await Promise.all(
          [
            BATCH_JOB_TYPES.DOCKER_HUB_PULL,
            BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
          ].map(async (jobType) => {
            const config = configs[jobType];
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

            if (!response.data.success) {
              throw new Error(
                response.data.error || "Failed to update batch configuration"
              );
            }

            return { jobType, response: response.data };
          })
        );

        // Use the configs from the last response (server returns all configs)
        const lastResponse = responses[responses.length - 1];
        if (lastResponse?.response?.config) {
          const serverConfigs = lastResponse.response.config;
          const newConfigs = {
            [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: { ...DEFAULT_BATCH_CONFIG },
            [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: { ...DEFAULT_BATCH_CONFIG },
          };

          [BATCH_JOB_TYPES.DOCKER_HUB_PULL, BATCH_JOB_TYPES.TRACKED_APPS_CHECK].forEach(
            (jobType) => {
              const config = serverConfigs[jobType] || {
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
        } else {
          // Fallback: update state with the configs we just submitted
          setBatchConfigs((prev) => {
            const updated = { ...prev };
            [BATCH_JOB_TYPES.DOCKER_HUB_PULL, BATCH_JOB_TYPES.TRACKED_APPS_CHECK].forEach(
              (jobType) => {
                const config = configs[jobType];
                const intervalMinutes =
                  config.intervalUnit === "hours"
                    ? config.intervalValue * 60
                    : config.intervalValue;
                updated[jobType] = {
                  ...config,
                  intervalMinutes: intervalMinutes,
                };
              }
            );
            return updated;
          });
        }

        setBatchSuccess(SUCCESS_MESSAGES.BATCH.CONFIG_UPDATE);
        setTimeout(() => setBatchSuccess(""), 3000);

        if (onBatchConfigUpdate && typeof onBatchConfigUpdate === "function") {
          try {
            await onBatchConfigUpdate();
          } catch (err) {
            console.error("Error calling onBatchConfigUpdate:", err);
          }
        }
      } catch (err) {
        const errorMessage =
          err.response?.data?.error ||
          err.message ||
          getErrorMessage("BATCH", "CONFIG_UPDATE");
        setBatchError(errorMessage);
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

