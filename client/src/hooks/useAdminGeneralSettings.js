import { useState, useEffect, useCallback, useRef } from "react";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";
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
    const generation = getSessionGeneration();
    try {
      const result = await graphqlClient.query(BATCH_LOG_LEVEL_QUERY).toPromise();
      // A response that lands after logout belongs to a dead session and must
      // not seed the replacement session's state.
      if (isSessionStale(generation)) return;
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
      if (isSessionStale(generation)) return;
      // On error, use default
      const defaultLevel = "info";
      setLogLevel(defaultLevel);
      setLocalLogLevel(defaultLevel);
    }
  }, []);

  const fetchDebugEndpointsEnabled = useCallback(async () => {
    const generation = getSessionGeneration();
    try {
      const { data, error } = await graphqlClient.query(DEBUG_ENDPOINTS_ENABLED_QUERY).toPromise();
      if (isSessionStale(generation)) return;
      if (error) throw error;
      const enabled = !!data?.debugEndpointsEnabled;
      setDebugEndpointsEnabled(enabled);
      setLocalDebugEndpointsEnabled(enabled);
    } catch (err) {
      console.error("Error fetching debug endpoints enabled:", err);
      if (isSessionStale(generation)) return;
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
    const generation = getSessionGeneration();

    try {
      const errors = [];

      // Save log level to DB
      let logLevelSuccess = false;
      try {
        const logLevelResult = await graphqlClient
          .mutation(SET_BATCH_LOG_LEVEL_MUTATION, { logLevel: localLogLevel.toUpperCase() })
          .toPromise();
        // The first mutation can complete after logout; nothing below it may
        // run inside the replacement session.
        if (isSessionStale(generation)) return;
        logLevelSuccess = !logLevelResult.error && !!logLevelResult.data?.setBatchLogLevel?.success;
        if (logLevelSuccess) {
          // Update the actual log level state
          setLogLevel(localLogLevel);
        }
      } catch (err) {
        console.error("Error saving log level:", err);
        if (isSessionStale(generation)) return;
        errors.push("Failed to save log level");
      }

      // Save debug endpoints enabled
      let debugEndpointsSuccess = false;
      try {
        if (isSessionStale(generation)) return;
        const debugResult = await graphqlClient
          .mutation(SET_DEBUG_ENDPOINTS_ENABLED_MUTATION, {
            enabled: localDebugEndpointsEnabled,
          })
          .toPromise();
        if (isSessionStale(generation)) return;
        debugEndpointsSuccess =
          !debugResult.error && !!debugResult.data?.setDebugEndpointsEnabled?.success;
        if (debugEndpointsSuccess) {
          setDebugEndpointsEnabled(localDebugEndpointsEnabled);
        }
      } catch (err) {
        console.error("Error saving debug endpoints enabled:", err);
        if (isSessionStale(generation)) return;
        errors.push("Failed to save debug endpoints setting");
      }

      // Check if all settings were saved successfully
      if (isSessionStale(generation)) return;
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
