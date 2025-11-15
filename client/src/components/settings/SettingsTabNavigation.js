import React from "react";
import PropTypes from "prop-types";
import styles from "./SettingsTabNavigation.module.css";
import { SETTINGS_TABS, SETTINGS_TAB_LABELS } from "../../constants/settings";

/**
 * SettingsTabNavigation Component
 * Renders the tab navigation buttons for the Settings page
 */
function SettingsTabNavigation({ activeTab, onTabChange, passwordChanged }) {
  const tabs = [
    SETTINGS_TABS.GENERAL,
    SETTINGS_TABS.USERNAME,
    SETTINGS_TABS.PASSWORD,
    SETTINGS_TABS.AVATAR,
    SETTINGS_TABS.PORTAINER,
    SETTINGS_TABS.DOCKERHUB,
    SETTINGS_TABS.DISCORD,
    SETTINGS_TABS.USER_DETAILS,
    SETTINGS_TABS.LOGS,
  ];

  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => {
          const isDisabled = tab !== SETTINGS_TABS.PASSWORD && !passwordChanged;
          return (
            <button
              key={tab}
              className={`${styles.tab} ${
                activeTab === tab ? styles.active : ""
              }`}
              onClick={() => onTabChange(tab)}
              disabled={isDisabled}
            >
              {SETTINGS_TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

SettingsTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  passwordChanged: PropTypes.bool.isRequired,
};

export default SettingsTabNavigation;

