import React from "react";
import PropTypes from "prop-types";
import styles from "./TabNavigation.module.css";

/**
 * TabNavigation Component
 * Reusable tab navigation component for consistent tab UI across the application
 */
const TabNavigation = React.memo(function TabNavigation({
  tabs,
  activeTab,
  onTabChange,
  labels,
  disabledTabs = [],
  className = "",
}) {
  return (
    <div className={`${styles.tabsContainer} ${className}`}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => {
          const isDisabled = disabledTabs.includes(tab);
          return (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ""} ${
                isDisabled ? styles.disabled : ""
              }`}
              onClick={() => !isDisabled && onTabChange(tab)}
              disabled={isDisabled}
              aria-selected={activeTab === tab}
              role="tab"
            >
              {labels[tab] || tab}
            </button>
          );
        })}
      </div>
    </div>
  );
});

TabNavigation.propTypes = {
  tabs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  labels: PropTypes.objectOf(PropTypes.string).isRequired,
  disabledTabs: PropTypes.arrayOf(PropTypes.string),
  className: PropTypes.string,
};

export default TabNavigation;
