/**
 * Settings Component (Refactored)
 * Uses useSettings hook and individual tab components
 */

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import "./Settings.css";
import { useSettings } from "../hooks/useSettings";
import { SETTINGS_TABS } from "../constants/settings";
import GeneralTab from "./settings/GeneralTab";
import UsernameTab from "./settings/UsernameTab";
import PasswordTab from "./settings/PasswordTab";
import PortainerTab from "./settings/PortainerTab";
import AvatarTab from "./settings/AvatarTab";
import DockerHubTab from "./settings/DockerHubTab";
import DiscordTab from "./settings/DiscordTab";
import UserDetailsTab from "./settings/UserDetailsTab";
import LogsTab from "./settings/LogsTab";

function Settings({
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
  // Memoize callbacks to avoid stale closures
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

  // Use the useSettings hook for all state and API calls
  const settings = useSettings({
    username,
    onUsernameUpdate,
    onPasswordUpdateSuccess,
    onPortainerInstancesChange,
    onAvatarChange: handleAvatarChange,
    onBatchConfigUpdate: handleBatchConfigUpdate,
    isFirstLogin,
    colorScheme,
    onColorSchemeChange,
    refreshInstances,
    activeSection,
  });

  // Use prop if provided, otherwise use internal state
  const [internalActiveSection, setInternalActiveSection] = useState(activeSection);

  // If first login, always show password section regardless of activeSection prop
  // BUT: if activeSection is explicitly LOGS, respect it (for URL routing)
  const currentActiveSection =
    isFirstLogin && activeSection !== SETTINGS_TABS.LOGS
      ? SETTINGS_TABS.PASSWORD
      : activeSection || internalActiveSection;
  // eslint-disable-next-line no-unused-vars
  const setActiveSection = onSectionChange || setInternalActiveSection;

  // Local state for data clearing operations
  // eslint-disable-next-line no-unused-vars
  const [clearingPortainerData, setClearingPortainerData] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [clearingTrackedAppData, setClearingTrackedAppData] = useState(false);

  // Sync local color scheme changes
  useEffect(() => {
    if (settings.localColorScheme !== colorScheme) {
      settings.setGeneralSettingsChanged(true);
    }
  }, [settings.localColorScheme, colorScheme, settings]);

  // Sync activeSection prop to internal state
  useEffect(() => {
    if (isFirstLogin) {
      if (onSectionChange) {
        onSectionChange(SETTINGS_TABS.PASSWORD);
      } else {
        setInternalActiveSection(SETTINGS_TABS.PASSWORD);
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
              onClearPortainerData={onClearPortainerData}
              onClearTrackedAppData={onClearTrackedAppData}
              clearingPortainerData={clearingPortainerData}
              clearingTrackedAppData={clearingTrackedAppData}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.USERNAME && (
            <UsernameTab
              newUsername={settings.newUsername}
              setNewUsername={settings.setNewUsername}
              usernamePassword={settings.usernamePassword}
              setUsernamePassword={settings.setUsernamePassword}
              usernameError={settings.usernameError}
              usernameSuccess={settings.usernameSuccess}
              usernameLoading={settings.usernameLoading}
              handleUsernameSubmit={settings.handleUsernameSubmit}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.PASSWORD && (
            <PasswordTab
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
            />
          )}

          {currentActiveSection === SETTINGS_TABS.AVATAR && (
            <AvatarTab
              avatar={avatar}
              recentAvatars={recentAvatars}
              onAvatarChange={onAvatarChange}
              onRecentAvatarsChange={onRecentAvatarsChange}
              onAvatarUploaded={onAvatarUploaded}
            />
          )}

          {currentActiveSection === SETTINGS_TABS.PORTAINER && (
            <PortainerTab
              portainerInstances={settings.portainerInstances}
              onEditInstance={onEditInstance}
              handleEditInstance={settings.handleEditInstance}
              handleDeleteInstance={settings.handleDeleteInstance}
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
            <UserDetailsTab userInfo={settings.userInfo} />
          )}

          {currentActiveSection === SETTINGS_TABS.LOGS && <LogsTab />}
        </>
      )}
    </>
  );
}

export default Settings;
