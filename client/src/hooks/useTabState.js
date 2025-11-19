import { useState, useCallback } from "react";
import {
  TAB_NAMES,
  CONTENT_TABS,
  SETTINGS_TABS,
  CONFIGURATION_TABS,
} from "../constants/apiConstants";

/**
 * useTabState Hook
 * Manages all tab-related state (active tab, content tab, settings tab, configuration tab)
 */
export function useTabState() {
  const [activeTab, setActiveTab] = useState(TAB_NAMES.SUMMARY);
  const [contentTab, setContentTab] = useState(CONTENT_TABS.UPDATES);
  const [settingsTab, setSettingsTab] = useState(SETTINGS_TABS.GENERAL);
  const [configurationTab, setConfigurationTab] = useState(CONFIGURATION_TABS.HISTORY);

  const navigateToTab = useCallback((tab, options = {}) => {
    setActiveTab(tab);
    if (options.contentTab !== undefined) setContentTab(options.contentTab);
    if (options.settingsTab !== undefined) setSettingsTab(options.settingsTab);
    if (options.configurationTab !== undefined) setConfigurationTab(options.configurationTab);
  }, []);

  return {
    activeTab,
    contentTab,
    settingsTab,
    configurationTab,
    setActiveTab,
    setContentTab,
    setSettingsTab,
    setConfigurationTab,
    navigateToTab,
  };
}
