import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

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
      const response = await axios.get(`${API_BASE_URL}/api/batch/log-level`);
      if (response.data.success) {
        const fetchedLevel = response.data.logLevel || "info";
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
      const response = await axios.get(`${API_BASE_URL}/api/settings/debug-endpoints-enabled`);
      const enabled = response.data.enabled || false;
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
        const logLevelResponse = await axios.post(`${API_BASE_URL}/api/batch/log-level`, {
          logLevel: localLogLevel,
        });
        logLevelSuccess = logLevelResponse.data.success;
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
        const debugResponse = await axios.post(`${API_BASE_URL}/api/settings/debug-endpoints-enabled`, {
          enabled: localDebugEndpointsEnabled,
        });
        debugEndpointsSuccess = debugResponse.data.success;
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
          errors.length > 0 ? `Failed to save: ${errors.join(", ")}` : "Failed to save one or more settings";
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
