import React, { useMemo } from "react";
import PropTypes from "prop-types";
import Header from "../components/Header/Header";
import SettingsPage from "./SettingsPage";
import { SETTINGS_TABS } from "../constants/settings";
import { useRouterNavigation } from "../hooks/useRouterNavigation";

/**
 * LogsPage Component
 * A dedicated page for the Logs tab that uses React Router
 * This component wraps SettingsPage and forces it to show the Logs tab
 */
function LogsPage({
  // Header props
  headerProps,
  // Settings props
  settingsProps,
  // Navigation handlers (will be wrapped with router navigation)
  onNavigateToSummary,
  onNavigateToSettings,
  onNavigateToBatch,
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  // Other props
  onSetSettingsTab,
  API_BASE_URL,
}) {
  // Wrap navigation handlers to navigate to home route first
  const routerNavigation = useRouterNavigation({
    onNavigateToSummary,
    onNavigateToSettings,
    onNavigateToBatch,
    onNavigateToPortainer,
    onNavigateToTrackedApps,
  });

  // Memoize header props to prevent unnecessary re-renders
  const memoizedHeaderProps = useMemo(
    () => ({
      ...headerProps,
      ...routerNavigation,
    }),
    [headerProps, routerNavigation]
  );

  // Memoize settings props to prevent unnecessary re-renders
  const memoizedSettingsProps = useMemo(
    () => ({
      ...settingsProps,
      activeTab: SETTINGS_TABS.LOGS,
      onTabChange: onSetSettingsTab,
      hideTabNavigation: true,
    }),
    [settingsProps, onSetSettingsTab]
  );

  return (
    <div className="App">
      <Header {...memoizedHeaderProps} API_BASE_URL={API_BASE_URL} />

      <div className="container">
        <SettingsPage {...memoizedSettingsProps} />
      </div>
    </div>
  );
}

LogsPage.propTypes = {
  headerProps: PropTypes.shape({
    username: PropTypes.string.isRequired,
    userRole: PropTypes.string,
    avatar: PropTypes.string,
    darkMode: PropTypes.bool.isRequired,
    showAvatarMenu: PropTypes.bool.isRequired,
    onToggleAvatarMenu: PropTypes.func.isRequired,
    onTemporaryThemeToggle: PropTypes.func.isRequired,
    onLogout: PropTypes.func.isRequired,
  }).isRequired,
  settingsProps: PropTypes.shape({
    username: PropTypes.string.isRequired,
    avatar: PropTypes.string,
    recentAvatars: PropTypes.array,
    onUsernameUpdate: PropTypes.func.isRequired,
    onLogout: PropTypes.func.isRequired,
    onPasswordUpdateSuccess: PropTypes.func.isRequired,
    onPortainerInstancesChange: PropTypes.func.isRequired,
    onAvatarChange: PropTypes.func.isRequired,
    onRecentAvatarsChange: PropTypes.func.isRequired,
    onAvatarUploaded: PropTypes.func.isRequired,
    onBatchConfigUpdate: PropTypes.func.isRequired,
    colorScheme: PropTypes.string.isRequired,
    onColorSchemeChange: PropTypes.func.isRequired,
    onClearPortainerData: PropTypes.func.isRequired,
    onClearTrackedAppData: PropTypes.func.isRequired,
    onEditInstance: PropTypes.func.isRequired,
    editingPortainerInstance: PropTypes.object,
    refreshInstances: PropTypes.func,
  }).isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onNavigateToSettings: PropTypes.func.isRequired,
  onNavigateToBatch: PropTypes.func.isRequired,
  onNavigateToPortainer: PropTypes.func.isRequired,
  onNavigateToTrackedApps: PropTypes.func.isRequired,
  onSetSettingsTab: PropTypes.func.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
};

// Memoize component to prevent unnecessary re-renders
export default React.memo(LogsPage);
