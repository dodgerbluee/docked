import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import {
  SSO_PROVIDERS_QUERY,
  SSO_SETTINGS_QUERY,
  CREATE_SSO_PROVIDER_MUTATION,
  UPDATE_SSO_PROVIDER_MUTATION,
  DELETE_SSO_PROVIDER_MUTATION,
  TEST_SSO_PROVIDER_MUTATION,
  SET_SSO_SETTINGS_MUTATION,
} from "../graphql/queries";

/**
 * useSSOProviders Hook
 * Manages SSO/OAuth provider CRUD and global SSO settings for the admin UI
 * (served by the GraphQL backend; all ops require instance admin).
 */
export function useSSOProviders() {
  const [providers, setProviders] = useState([]);
  const [settings, setSettings] = useState({ allowLocalLogin: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settingsError, setSettingsError] = useState(null);

  const fetchProviders = useCallback(async () => {
    try {
      const { data, error: gqlError } = await graphqlClient.query(SSO_PROVIDERS_QUERY).toPromise();
      if (gqlError) throw new Error(gqlError.message);
      setProviders(data?.ssoProviders || []);
    } catch (err) {
      console.error("Error fetching SSO providers:", err);
      setError(err.message || "Failed to load SSO providers");
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error: gqlError } = await graphqlClient.query(SSO_SETTINGS_QUERY).toPromise();
      if (gqlError) throw new Error(gqlError.message);
      if (data?.ssoSettings) {
        setSettings(data.ssoSettings);
        setSettingsError(null);
      }
    } catch (err) {
      console.error("Error fetching SSO settings:", err);
      // settings stays at its allowLocalLogin:true default. Without this the
      // admin sees the default, and saving writes that default over whatever
      // is actually stored - potentially re-enabling local logins they had
      // deliberately turned off.
      setSettingsError(err.message || "Failed to load SSO settings");
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
      const { error: gqlError } = await graphqlClient
        .mutation(CREATE_SSO_PROVIDER_MUTATION, { input: providerData })
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      await fetchProviders();
      return { success: true };
    },
    [fetchProviders]
  );

  const updateProvider = useCallback(
    async (id, providerData) => {
      const { error: gqlError } = await graphqlClient
        .mutation(UPDATE_SSO_PROVIDER_MUTATION, { id: String(id), input: providerData })
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      await fetchProviders();
      return { success: true };
    },
    [fetchProviders]
  );

  const deleteProvider = useCallback(
    async (id) => {
      const { error: gqlError } = await graphqlClient
        .mutation(DELETE_SSO_PROVIDER_MUTATION, { id: String(id) })
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      await fetchProviders();
      return { success: true };
    },
    [fetchProviders]
  );

  const testConnection = useCallback(async (issuerUrl) => {
    const { data, error: gqlError } = await graphqlClient
      .mutation(TEST_SSO_PROVIDER_MUTATION, { issuerUrl })
      .toPromise();
    if (gqlError) throw new Error(gqlError.message);
    return data?.testSSOProvider || { valid: false, error: "No result from test" };
  }, []);

  const updateSettings = useCallback(
    async (newSettings) => {
      if (settingsError) {
        return {
          success: false,
          error:
            "SSO settings could not be loaded, so saving is disabled. Saving now would replace them with defaults.",
        };
      }
      const { error: gqlError } = await graphqlClient
        .mutation(SET_SSO_SETTINGS_MUTATION, {
          allowLocalLogin: Boolean(newSettings.allowLocalLogin),
        })
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      await fetchSettings();
      return { success: true };
    },
    [fetchSettings, settingsError]
  );

  return {
    providers,
    settings,
    loading,
    error,
    settingsError,
    createProvider,
    updateProvider,
    deleteProvider,
    testConnection,
    updateSettings,
    refreshProviders,
  };
}
