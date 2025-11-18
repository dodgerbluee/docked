import React from "react";
import PropTypes from "prop-types";
import styles from "./AdminTabNavigation.module.css";
import { ADMIN_TABS, ADMIN_TAB_LABELS } from "../../constants/admin";

/**
 * AdminTabNavigation Component
 * Renders the tab navigation buttons for the Admin page
 */
function AdminTabNavigation({ activeTab, onTabChange }) {
  const tabs = [
    ADMIN_TABS.USERS,
    ADMIN_TABS.LOGS,
  ];

  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.active : ""}`}
            onClick={() => onTabChange(tab)}
          >
            {ADMIN_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}

AdminTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
};

export default AdminTabNavigation;

