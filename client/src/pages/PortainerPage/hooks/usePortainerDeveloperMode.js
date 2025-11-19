/**
 * Hook for managing Portainer developer mode state
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";

/**
 * Hook to manage developer mode state
 * @returns {Object} Developer mode state and fetch function
 */
export const usePortainerDeveloperMode = () => {
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);

  const fetchDeveloperMode = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/settings/refreshing-toggles-enabled`);
      if (response.data.success) {
        setDeveloperModeEnabled(response.data.enabled || false);
      }
    } catch (err) {
      // If endpoint doesn't exist yet, default to false
      console.error("Error fetching developer mode:", err);
      setDeveloperModeEnabled(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchDeveloperMode();
  }, [fetchDeveloperMode]);

  // Listen for settings save events to refetch developer mode
  useEffect(() => {
    const handleSettingsSaved = () => {
      fetchDeveloperMode();
    };
    window.addEventListener("generalSettingsSaved", handleSettingsSaved);
    return () => {
      window.removeEventListener("generalSettingsSaved", handleSettingsSaved);
    };
  }, [fetchDeveloperMode]);

  return {
    developerModeEnabled,
    fetchDeveloperMode,
  };
};

