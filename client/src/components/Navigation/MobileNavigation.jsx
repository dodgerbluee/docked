import React, { memo, useCallback } from "react";
import { MonitorSmartphone, BarChart3, Home, Layers, Cpu } from "lucide-react";
import PropTypes from "prop-types";
import { containerShape } from "../../utils/propTypes";
import { TAB_NAMES } from "../../constants/apiConstants";
import styles from "./MobileNavigation.module.css";

/**
 * MobileNavigation component
 * Bottom navigation bar for mobile devices
 */
const MobileNavigation = ({
  activeTab,
  onTabChange,
  containersWithUpdates = [],
  trackedAppsBehind = 0,
  appsWithUpdates = 0,
  darkMode,
  instanceAdmin,
  onThemeToggle,
  onLogout,
}) => {
  // Mobile menu removed — avatar will open menu options instead

  const handleTabChange = useCallback(
    (tab) => {
      onTabChange(tab);
    },
    [onTabChange]
  );

  return (
    <>
      {/* Mobile Bottom Navigation */}
      <nav className={styles.mobileNav} aria-label="Main navigation">
        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.SUMMARY ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.SUMMARY)}
          aria-label="Summary"
          aria-current={activeTab === TAB_NAMES.SUMMARY ? "page" : undefined}
        >
          <Home size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Summary</span>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.PORTAINER ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.PORTAINER)}
          aria-label={`Containers${containersWithUpdates.length > 0 ? `, ${containersWithUpdates.length} updates` : ""}`}
          aria-current={activeTab === TAB_NAMES.PORTAINER ? "page" : undefined}
        >
          <Layers size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Containers</span>
          {containersWithUpdates.length > 0 && (
            <span className={styles.navBadge} aria-hidden="true">
              {containersWithUpdates.length}
            </span>
          )}
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.APPS ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.APPS)}
          aria-label={`Apps${appsWithUpdates > 0 ? `, ${appsWithUpdates} updates` : ""}`}
          aria-current={activeTab === TAB_NAMES.APPS ? "page" : undefined}
        >
          <Cpu size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Apps</span>
          {appsWithUpdates > 0 && (
            <span className={styles.navBadge} aria-hidden="true">
              {appsWithUpdates}
            </span>
          )}
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.TRACKED_APPS ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.TRACKED_APPS)}
          aria-label={`Repos${trackedAppsBehind > 0 ? `, ${trackedAppsBehind} behind` : ""}`}
          aria-current={activeTab === TAB_NAMES.TRACKED_APPS ? "page" : undefined}
        >
          <MonitorSmartphone size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Repos</span>
          {trackedAppsBehind > 0 && (
            <span className={styles.navBadge} aria-hidden="true">
              {trackedAppsBehind}
            </span>
          )}
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.ANALYTICS ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.ANALYTICS)}
          aria-label="Analytics"
          aria-current={activeTab === TAB_NAMES.ANALYTICS ? "page" : undefined}
        >
          <BarChart3 size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Analytics</span>
        </button>

        {/* Removed menu button per mobile UX change; avatar opens menu now */}
      </nav>

      {/* Mobile slide-out menu removed */}
    </>
  );
};

MobileNavigation.propTypes = {
  activeTab: PropTypes.oneOf([
    TAB_NAMES.SUMMARY,
    TAB_NAMES.PORTAINER,
    TAB_NAMES.APPS,
    TAB_NAMES.TRACKED_APPS,
    TAB_NAMES.INTENTS,
    TAB_NAMES.ANALYTICS,
    TAB_NAMES.SETTINGS,
    TAB_NAMES.CONFIGURATION,
    TAB_NAMES.BATCH_LOGS,
    TAB_NAMES.ADMIN,
  ]).isRequired,
  onTabChange: PropTypes.func.isRequired,
  containersWithUpdates: PropTypes.arrayOf(containerShape),
  trackedAppsBehind: PropTypes.number,
  appsWithUpdates: PropTypes.number,
  darkMode: PropTypes.bool,
  instanceAdmin: PropTypes.bool,
  onThemeToggle: PropTypes.func,
  onLogout: PropTypes.func,
};

export default memo(MobileNavigation);
