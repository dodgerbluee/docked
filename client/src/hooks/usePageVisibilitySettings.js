import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * usePageVisibilitySettings Hook
 * Manages page visibility settings (disable Portainer/Tracked Apps pages)
 */
export function usePageVisibilitySettings() {
  const [disablePortainerPage, setDisablePortainerPage] = useState(false);
  const [disableTrackedAppsPage, setDisableTrackedAppsPage] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const [portainerRes, trackedAppsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/settings/disable-portainer-page`),
        axios.get(`${API_BASE_URL}/api/settings/disable-tracked-apps-page`),
      ]);

      if (portainerRes.data.success) {
        setDisablePortainerPage(portainerRes.data.disabled);
      }
      if (trackedAppsRes.data.success) {
        setDisableTrackedAppsPage(trackedAppsRes.data.disabled);
      }
    } catch (err) {
      console.error("Error fetching page visibility settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateDisablePortainerPage = useCallback(async (disabled) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/settings/disable-portainer-page`, {
        disabled,
      });
      if (response.data.success) {
        setDisablePortainerPage(disabled);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Error updating disable portainer page setting:", err);
      return false;
    }
  }, []);

  const updateDisableTrackedAppsPage = useCallback(async (disabled) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/settings/disable-tracked-apps-page`, {
        disabled,
      });
      if (response.data.success) {
        setDisableTrackedAppsPage(disabled);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Error updating disable tracked apps page setting:", err);
      return false;
    }
  }, []);

  return {
    disablePortainerPage,
    disableTrackedAppsPage,
    loading,
    updateDisablePortainerPage,
    updateDisableTrackedAppsPage,
    refreshSettings: fetchSettings,
  };
}
