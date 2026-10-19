import { useCallback } from "react";
import { TAB_NAMES, SETTINGS_TABS } from "../constants/apiConstants";
import { revokeCurrentSession } from "../graphql/client";

/**
 * useEnhancedNavigation Hook
 * Provides enhanced navigation handlers with cleanup and menu management
 */
export function useEnhancedNavigation({
  handleLogin,
  handlePasswordUpdateSuccess,
  handleLogout,
  setActiveTab,
  setSettingsTab,
  setError,
  setPullError,
}) {
  const handleLoginWithNavigation = useCallback(
    (token, user, pwdChanged, role, isInstanceAdmin = false) => {
      handleLogin(token, user, pwdChanged, role, isInstanceAdmin);
      // If password not changed, show settings immediately with password section
      if (!pwdChanged) {
        setActiveTab(TAB_NAMES.SETTINGS);
        setSettingsTab(SETTINGS_TABS.USER_DETAILS);
      }
    },
    [handleLogin, setActiveTab, setSettingsTab]
  );

  const handlePasswordUpdateSuccessWithNavigation = useCallback(() => {
    handlePasswordUpdateSuccess();
    setActiveTab(TAB_NAMES.SUMMARY);
  }, [handlePasswordUpdateSuccess, setActiveTab]);

  const handleLogoutWithCleanup = useCallback(() => {
    // Revoke the presented token server-side (best-effort) before the local
    // clear wipes it, so a leaked token can't be replayed until its exp.
    revokeCurrentSession();
    // Clear all error states on logout to prevent them from showing for the next user
    setError(null);
    setPullError(null);
    handleLogout();
    setActiveTab(TAB_NAMES.SUMMARY);
  }, [handleLogout, setActiveTab, setError, setPullError]);

  return {
    handleLoginWithNavigation,
    handlePasswordUpdateSuccessWithNavigation,
    handleLogoutWithCleanup,
  };
}
