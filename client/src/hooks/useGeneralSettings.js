import { useState, useEffect, useCallback, useRef } from "react";
import { BATCH_JOB_TYPES, DEFAULT_BATCH_CONFIG } from "../constants/settings";
import { getErrorMessage, SUCCESS_MESSAGES } from "../utils/errorMessages";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";
import { graphqlClient } from "../graphql/client";
import {
  USER_PREFERENCES_QUERY,
  UPDATE_USER_PREFERENCES_MUTATION,
  BATCH_CONFIGS_QUERY,
  UPDATE_BATCH_CONFIG_MUTATION,
} from "../graphql/queries";

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
    [BATCH_JOB_TYPES.APP_VERSION_SCAN]: { ...DEFAULT_BATCH_CONFIG },
  });
  const [batchError, setBatchError] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batchLoading, setBatchLoading] = useState({});
  // batchConfigs starts as DEFAULT_BATCH_CONFIG for every job type, so a failed
  // read is indistinguishable from "the user really has the defaults". Saving in
  // that state writes defaults back over the stored schedules and silently
  // disables jobs the user had enabled.
  const [batchConfigLoadError, setBatchConfigLoadError] = useState("");
  // The preferences read is what makes the theme and toggle values in this form
  // trustworthy. urql resolves instead of rejecting, so a failed read used to
  // fall through to the hard-coded default and a later save wrote that default
  // back over the stored preference.
  const [preferencesError, setPreferencesError] = useState("");

  const fetchRefreshingTogglesEnabled = useCallback(async () => {
    const generation = getSessionGeneration();
    try {
      const res = await graphqlClient
        .query(USER_PREFERENCES_QUERY, undefined, { requestPolicy: "network-only" })
        .toPromise();
      // A response that lands after logout belongs to a dead session (it can
      // carry another user's preference) — drop it.
      if (isSessionStale(generation)) return;
      if (res.error) {
        setPreferencesError(res.error.message || "Could not load your preferences");
        return;
      }
      if (res.data?.userPreferences) {
        const fetchedEnabled = res.data.userPreferences.refreshingTogglesEnabled || false;
        setRefreshingTogglesEnabled(fetchedEnabled);
        setLocalRefreshingTogglesEnabled(fetchedEnabled);
      } else {
        const defaultEnabled = false;
        setRefreshingTogglesEnabled(defaultEnabled);
        setLocalRefreshingTogglesEnabled(defaultEnabled);
      }
      setPreferencesError("");
    } catch (err) {
      console.error("Error fetching refreshing toggles enabled:", err);
      if (isSessionStale(generation)) return;
      setPreferencesError(err.message || "Could not load your preferences");
    }
  }, []);

  const fetchBatchConfig = useCallback(async () => {
    const generation = getSessionGeneration();
    try {
      const result = await graphqlClient.query(BATCH_CONFIGS_QUERY).toPromise();
      if (isSessionStale(generation)) return;
      if (result.error) {
        setBatchConfigLoadError(result.error.message || "Failed to load batch configuration");
        return;
      }
      if (result.data?.batchConfigs) {
        const configs = {};
        result.data.batchConfigs.forEach((c) => {
          configs[c.jobType.toLowerCase().replace(/_/g, "-")] = c;
        });
        const newConfigs = {
          [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: { ...DEFAULT_BATCH_CONFIG },
          [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: { ...DEFAULT_BATCH_CONFIG },
          [BATCH_JOB_TYPES.APP_VERSION_SCAN]: { ...DEFAULT_BATCH_CONFIG },
        };

        [
          BATCH_JOB_TYPES.DOCKER_HUB_PULL,
          BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
          BATCH_JOB_TYPES.APP_VERSION_SCAN,
        ].forEach((jobType) => {
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
      setBatchConfigLoadError("");
    } catch (err) {
      console.error("Error fetching batch config:", err);
      if (isSessionStale(generation)) return;
      setBatchConfigLoadError(err.message || "Failed to load batch configuration");
    }
  }, []);

  // Fetch initial data on mount and when user changes (authToken changes)
  // Note: logLevel is now handled in Admin page
  // Reset initialization state when user changes to prevent showing stale data
  useEffect(() => {
    // Reset initialization state when user changes
    setIsInitialized(false);

    const initializeData = async () => {
      await Promise.all([fetchBatchConfig(), fetchRefreshingTogglesEnabled()]);
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
    // Nothing in this form is trustworthy until the preferences read has
    // resolved: colorScheme comes from the theme hook's copy of the same query
    // and refreshingTogglesEnabled starts as null. Saving an unresolved form
    // writes the fallbacks over the stored values.
    if (localRefreshingTogglesEnabled === null || preferencesError) {
      setGeneralSettingsSuccess("");
      return;
    }
    setGeneralSettingsSaving(true);
    setGeneralSettingsSuccess("");
    isSavingRef.current = true;
    const generation = getSessionGeneration();
    const errors = [];

    try {
      // Save all preferences in a single GraphQL mutation
      const enabledValue =
        localRefreshingTogglesEnabled === null ? false : Boolean(localRefreshingTogglesEnabled);

      const res = await graphqlClient
        .mutation(UPDATE_USER_PREFERENCES_MUTATION, {
          input: {
            colorScheme: localColorScheme,
            refreshingTogglesEnabled: enabledValue,
          },
        })
        .toPromise();

      // The save can finish after logout. Applying it would push the previous
      // user's theme into the replacement session and broadcast a global
      // generalSettingsSaved event that the new session's listeners act on.
      if (isSessionStale(generation)) return;

      if (res.error) {
        errors.push(res.error.message || "Failed to save settings");
      } else if (res.data?.updateUserPreferences?.success) {
        if (onColorSchemeChange) {
          onColorSchemeChange(localColorScheme);
        }
        setRefreshingTogglesEnabled(enabledValue);
        setLocalRefreshingTogglesEnabled(enabledValue);
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("General settings saved successfully!");
        window.dispatchEvent(new CustomEvent("generalSettingsSaved"));
      } else {
        errors.push("Failed to save settings");
      }

      if (errors.length > 0) {
        setGeneralSettingsSuccess(`Failed to save: ${errors.join(", ")}`);
      }
    } catch (err) {
      console.error("Error saving general settings:", err);
      setGeneralSettingsSuccess(`Failed to save settings: ${err.message || "Unknown error"}`);
    } finally {
      setGeneralSettingsSaving(false);
      setTimeout(() => {
        isSavingRef.current = false;
      }, 0);
    }
  }, [localColorScheme, localRefreshingTogglesEnabled, preferencesError, onColorSchemeChange]);

  const handleRefreshingTogglesChange = useCallback((enabled) => {
    setLocalRefreshingTogglesEnabled(enabled === "on");
    setGeneralSettingsChanged(true);
  }, []);

  const handleBatchConfigSubmit = useCallback(
    async (e, configsToSubmit = null) => {
      e.preventDefault();
      setBatchError("");
      setBatchSuccess("");
      if (batchConfigLoadError) {
        // Refuse rather than write: the form is showing defaults because the
        // read failed, and this handler replaces all three stored schedules.
        setBatchError(
          "Batch schedules could not be loaded, so saving is disabled. Saving now would replace them with defaults."
        );
        return;
      }
      setBatchLoading({
        [BATCH_JOB_TYPES.DOCKER_HUB_PULL]: true,
        [BATCH_JOB_TYPES.TRACKED_APPS_CHECK]: true,
        [BATCH_JOB_TYPES.APP_VERSION_SCAN]: true,
      });

      // Use provided configs or fall back to current batchConfigs
      const configs = configsToSubmit || batchConfigs;
      const generation = getSessionGeneration();

      try {
        await Promise.all(
          [
            BATCH_JOB_TYPES.DOCKER_HUB_PULL,
            BATCH_JOB_TYPES.TRACKED_APPS_CHECK,
            BATCH_JOB_TYPES.APP_VERSION_SCAN,
          ].map(async (jobType) => {
            const config = configs[jobType];
            const intervalMinutes =
              config.intervalUnit === "hours" ? config.intervalValue * 60 : config.intervalValue;

            const result = await graphqlClient
              .mutation(UPDATE_BATCH_CONFIG_MUTATION, {
                input: {
                  jobType: jobType.toUpperCase().replace(/-/g, "_"),
                  enabled: config.enabled,
                  intervalMinutes: intervalMinutes,
                },
              })
              .toPromise();

            if (result.error || !result.data?.updateBatchConfig?.success) {
              throw new Error(
                result.error?.message ||
                  result.data?.updateBatchConfig?.message ||
                  "Failed to update batch configuration"
              );
            }
          })
        );

        // Mutations can complete after logout; the follow-up reads and the
        // parent's refresh callback must not fire inside the replacement
        // session (they would carry the previous user's settings).
        if (isSessionStale(generation)) return;

        // Re-read the canonical configs from the server
        await fetchBatchConfig();

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
          [BATCH_JOB_TYPES.APP_VERSION_SCAN]: false,
        });
      }
    },
    [batchConfigs, batchConfigLoadError, onBatchConfigUpdate, fetchBatchConfig]
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
    batchConfigLoadError,
    handleBatchConfigSubmit,
    fetchBatchConfig,
    preferencesError,
    fetchUserPreferences: fetchRefreshingTogglesEnabled,
    isInitialized, // Expose initialization state
  };
}
