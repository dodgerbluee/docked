import React from "react";
import PropTypes from "prop-types";
import styles from "./PortainerTabNavigation.module.css";
import { PORTAINER_CONTENT_TABS, PORTAINER_CONTENT_TAB_LABELS } from "../../constants/portainerPage";

/**
 * PortainerTabNavigation Component
 * Renders the tab navigation buttons for the Portainer page content tabs
 */
const PortainerTabNavigation = React.memo(function PortainerTabNavigation({ 
  activeTab, 
  onTabChange,
  toolbarActions 
}) {
  const tabs = [
    PORTAINER_CONTENT_TABS.UPDATES,
    PORTAINER_CONTENT_TABS.CURRENT,
    PORTAINER_CONTENT_TABS.UNUSED,
  ];

  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${
              activeTab === tab ? styles.active : ""
            }`}
            onClick={() => onTabChange(tab)}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${tab}-panel`}
            id={`${tab}-tab`}
          >
            {PORTAINER_CONTENT_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {toolbarActions && (
        <div className={styles.tabsRight}>
          {toolbarActions}
        </div>
      )}
    </div>
  );
});

PortainerTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  toolbarActions: PropTypes.node,
};

PortainerTabNavigation.displayName = "PortainerTabNavigation";

export default PortainerTabNavigation;

