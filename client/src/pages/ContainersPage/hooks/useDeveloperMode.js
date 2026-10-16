/**
 * Hook for managing developer mode state
 */

import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../../../graphql/client";
import { USER_PREFERENCES_QUERY } from "../../../graphql/queries";

/**
 * Hook to manage developer mode state
 * @returns {Object} Developer mode state and fetch function
 */
export const useDeveloperMode = () => {
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);

  const fetchDeveloperMode = useCallback(async () => {
    try {
      const { data, error } = await graphqlClient.query(USER_PREFERENCES_QUERY).toPromise();
      if (error) throw error;
      setDeveloperModeEnabled(data?.userPreferences?.refreshingTogglesEnabled || false);
    } catch (err) {
      // If the query fails, default to false
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
