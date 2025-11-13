import React from "react";
import PropTypes from "prop-types";
import styles from "./BatchTabNavigation.module.css";
import { BATCH_TABS, BATCH_TAB_LABELS } from "../../constants/batch";

/**
 * BatchTabNavigation Component
 * Renders the tab navigation buttons for the Batch page
 */
function BatchTabNavigation({ activeTab, onTabChange }) {
  const tabs = [BATCH_TABS.HISTORY, BATCH_TABS.SETTINGS];

  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsLeft}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.active : ""}`}
            onClick={() => onTabChange(tab)}
          >
            {BATCH_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}

BatchTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
};

export default BatchTabNavigation;

