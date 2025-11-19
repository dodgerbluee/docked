import { useState, useEffect, useCallback, useRef } from "react";
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
  const [logLevel, setLogLevel] = useState(null); // Initialize as null, will be set from DB
  const [localLogLevel, setLocalLogLevel] = useState(null); // Initialize as null, will be set from DB
  const [refreshingTogglesEnabled, setRefreshingTogglesEnabled] = useState(null); // Initialize as null, will be set from DB
  const [localRefreshingTogglesEnabled, setLocalRefreshingTogglesEnabled] = useState(null); // Initialize as null, will be set from DB
  const [isInitialized, setIsInitialized] = useState(false);
  const [generalSettingsChanged, setGeneralSettingsChanged] = useState(false);
  const isSavingRef = useRef(false);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSuccess, setGeneralSettingsSuccess] = useState("");

  const [batchConfigs, setBatchConfigs] = useState({
    [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: { ...DEFAULT_BATCH_CONFIG },
    [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: { ...DEFAULT_BATCH_CONFIG },
  });
  const [batchError, setBatchError] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batchLoading, setBatchLoading] = useState({});


  const fetchRefreshingTogglesEnabled = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/settings/refreshing-toggles-enabled`);
      if (response.data.success) {
        const fetchedEnabled = response.data.enabled || false;
        setRefreshingTogglesEnabled(fetchedEnabled);
        // Set local state immediately with DB value to prevent flicker
        setLocalRefreshingTogglesEnabled(fetchedEnabled);
      } else {
        // If no value in DB, use default
        const defaultEnabled = false;
        setRefreshingTogglesEnabled(defaultEnabled);
        setLocalRefreshingTogglesEnabled(defaultEnabled);
      }
    } catch (err) {
      // If endpoint doesn't exist yet, default to false
      console.error("Error fetching refreshing toggles enabled:", err);
      const defaultEnabled = false;
      setRefreshingTogglesEnabled(defaultEnabled);
      setLocalRefreshingTogglesEnabled(defaultEnabled);
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

        [BATCH_JOB_TYPES.DOCKER_HUB_PULL, BATCH_JOB_TYPES.TRACKED_APPS_CHECK].forEach((jobType) => {
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
        });

        setBatchConfigs(newConfigs);
      }
    } catch (err) {
      console.error("Error fetching batch config:", err);
    }
  }, []);

  // Fetch initial data on mount and when user changes (authToken changes)
  // Note: logLevel is now handled in Admin page
  // Reset initialization state when user changes to prevent showing stale data
  useEffect(() => {
    // Reset initialization state when user changes
    setIsInitialized(false);
    
    const initializeData = async () => {
      await Promise.all([
        fetchBatchConfig(),
        fetchRefreshingTogglesEnabled(),
      ]);
      setIsInitialized(true);
    };
    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - user changes handled by Settings component remounting

  useEffect(() => {
    // Only update if the value actually changed to prevent unnecessary re-renders
    setLocalColorScheme((prev) => (prev !== initialColorScheme ? initialColorScheme : prev));
    setGeneralSettingsChanged(false);
  }, [initialColorScheme]);

  // Sync refreshingTogglesEnabled to localRefreshingTogglesEnabled after initialization (only if it changes externally)
  // Skip sync during save operations and initial load to prevent flicker
  useEffect(() => {
    if (isInitialized && !isSavingRef.current && refreshingTogglesEnabled !== null) {
      // Only update if values differ to prevent unnecessary re-renders
      setLocalRefreshingTogglesEnabled((prev) => {
        if (prev === refreshingTogglesEnabled) return prev;
        return refreshingTogglesEnabled;
      });
    }
  }, [refreshingTogglesEnabled, isInitialized]);

  const handleSaveGeneralSettings = useCallback(async () => {
    setGeneralSettingsSaving(true);
    setGeneralSettingsSuccess("");
    isSavingRef.current = true; // Prevent sync useEffect hooks from running during save
    const errors = [];

    try {
      // Save color scheme to DB
      let colorSchemeSuccess = false;
      try {
        const colorSchemeResponse = await axios.post(`${API_BASE_URL}/api/settings/color-scheme`, {
          colorScheme: localColorScheme,
        });
        colorSchemeSuccess = colorSchemeResponse.data.success;
        if (colorSchemeSuccess && onColorSchemeChange) {
          // Update color scheme immediately for instant UI update
          onColorSchemeChange(localColorScheme);
        }
      } catch (err) {
        console.error("Error saving color scheme:", err);
        errors.push("Failed to save color scheme");
      }

      // Save refreshing toggles enabled to DB
      // Note: logLevel is now handled in Admin page
      let refreshingTogglesSuccess = false;
      try {
        // Ensure we always send a boolean value (default to false if null)
        const enabledValue = localRefreshingTogglesEnabled === null ? false : Boolean(localRefreshingTogglesEnabled);
        const refreshingTogglesResponse = await axios.post(
          `${API_BASE_URL}/api/settings/refreshing-toggles-enabled`,
          {
            enabled: enabledValue,
          }
        );
        refreshingTogglesSuccess = refreshingTogglesResponse.data.success;
        if (refreshingTogglesSuccess) {
          // Use the value returned from the server to ensure we're in sync
          const serverValue = refreshingTogglesResponse.data.enabled || false;
          setRefreshingTogglesEnabled(serverValue);
          setLocalRefreshingTogglesEnabled(serverValue);
        }
      } catch (err) {
        console.error("Error saving developer mode:", err);
        errors.push("Failed to save developer mode");
      }

      // Check if all settings were saved successfully
      // Note: logLevel is now handled in Admin page, so we only check colorScheme and refreshingToggles
      if (colorSchemeSuccess && refreshingTogglesSuccess) {
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("General settings saved successfully!");
        // Dispatch custom event to notify other components (e.g., PortainerPage) to refetch settings
        window.dispatchEvent(new CustomEvent("generalSettingsSaved"));
      } else {
        // Some settings failed - show which ones
        const errorMessage =
          errors.length > 0
            ? `Failed to save: ${errors.join(", ")}`
            : "Failed to save one or more settings";
        setGeneralSettingsSuccess(errorMessage);
        console.error("Some settings failed to save:", {
          colorSchemeSuccess,
          refreshingTogglesSuccess,
        });
      }
    } catch (err) {
      console.error("Error saving general settings:", err);
      setGeneralSettingsSuccess(`Failed to save settings: ${err.message || "Unknown error"}`);
    } finally {
      setGeneralSettingsSaving(false);
      // Use setTimeout to allow state updates to complete before re-enabling sync
      setTimeout(() => {
        isSavingRef.current = false;
      }, 0);
    }
  }, [localColorScheme, localRefreshingTogglesEnabled, onColorSchemeChange]);


  const handleRefreshingTogglesChange = useCallback((enabled) => {
    setLocalRefreshingTogglesEnabled(enabled === "on");
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
          [BATCH_JOB_TYPES.DOCKER_HUB_PULL, BATCH_JOB_TYPES.TRACKED_APPS_CHECK].map(
            async (jobType) => {
              const config = configs[jobType];
              const intervalMinutes =
                config.intervalUnit === "hours" ? config.intervalValue * 60 : config.intervalValue;

              const response = await axios.post(`${API_BASE_URL}/api/batch/config`, {
                jobType: jobType,
                enabled: config.enabled,
                intervalMinutes: intervalMinutes,
              });

              if (!response.data.success) {
                throw new Error(response.data.error || "Failed to update batch configuration");
              }

              return { jobType, response: response.data };
            }
          )
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
          err.response?.data?.error || err.message || getErrorMessage("BATCH", "CONFIG_UPDATE");
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
    refreshingTogglesEnabled,
    localRefreshingTogglesEnabled,
    generalSettingsChanged,
    setGeneralSettingsChanged,
    generalSettingsSaving,
    generalSettingsSuccess,
    handleSaveGeneralSettings,
    handleRefreshingTogglesChange,
    batchConfigs,
    setBatchConfigs,
    batchError,
    batchSuccess,
    batchLoading,
    handleBatchConfigSubmit,
    fetchBatchConfig,
    isInitialized, // Expose initialization state
  };
}
