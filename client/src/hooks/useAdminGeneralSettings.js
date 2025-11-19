import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useAdminGeneralSettings Hook
 * Manages admin general settings like log level (admin-only settings)
 */
export function useAdminGeneralSettings() {
  const [logLevel, setLogLevel] = useState(null); // Initialize as null, will be set from DB
  const [localLogLevel, setLocalLogLevel] = useState(null); // Initialize as null, will be set from DB
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

  // Initialize settings on mount
  useEffect(() => {
    const initializeSettings = async () => {
      await Promise.all([fetchLogLevel()]);
      setIsInitialized(true);
    };
    initializeSettings();
  }, [fetchLogLevel]);

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

      // Check if all settings were saved successfully
      if (logLevelSuccess) {
        setGeneralSettingsChanged(false);
        setGeneralSettingsSuccess("Log level saved successfully!");
        // Dispatch custom event to notify other components
        window.dispatchEvent(new CustomEvent("generalSettingsSaved"));
      } else {
        // Settings failed - show which ones
        const errorMessage =
          errors.length > 0 ? `Failed to save: ${errors.join(", ")}` : "Failed to save log level";
        setGeneralSettingsSuccess(errorMessage);
        console.error("Log level failed to save:", {
          logLevelSuccess,
        });
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
  }, [localLogLevel]);

  const handleLogLevelChange = useCallback((newLevel) => {
    setLocalLogLevel(newLevel);
    setGeneralSettingsChanged(true);
    setGeneralSettingsSuccess("");
  }, []);

  return {
    isInitialized,
    logLevel,
    localLogLevel,
    handleLogLevelChange,
    generalSettingsChanged,
    generalSettingsSaving,
    generalSettingsSuccess,
    handleSaveGeneralSettings,
  };
}
