/**
 * Hook for checking developer mode status
 */

import { useState, useEffect } from "react";
import { graphqlClient } from "../../../../graphql/client";
import { USER_PREFERENCES_QUERY } from "../../../../graphql/queries";

/**
 * Hook to check if developer mode is enabled
 * @returns {Object} Developer mode state
 */
export const useDeveloperMode = () => {
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [checkingDeveloperMode, setCheckingDeveloperMode] = useState(true);

  useEffect(() => {
    const checkDeveloperMode = async () => {
      try {
        const { data, error } = await graphqlClient
          .query(USER_PREFERENCES_QUERY)
          .toPromise();
        if (error) throw error;
        setDeveloperModeEnabled(data?.userPreferences?.refreshingTogglesEnabled || false);
      } catch (err) {
        console.error("Error checking developer mode:", err);
        setDeveloperModeEnabled(false);
      } finally {
        setCheckingDeveloperMode(false);
      }
    };
    checkDeveloperMode();
  }, []);

  return { developerModeEnabled, checkingDeveloperMode };
};
