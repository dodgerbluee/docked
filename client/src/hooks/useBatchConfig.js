import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for batch configuration management
 * Handles fetching and updating batch configuration
 */
export const useBatchConfig = (isAuthenticated, authToken) => {
  const [batchConfig, setBatchConfig] = useState({
    "docker-hub-pull": { enabled: false, intervalMinutes: 60 },
    "tracked-apps-check": { enabled: false, intervalMinutes: 60 },
  });

  // Fetch batch configuration
  useEffect(() => {
    if (isAuthenticated && authToken) {
      const fetchBatchConfig = async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
          if (response.data.success) {
            const configs = response.data.config || {};
            // Ensure both job types exist with defaults
            setBatchConfig({
              "docker-hub-pull": configs["docker-hub-pull"] || {
                enabled: false,
                intervalMinutes: 60,
              },
              "tracked-apps-check": configs["tracked-apps-check"] || {
                enabled: false,
                intervalMinutes: 60,
              },
            });
          }
        } catch (err) {
          console.error("Error fetching batch config:", err);
        }
      };
      fetchBatchConfig();
    }
  }, [isAuthenticated, authToken]);

  // Memoize batch config update callback to prevent it from being recreated on every render
  const handleBatchConfigUpdate = useCallback(async () => {
    // Refetch batch config after update
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
      if (response.data.success) {
        const configs = response.data.config || {};
        // Ensure both job types exist with defaults
        const newConfigs = {
          "docker-hub-pull": configs["docker-hub-pull"] || {
            enabled: false,
            intervalMinutes: 60,
          },
          "tracked-apps-check": configs["tracked-apps-check"] || {
            enabled: false,
            intervalMinutes: 60,
          },
        };
        // Force state update with new object - this will trigger Context update
        setBatchConfig((prev) => {
          // Always return new object to ensure React detects the change
          return newConfigs;
        });
      }
    } catch (err) {
      console.error("Error refetching batch config:", err);
    }
  }, []);

  return {
    batchConfig,
    setBatchConfig,
    handleBatchConfigUpdate,
  };
};
