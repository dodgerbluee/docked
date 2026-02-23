import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * useSSOProviders Hook
 * Manages SSO/OAuth provider CRUD and global SSO settings for the admin UI.
 */
export function useSSOProviders() {
  const [providers, setProviders] = useState([]);
  const [settings, setSettings] = useState({ allowLocalLogin: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProviders = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/admin/sso/providers`);
      if (response.data.success) {
        setProviders(response.data.providers || []);
      }
    } catch (err) {
      console.error("Error fetching SSO providers:", err);
      setError(err.response?.data?.error || "Failed to load SSO providers");
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/admin/sso/settings`);
      if (response.data.success) {
        setSettings(response.data.settings);
      }
    } catch (err) {
      console.error("Error fetching SSO settings:", err);
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchProviders(), fetchSettings()]);
    setLoading(false);
  }, [fetchProviders, fetchSettings]);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const createProvider = useCallback(
    async (providerData) => {
      const response = await axios.post(`${API_BASE_URL}/api/admin/sso/providers`, providerData);
      if (response.data.success) {
        await fetchProviders();
      }
      return response.data;
    },
    [fetchProviders]
  );

  const updateProvider = useCallback(
    async (id, providerData) => {
      const response = await axios.put(
        `${API_BASE_URL}/api/admin/sso/providers/${id}`,
        providerData
      );
      if (response.data.success) {
        await fetchProviders();
      }
      return response.data;
    },
    [fetchProviders]
  );

  const deleteProvider = useCallback(
    async (id) => {
      const response = await axios.delete(`${API_BASE_URL}/api/admin/sso/providers/${id}`);
      if (response.data.success) {
        await fetchProviders();
      }
      return response.data;
    },
    [fetchProviders]
  );

  const testConnection = useCallback(async (issuerUrl) => {
    const response = await axios.post(`${API_BASE_URL}/api/admin/sso/providers/test`, {
      issuerUrl,
    });
    return response.data;
  }, []);

  const updateSettings = useCallback(
    async (newSettings) => {
      const response = await axios.put(`${API_BASE_URL}/api/admin/sso/settings`, newSettings);
      if (response.data.success) {
        await fetchSettings();
      }
      return response.data;
    },
    [fetchSettings]
  );

  return {
    providers,
    settings,
    loading,
    error,
    createProvider,
    updateProvider,
    deleteProvider,
    testConnection,
    updateSettings,
    refreshProviders,
  };
}
