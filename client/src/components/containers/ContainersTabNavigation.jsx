import React from "react";
import PropTypes from "prop-types";
import styles from "./ContainersTabNavigation.module.css";
import {
  CONTAINERS_CONTENT_TABS,
  CONTAINERS_CONTENT_TAB_LABELS,
} from "../../constants/containersPage";

/**
 * ContainersTabNavigation Component
 * Renders the tab navigation buttons for the Portainer page content tabs
 */
const ContainersTabNavigation = React.memo(function ContainersTabNavigation({
  activeTab,
  onTabChange,
  toolbarActions,
}) {
  const tabs = [
    CONTAINERS_CONTENT_TABS.UPDATES,
    CONTAINERS_CONTENT_TABS.CURRENT,
    CONTAINERS_CONTENT_TABS.UNUSED,
  ];

  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.active : ""}`}
            onClick={() => onTabChange(tab)}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${tab}-panel`}
            id={`${tab}-tab`}
          >
            {CONTAINERS_CONTENT_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {toolbarActions && <div className={styles.tabsRight}>{toolbarActions}</div>}
    </div>
  );
});

ContainersTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  toolbarActions: PropTypes.node,
};

ContainersTabNavigation.displayName = "ContainersTabNavigation";

export default ContainersTabNavigation;
