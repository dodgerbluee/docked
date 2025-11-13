import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Home } from "lucide-react";
import ErrorBoundary from "../components/ErrorBoundary";
import Settings from "../components/Settings";
import SettingsTabNavigation from "../components/settings/SettingsTabNavigation";
import Button from "../components/ui/Button";
import { SETTINGS_TABS } from "../constants/settings";
import styles from "./SettingsPage.module.css";

/**
 * SettingsPage Component
 * Main page component for the Settings section with tab navigation
 */
function SettingsPage({
  username,
  passwordChanged,
  avatar,
  recentAvatars,
  onUsernameUpdate,
  onLogout,
  onPasswordUpdateSuccess,
  onPortainerInstancesChange,
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onBatchConfigUpdate,
  colorScheme,
  onColorSchemeChange,
  onClearPortainerData,
  onClearTrackedAppData,
  onEditInstance,
  editingPortainerInstance,
  refreshInstances,
  onReturnHome,
  activeTab: controlledActiveTab,
  onTabChange: onControlledTabChange,
}) {
  const [internalTab, setInternalTab] = useState(
    controlledActiveTab || SETTINGS_TABS.GENERAL
  );

  // Use controlled tab if provided, otherwise use internal state
  const settingsTab = controlledActiveTab !== undefined ? controlledActiveTab : internalTab;
  
  // If first login, force password tab
  const activeTab = !passwordChanged ? SETTINGS_TABS.PASSWORD : settingsTab;

  const handleTabChange = useCallback((tab) => {
    if (onControlledTabChange) {
      onControlledTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  }, [onControlledTabChange]);

  const handleRecentAvatarsChange = useCallback(
    (avatars) => {
      if (onRecentAvatarsChange) {
        onRecentAvatarsChange(avatars);
      }
    },
    [onRecentAvatarsChange]
  );

  const handlePortainerInstancesChange = useCallback(async () => {
    if (onPortainerInstancesChange) {
      await onPortainerInstancesChange();
    }
  }, [onPortainerInstancesChange]);

  return (
    <div className={styles.settingsPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.settingsHeader}>Settings</h2>
          {onReturnHome && (
            <Button
              onClick={onReturnHome}
              variant="outline"
              icon={Home}
              iconPosition="left"
              className={styles.returnHomeButton}
            >
              Return Home
            </Button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <SettingsTabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        passwordChanged={passwordChanged}
      />

      {/* Tab Content */}
      <div className={styles.contentTabPanel}>
        <ErrorBoundary>
          <Settings
            username={username}
            onUsernameUpdate={onUsernameUpdate}
            onLogout={onLogout}
            isFirstLogin={!passwordChanged}
            avatar={avatar}
            recentAvatars={recentAvatars}
            onAvatarChange={onAvatarChange}
            onRecentAvatarsChange={handleRecentAvatarsChange}
            onAvatarUploaded={onAvatarUploaded}
            onPasswordUpdateSuccess={onPasswordUpdateSuccess}
            onPortainerInstancesChange={handlePortainerInstancesChange}
            activeSection={activeTab}
            onSectionChange={handleTabChange}
            showUserInfoAboveTabs={false}
            onEditInstance={onEditInstance}
            refreshInstances={
              editingPortainerInstance === null ? refreshInstances : null
            }
            onBatchConfigUpdate={onBatchConfigUpdate}
            colorScheme={colorScheme}
            onColorSchemeChange={onColorSchemeChange}
            onClearPortainerData={onClearPortainerData}
            onClearTrackedAppData={onClearTrackedAppData}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

SettingsPage.propTypes = {
  username: PropTypes.string.isRequired,
  passwordChanged: PropTypes.bool.isRequired,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onUsernameUpdate: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  onPasswordUpdateSuccess: PropTypes.func.isRequired,
  onPortainerInstancesChange: PropTypes.func,
  onAvatarChange: PropTypes.func,
  onRecentAvatarsChange: PropTypes.func,
  onAvatarUploaded: PropTypes.func,
  onBatchConfigUpdate: PropTypes.func,
  colorScheme: PropTypes.string,
  onColorSchemeChange: PropTypes.func,
  onClearPortainerData: PropTypes.func,
  onClearTrackedAppData: PropTypes.func,
  onEditInstance: PropTypes.func,
  editingPortainerInstance: PropTypes.object,
  refreshInstances: PropTypes.func,
  onReturnHome: PropTypes.func,
  activeTab: PropTypes.string,
  onTabChange: PropTypes.func,
};

export default SettingsPage;

