import React from "react";
import PropTypes from "prop-types";
import TabNavigation from "../ui/TabNavigation";
import { SETTINGS_TABS, SETTINGS_TAB_LABELS } from "../../constants/settings";

/**
 * SettingsTabNavigation Component
 * Renders the tab navigation buttons for the Settings page
 * Uses the reusable TabNavigation component for consistency
 */
const SettingsTabNavigation = React.memo(function SettingsTabNavigation({
  activeTab,
  onTabChange,
  developerModeEnabled = false,
}) {
  const tabs = [
    SETTINGS_TABS.GENERAL,
    SETTINGS_TABS.USER_DETAILS,
    SETTINGS_TABS.PORTAINER,
    SETTINGS_TABS.TRACKED_APPS,
    SETTINGS_TABS.REPOSITORIES,
    SETTINGS_TABS.DISCORD,
    // Only show Data tab if developer mode is enabled
    ...(developerModeEnabled ? [SETTINGS_TABS.DATA] : []),
  ];

  // No tabs are disabled
  const disabledTabs = [];

  return (
    <TabNavigation
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      labels={SETTINGS_TAB_LABELS}
      disabledTabs={disabledTabs}
    />
  );
});

SettingsTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  developerModeEnabled: PropTypes.bool,
};

export default SettingsTabNavigation;
