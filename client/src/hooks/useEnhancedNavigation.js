import { useCallback } from "react";
import { TAB_NAMES, SETTINGS_TABS } from "../constants/apiConstants";

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
  batchIntervalRef,
  batchInitialTimeoutRef,
  hasRunInitialPullRef,
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
    // Clear all error states on logout to prevent them from showing for the next user
    setError(null);
    setPullError(null);
    handleLogout();
    setActiveTab(TAB_NAMES.SUMMARY);
    // Reset initial pull flag on logout
    hasRunInitialPullRef.current = false;
    // Clear any running intervals
    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (batchInitialTimeoutRef.current) {
      clearTimeout(batchInitialTimeoutRef.current);
      batchInitialTimeoutRef.current = null;
    }
  }, [
    handleLogout,
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
    setActiveTab,
    setError,
    setPullError,
  ]);

  return {
    handleLoginWithNavigation,
    handlePasswordUpdateSuccessWithNavigation,
    handleLogoutWithCleanup,
  };
}
