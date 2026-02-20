import React, { useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import ErrorBoundary from "../components/ErrorBoundary";
import BatchTabNavigation from "../components/batch/BatchTabNavigation";
import { BATCH_TABS } from "../constants/batch";
import styles from "./BatchPage.module.css";

// Import components directly for faster initial load
// Lazy loading was causing delays and odd behavior on page open
import HistoryTab from "../components/batch/HistoryTab";
import BatchTab from "../components/batch/BatchTab";

/**
 * BatchPage Component
 * Main page component for the Batch section with tab navigation
 */
function BatchPage({
  onBatchConfigUpdate,
  colorScheme,
  onColorSchemeChange,
  onTriggerBatch,
  onTriggerTrackedAppsBatch,
  activeTab: controlledActiveTab,
  onTabChange: onControlledTabChange,
}) {
  const [internalTab, setInternalTab] = useState(controlledActiveTab || BATCH_TABS.HISTORY);

  // Sync internal tab when controlled tab changes
  useEffect(() => {
    if (controlledActiveTab !== undefined) {
      setInternalTab(controlledActiveTab);
    }
  }, [controlledActiveTab]);

  const handleTabChange = useCallback(
    (tab) => {
      // Always update internal state immediately for instant UI feedback
      setInternalTab(tab);
      // Also call controlled handler if provided (this updates parent state)
      if (onControlledTabChange) {
        onControlledTabChange(tab);
      }
    },
    [onControlledTabChange]
  );

  // Use internal state for immediate UI updates, but sync with controlled value when it changes
  // This ensures the UI updates immediately when clicking tabs, even in controlled mode
  const batchTab = internalTab;

  return (
    <div className={styles.batchPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.batchHeader}>Batch</h2>
        </div>
      </div>

      {/* Tab Navigation */}
      <BatchTabNavigation activeTab={batchTab} onTabChange={handleTabChange} />

      {/* Tab Content */}
      <div className={styles.contentTabPanel}>
        <ErrorBoundary>
          {batchTab === BATCH_TABS.HISTORY || batchTab === "history" ? (
            <HistoryTab
              key="history-tab"
              onTriggerBatch={onTriggerBatch}
              onTriggerTrackedAppsBatch={onTriggerTrackedAppsBatch}
            />
          ) : (
            <BatchTab
              key="settings-tab"
              onBatchConfigUpdate={onBatchConfigUpdate}
              colorScheme={colorScheme}
              onColorSchemeChange={onColorSchemeChange}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

BatchPage.propTypes = {
  onBatchConfigUpdate: PropTypes.func,
  colorScheme: PropTypes.string,
  onColorSchemeChange: PropTypes.func,
  onTriggerBatch: PropTypes.func,
  onTriggerTrackedAppsBatch: PropTypes.func,
  activeTab: PropTypes.string,
  onTabChange: PropTypes.func,
};

export default BatchPage;
