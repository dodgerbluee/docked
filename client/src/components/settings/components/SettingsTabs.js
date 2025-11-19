/**
 * Settings tabs component
 */

import React from "react";
import PropTypes from "prop-types";
import LoadingSpinner from "../../ui/LoadingSpinner";
import GeneralTab from "../GeneralTab";
import PortainerTab from "../PortainerTab";
import DockerHubTab from "../DockerHubTab";
import DiscordTab from "../DiscordTab";
import UserDetailsTab from "../UserDetailsTab";
import DataTab from "../DataTab";
import { SETTINGS_TABS } from "../../../constants/settings";

/**
 * Settings tabs component
 * @param {Object} props
 * @param {string} props.currentActiveSection - Current active section
 * @param {Object} props.settings - Settings object from useSettings hook
 * @param {boolean} props.isFirstLogin - Whether this is first login
 * @param {Object} props.avatar - Avatar object
 * @param {Array} props.recentAvatars - Recent avatars array
 * @param {Function} props.onAvatarChange - Avatar change handler
 * @param {Function} props.onRecentAvatarsChange - Recent avatars change handler
 * @param {Function} props.onAvatarUploaded - Avatar uploaded handler
 * @param {Function} props.onEditInstance - Edit instance handler
 * @param {Function} props.handleClearPortainerData - Clear Portainer data handler
 * @param {Function} props.handleClearTrackedAppData - Clear tracked app data handler
 * @param {boolean} props.clearingPortainerData - Whether clearing Portainer data
 * @param {boolean} props.clearingTrackedAppData - Whether clearing tracked app data
 */
const SettingsTabs = ({
  currentActiveSection,
  settings,
  isFirstLogin,
  avatar,
  recentAvatars,
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onEditInstance,
  handleClearPortainerData,
  handleClearTrackedAppData,
  clearingPortainerData,
  clearingTrackedAppData,
}) => {
  if (currentActiveSection === SETTINGS_TABS.GENERAL) {
    return (
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
    );
  }

  if (currentActiveSection === SETTINGS_TABS.PORTAINER) {
    return (
      <PortainerTab
        portainerInstances={settings.portainerInstances}
        onEditInstance={onEditInstance}
        handleEditInstance={settings.handleEditInstance}
        handleDeleteInstance={settings.handleDeleteInstance}
        onClearPortainerData={handleClearPortainerData}
        clearingPortainerData={clearingPortainerData}
      />
    );
  }

  if (currentActiveSection === SETTINGS_TABS.DOCKERHUB) {
    return (
      <DockerHubTab
        dockerHubCredentials={settings.dockerHubCredentials}
        showDockerHubModal={settings.showDockerHubModal}
        setShowDockerHubModal={settings.setShowDockerHubModal}
        dockerHubSuccess={settings.dockerHubSuccess}
        handleDockerHubModalSuccess={settings.handleDockerHubModalSuccess}
        handleDeleteDockerHubCreds={settings.handleDeleteDockerHubCreds}
      />
    );
  }

  if (currentActiveSection === SETTINGS_TABS.DISCORD) {
    return (
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
    );
  }

  if (currentActiveSection === SETTINGS_TABS.USER_DETAILS) {
    return (
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
    );
  }

  if (currentActiveSection === SETTINGS_TABS.DATA && settings.localRefreshingTogglesEnabled) {
    return <DataTab />;
  }

  return null;
};

SettingsTabs.propTypes = {
  currentActiveSection: PropTypes.string.isRequired,
  settings: PropTypes.object.isRequired,
  isFirstLogin: PropTypes.bool.isRequired,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.array,
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func.isRequired,
  onAvatarUploaded: PropTypes.func.isRequired,
  onEditInstance: PropTypes.func,
  handleClearPortainerData: PropTypes.func.isRequired,
  handleClearTrackedAppData: PropTypes.func.isRequired,
  clearingPortainerData: PropTypes.bool.isRequired,
  clearingTrackedAppData: PropTypes.bool.isRequired,
};

export default SettingsTabs;

