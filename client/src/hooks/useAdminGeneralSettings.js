import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import {
  BATCH_LOG_LEVEL_QUERY,
  SET_BATCH_LOG_LEVEL_MUTATION,
  DEBUG_ENDPOINTS_ENABLED_QUERY,
  SET_DEBUG_ENDPOINTS_ENABLED_MUTATION,
} from "../graphql/queries";

/**
 * useAdminGeneralSettings Hook
 * Manages admin general settings like log level (admin-only settings)
 */
export function useAdminGeneralSettings() {
  const [logLevel, setLogLevel] = useState(null);
  const [localLogLevel, setLocalLogLevel] = useState(null);
  const [debugEndpointsEnabled, setDebugEndpointsEnabled] = useState(false);
  const [localDebugEndpointsEnabled, setLocalDebugEndpointsEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [generalSettingsChanged, setGeneralSettingsChanged] = useState(false);
  const isSavingRef = useRef(false);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSuccess, setGeneralSettingsSuccess] = useState("");

  const fetchLogLevel = useCallback(async () => {
    try {
      const result = await graphqlClient.query(BATCH_LOG_LEVEL_QUERY).toPromise();
      if (!result.error && result.data?.batchLogLevel) {
        const fetchedLevel = result.data.batchLogLevel.toLowerCase() || "info";
        setLogLevel(fetchedLevel);
        // Set local state immediately with DB value to prevent flicker
        setLocalLogLevel(fetchedLevel);
      } else {
        // If no value in DB, use default
        const defaultLevel = "info";
        setLogLevel(defaultLevel);
        setLocalLogLevel(defaultLevel);
      }
    } catch (err) {
      console.error("Error fetching log level:", err);
      // On error, use default
      const defaultLevel = "info";
      setLogLevel(defaultLevel);
      setLocalLogLevel(defaultLevel);
    }
  }, []);

  const fetchDebugEndpointsEnabled = useCallback(async () => {
    try {
      const { data, error } = await graphqlClient.query(DEBUG_ENDPOINTS_ENABLED_QUERY).toPromise();
      if (error) throw error;
      const enabled = !!data?.debugEndpointsEnabled;
      setDebugEndpointsEnabled(enabled);
      setLocalDebugEndpointsEnabled(enabled);
    } catch (err) {
      console.error("Error fetching debug endpoints enabled:", err);
      setDebugEndpointsEnabled(false);
      setLocalDebugEndpointsEnabled(false);
    }
  }, []);

  // Initialize settings on mount
  useEffect(() => {
    const initializeSettings = async () => {
      await Promise.all([fetchLogLevel(), fetchDebugEndpointsEnabled()]);
      setIsInitialized(true);
    };
    initializeSettings();
  }, [fetchLogLevel, fetchDebugEndpointsEnabled]);

  // Sync logLevel to localLogLevel after initialization (only if logLevel changes externally)
  useEffect(() => {
    if (isInitialized && !isSavingRef.current && logLevel !== null) {
      setLocalLogLevel((prev) => {
        if (prev === logLevel) return prev;
        return logLevel;
      });
    }
  }, [logLevel, isInitialized]);

  const handleSaveGeneralSettings = useCallback(async () => {
    setGeneralSettingsSaving(true);
    isSavingRef.current = true;
    setGeneralSettingsSuccess("");

    try {
      const errors = [];

      // Save log level to DB
      let logLevelSuccess = false;
      try {
        const logLevelResult = await graphqlClient
          .mutation(SET_BATCH_LOG_LEVEL_MUTATION, { logLevel: localLogLevel.toUpperCase() })
          .toPromise();
        logLevelSuccess = !logLevelResult.error && !!logLevelResult.data?.setBatchLogLevel?.success;
        if (logLevelSuccess) {
          // Update the actual log level state
          setLogLevel(localLogLevel);
        }
      } catch (err) {
        console.error("Error saving log level:", err);
        errors.push("Failed to save log level");
      }

      // Save debug endpoints enabled
      let debugEndpointsSuccess = false;
      try {
        const debugResult = await graphqlClient
          .mutation(SET_DEBUG_ENDPOINTS_ENABLED_MUTATION, {
            enabled: localDebugEndpointsEnabled,
          })
          .toPromise();
        debugEndpointsSuccess =
          !debugResult.error && !!debugResult.data?.setDebugEndpointsEnabled?.success;
        if (debugEndpointsSuccess) {
          setDebugEndpointsEnabled(localDebugEndpointsEnabled);
        }
      } catch (err) {
        console.error("Error saving debug endpoints enabled:", err);
        errors.push("Failed to save debug endpoints setting");
      }

      // Check if all settings were saved successfully
      if (logLevelSuccess && debugEndpointsSuccess) {
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("Settings saved successfully!");
        window.dispatchEvent(new CustomEvent("generalSettingsSaved"));
      } else {
        const errorMessage =
          errors.length > 0
            ? `Failed to save: ${errors.join(", ")}`
            : "Failed to save one or more settings";
        setGeneralSettingsSuccess(errorMessage);
        console.error("Admin settings save failed:", { logLevelSuccess, debugEndpointsSuccess });
      }
    } catch (err) {
      console.error("Error saving general settings:", err);
      setGeneralSettingsSuccess("Failed to save log level. Please try again.");
    } finally {
      setGeneralSettingsSaving(false);
      isSavingRef.current = false;
      // Clear success message after 3 seconds
      setTimeout(() => {
        setGeneralSettingsSuccess("");
      }, 3000);
    }
  }, [localLogLevel, localDebugEndpointsEnabled]);

  const handleLogLevelChange = useCallback((newLevel) => {
    setLocalLogLevel(newLevel);
    setGeneralSettingsChanged(true);
    setGeneralSettingsSuccess("");
  }, []);

  const handleDebugEndpointsChange = useCallback((val) => {
    setLocalDebugEndpointsEnabled(val === "on");
    setGeneralSettingsChanged(true);
    setGeneralSettingsSuccess("");
  }, []);

  return {
    isInitialized,
    logLevel,
    localLogLevel,
    handleLogLevelChange,
    debugEndpointsEnabled,
    localDebugEndpointsEnabled,
    handleDebugEndpointsChange,
    generalSettingsChanged,
    generalSettingsSaving,
    generalSettingsSuccess,
    handleSaveGeneralSettings,
  };
}
