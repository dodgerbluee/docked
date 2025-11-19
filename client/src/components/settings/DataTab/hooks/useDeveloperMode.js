/**
 * Hook for checking developer mode status
 */

import { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";

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
        const response = await axios.get(`${API_BASE_URL}/api/settings/refreshing-toggles-enabled`);
        if (response.data.success) {
          setDeveloperModeEnabled(response.data.enabled || false);
        }
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

