/**
 * Settings Component (Refactored)
 * Uses useSettings hook and individual tab components
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import "./Settings.css";
import { useSettings } from "../hooks/useSettings";
import { SETTINGS_TABS } from "../constants/settings";
import LoadingSpinner from "./ui/LoadingSpinner";
import GeneralTab from "./settings/GeneralTab";
import PortainerTab from "./settings/PortainerTab";
import DockerHubTab from "./settings/DockerHubTab";
import DiscordTab from "./settings/DiscordTab";
import UserDetailsTab from "./settings/UserDetailsTab";
import CacheTab from "./settings/CacheTab";

const Settings = React.memo(function Settings({
  username,
  onUsernameUpdate,
  onLogout,
  isFirstLogin = false,
  onPasswordUpdateSuccess,
  onPortainerInstancesChange,
  activeSection = "general",
  onSectionChange = null,
  showUserInfoAboveTabs = false,
  onEditInstance = null,
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onBatchConfigUpdate = null,
  colorScheme = "system",
  onColorSchemeChange = null,
  refreshInstances = null,
  onClearPortainerData = null,
  onClearTrackedAppData = null,
}) {
  // Memoize callbacks to avoid stale closures and prevent unnecessary re-renders
  const handleBatchConfigUpdate = useCallback(
    (config) => {
      if (onBatchConfigUpdate) {
        onBatchConfigUpdate(config);
      }
    },
    [onBatchConfigUpdate]
  );

  const handleAvatarChange = useCallback(
    (avatar) => {
      if (onAvatarChange) {
        onAvatarChange(avatar);
      }
    },
    [onAvatarChange]
  );
  
  // Memoize onPortainerInstancesChange to prevent re-renders when container state changes
  const handlePortainerInstancesChange = useCallback(async () => {
    if (onPortainerInstancesChange) {
      await onPortainerInstancesChange();
    }
  }, [onPortainerInstancesChange]);
  
  // Memoize onColorSchemeChange to prevent re-renders
  const handleColorSchemeChange = useCallback(
    (scheme) => {
      if (onColorSchemeChange) {
        onColorSchemeChange(scheme);
      }
    },
    [onColorSchemeChange]
  );

  // Memoize useSettings inputs to prevent re-initialization when parent re-renders
  const settingsInputs = useMemo(
    () => ({
      username,
      onUsernameUpdate,
      onPasswordUpdateSuccess,
      onPortainerInstancesChange: handlePortainerInstancesChange,
      onAvatarChange: handleAvatarChange,
      onBatchConfigUpdate: handleBatchConfigUpdate,
      isFirstLogin,
      colorScheme,
      onColorSchemeChange: handleColorSchemeChange,
      refreshInstances,
      activeSection,
    }),
    [
      username,
      onUsernameUpdate,
      onPasswordUpdateSuccess,
      handlePortainerInstancesChange,
      handleAvatarChange,
      handleBatchConfigUpdate,
      isFirstLogin,
      colorScheme,
      handleColorSchemeChange,
      refreshInstances,
      activeSection,
    ]
  );

  // Use the useSettings hook for all state and API calls
  const settings = useSettings(settingsInputs);

  // Use prop if provided, otherwise use internal state
  const [internalActiveSection, setInternalActiveSection] = useState(activeSection);

  // If first login, always show user details tab (password section is now in User tab)
  // BUT: if activeSection is explicitly LOGS, respect it (for URL routing)
  const currentActiveSection =
    isFirstLogin && activeSection !== SETTINGS_TABS.LOGS
      ? SETTINGS_TABS.USER_DETAILS
      : activeSection || internalActiveSection;
  // eslint-disable-next-line no-unused-vars
  const setActiveSection = onSectionChange || setInternalActiveSection;

  // Local state for data clearing operations
  const [clearingPortainerData, setClearingPortainerData] = useState(false);
  const [clearingTrackedAppData, setClearingTrackedAppData] = useState(false);
  
  // Store stable references to clear handlers using refs to prevent re-renders
  // when parent component re-renders due to container state changes
  const onClearPortainerDataRef = useRef(onClearPortainerData);
  const onClearTrackedAppDataRef = useRef(onClearTrackedAppData);
  
  // Update refs when props change, but don't trigger re-renders
  useEffect(() => {
    onClearPortainerDataRef.current = onClearPortainerData;
  }, [onClearPortainerData]);
  
  useEffect(() => {
    onClearTrackedAppDataRef.current = onClearTrackedAppData;
  }, [onClearTrackedAppData]);
  
  // Wrap onClearPortainerData to track clearing state locally
  // This prevents flickering by managing state locally instead of relying on parent re-renders
  // Use refs to access the latest handlers without causing re-renders
  const handleClearPortainerData = useCallback(async () => {
    if (!onClearPortainerDataRef.current) return;
    
    try {
      setClearingPortainerData(true);
      await onClearPortainerDataRef.current();
    } catch (error) {
      console.error("Error clearing Portainer data:", error);
    } finally {
      // Use setTimeout to ensure state updates complete before resetting
      setTimeout(() => {
        setClearingPortainerData(false);
      }, 100);
    }
  }, []); // Empty deps - use refs instead
  
  // Wrap onClearTrackedAppData to track clearing state locally
  const handleClearTrackedAppData = useCallback(async () => {
    if (!onClearTrackedAppDataRef.current) return;
    
    try {
      setClearingTrackedAppData(true);
      await onClearTrackedAppDataRef.current();
    } catch (error) {
      console.error("Error clearing tracked app data:", error);
    } finally {
      // Use setTimeout to ensure state updates complete before resetting
      setTimeout(() => {
        setClearingTrackedAppData(false);
      }, 100);
    }
  }, []); // Empty deps - use refs instead

  // Track previous color scheme to detect user-initiated changes
  const prevColorSchemeRef = useRef(colorScheme);
  
  // Sync local color scheme changes - only when user actually changes it
  // Don't trigger on initial mount or when settings object changes
  useEffect(() => {
    // Only mark as changed if the user actually changed the color scheme
    // (not on initial mount or when settings object reference changes)
    if (prevColorSchemeRef.current !== settings.localColorScheme && prevColorSchemeRef.current !== undefined) {
      settings.setGeneralSettingsChanged(true);
    }
    prevColorSchemeRef.current = settings.localColorScheme;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.localColorScheme, settings.setGeneralSettingsChanged]);

         // Sync activeSection prop to internal state
         useEffect(() => {
           if (isFirstLogin) {
             if (onSectionChange) {
               onSectionChange(SETTINGS_TABS.USER_DETAILS);
             } else {
               setInternalActiveSection(SETTINGS_TABS.USER_DETAILS);
             }
           } else if (activeSection) {
             // Always sync when activeSection prop changes
             setInternalActiveSection(activeSection);
           }
         }, [isFirstLogin, activeSection, onSectionChange]);

  // Render user info section
  const renderUserInfo = () => {
    if (!settings.userInfo) return null;

    return (
      <div className="user-info-section">
        <h3>User Information</h3>
        <div className="info-item">
          <strong>Username:</strong> {settings.userInfo.username}
        </div>
        <div className="info-item">
          <strong>Role:</strong> {settings.userInfo.role}
        </div>
        {settings.userInfo.created_at && (
          <div className="info-item">
            <strong>Account Created:</strong>{" "}
            {new Date(settings.userInfo.created_at).toLocaleDateString()}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {isFirstLogin && (
        <div className="first-login-warning">
          <h2>
            <AlertTriangle
              size={20}
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginRight: "8px",
              }}
            />
            First Time Login
          </h2>
          <p>You must change your password before accessing the application.</p>
        </div>
      )}

      {showUserInfoAboveTabs && renderUserInfo()}

      {!showUserInfoAboveTabs && (
        <>
          {currentActiveSection === SETTINGS_TABS.GENERAL && (
            <>
              {!settings.isInitialized ? (
                <LoadingSpinner size="md" message="Loading settings..." />
              ) : (
                <GeneralTab
                  localColorScheme={settings.localColorScheme}
                  setLocalColorScheme={(scheme) => {
                    settings.setLocalColorScheme(scheme);
                    settings.setGeneralSettingsChanged(true);
                  }}
                  localLogLevel={settings.localLogLevel}
                  handleLogLevelChange={settings.handleLogLevelChange}
                  localRefreshingTogglesEnabled={settings.localRefreshingTogglesEnabled}
                  handleRefreshingTogglesChange={settings.handleRefreshingTogglesChange}
                  generalSettingsChanged={settings.generalSettingsChanged}
                  generalSettingsSaving={settings.generalSettingsSaving}
                  generalSettingsSuccess={settings.generalSettingsSuccess}
                  handleSaveGeneralSettings={settings.handleSaveGeneralSettings}
                  onClearTrackedAppData={handleClearTrackedAppData}
                  clearingTrackedAppData={clearingTrackedAppData}
                />
              )}
            </>
          )}

          {currentActiveSection === SETTINGS_TABS.PORTAINER && (
            <PortainerTab
              portainerInstances={settings.portainerInstances}
              onEditInstance={onEditInstance}
              handleEditInstance={settings.handleEditInstance}
              handleDeleteInstance={settings.handleDeleteInstance}
              onClearPortainerData={handleClearPortainerData}
              clearingPortainerData={clearingPortainerData}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.DOCKERHUB && (
            <DockerHubTab
              dockerHubCredentials={settings.dockerHubCredentials}
              showDockerHubModal={settings.showDockerHubModal}
              setShowDockerHubModal={settings.setShowDockerHubModal}
              dockerHubSuccess={settings.dockerHubSuccess}
              handleDockerHubModalSuccess={settings.handleDockerHubModalSuccess}
              handleDeleteDockerHubCreds={settings.handleDeleteDockerHubCreds}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.DISCORD && (
            <DiscordTab
              discordWebhooks={settings.discordWebhooks}
              showDiscordModal={settings.showDiscordModal}
              setShowDiscordModal={settings.setShowDiscordModal}
              editingDiscordWebhook={settings.editingDiscordWebhook}
              setEditingDiscordWebhook={settings.setEditingDiscordWebhook}
              discordSuccess={settings.discordSuccess}
              handleDiscordModalSuccess={settings.handleDiscordModalSuccess}
              handleDeleteDiscordWebhook={settings.handleDeleteDiscordWebhook}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.USER_DETAILS && (
            <UserDetailsTab
              userInfo={settings.userInfo}
              newUsername={settings.newUsername}
              setNewUsername={settings.setNewUsername}
              usernamePassword={settings.usernamePassword}
              setUsernamePassword={settings.setUsernamePassword}
              usernameError={settings.usernameError}
              usernameSuccess={settings.usernameSuccess}
              usernameLoading={settings.usernameLoading}
              handleUsernameSubmit={settings.handleUsernameSubmit}
              isFirstLogin={isFirstLogin}
              currentPassword={settings.currentPassword}
              setCurrentPassword={settings.setCurrentPassword}
              newPassword={settings.newPassword}
              setNewPassword={settings.setNewPassword}
              confirmPassword={settings.confirmPassword}
              setConfirmPassword={settings.setConfirmPassword}
              passwordError={settings.passwordError}
              passwordSuccess={settings.passwordSuccess}
              passwordLoading={settings.passwordLoading}
              handlePasswordSubmit={settings.handlePasswordSubmit}
              avatar={avatar}
              recentAvatars={recentAvatars}
              onAvatarChange={onAvatarChange}
              onRecentAvatarsChange={onRecentAvatarsChange}
              onAvatarUploaded={onAvatarUploaded}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.CACHE &&
            settings.localRefreshingTogglesEnabled && <CacheTab />}
        </>
      )}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent re-renders when container state changes
  // Only re-render if props that Settings actually cares about have changed
  // Note: onClearPortainerData and onClearTrackedAppData are intentionally excluded
  // because we use refs to store them, so reference changes don't matter
  return (
    prevProps.username === nextProps.username &&
    prevProps.isFirstLogin === nextProps.isFirstLogin &&
    prevProps.activeSection === nextProps.activeSection &&
    prevProps.showUserInfoAboveTabs === nextProps.showUserInfoAboveTabs &&
    prevProps.colorScheme === nextProps.colorScheme &&
    prevProps.avatar === nextProps.avatar &&
    JSON.stringify(prevProps.recentAvatars) === JSON.stringify(nextProps.recentAvatars) &&
    // For function props, we compare by reference - they should be stable due to useCallback/useRef
    prevProps.onUsernameUpdate === nextProps.onUsernameUpdate &&
    prevProps.onLogout === nextProps.onLogout &&
    prevProps.onPasswordUpdateSuccess === nextProps.onPasswordUpdateSuccess &&
    prevProps.onPortainerInstancesChange === nextProps.onPortainerInstancesChange &&
    prevProps.onAvatarChange === nextProps.onAvatarChange &&
    prevProps.onRecentAvatarsChange === nextProps.onRecentAvatarsChange &&
    prevProps.onAvatarUploaded === nextProps.onAvatarUploaded &&
    prevProps.onBatchConfigUpdate === nextProps.onBatchConfigUpdate &&
    prevProps.onColorSchemeChange === nextProps.onColorSchemeChange &&
    // onClearPortainerData and onClearTrackedAppData excluded - we use refs, so reference changes don't matter
    prevProps.onEditInstance === nextProps.onEditInstance &&
    prevProps.onSectionChange === nextProps.onSectionChange &&
    prevProps.refreshInstances === nextProps.refreshInstances
  );
});

export default Settings;
