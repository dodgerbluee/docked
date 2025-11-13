import React, { useState, useCallback, lazy, Suspense } from "react";
import PropTypes from "prop-types";
import { Home } from "lucide-react";
import ErrorBoundary from "../components/ErrorBoundary";
import BatchTabNavigation from "../components/batch/BatchTabNavigation";
import Button from "../components/ui/Button";
import { BATCH_TABS } from "../constants/batch";
import styles from "./BatchPage.module.css";

// Lazy load tab components for better performance
const HistoryTab = lazy(() => import("../components/batch/HistoryTab"));
const BatchTab = lazy(() => import("../components/batch/BatchTab"));

/**
 * BatchPage Component
 * Main page component for the Batch section with tab navigation
 */
function BatchPage({
  onBatchConfigUpdate,
  colorScheme,
  onColorSchemeChange,
  onReturnHome,
  onTriggerBatch,
  onTriggerTrackedAppsBatch,
  activeTab: controlledActiveTab,
  onTabChange: onControlledTabChange,
}) {
  const [internalTab, setInternalTab] = useState(
    controlledActiveTab || BATCH_TABS.HISTORY
  );

  // Use controlled tab if provided, otherwise use internal state
  const batchTab = controlledActiveTab !== undefined ? controlledActiveTab : internalTab;

  const handleTabChange = useCallback(
    (tab) => {
      if (onControlledTabChange) {
        onControlledTabChange(tab);
      } else {
        setInternalTab(tab);
      }
    },
    [onControlledTabChange]
  );

  return (
    <div className={styles.batchPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.batchHeader}>Batch</h2>
          {onReturnHome && (
            <Button
              onClick={onReturnHome}
              variant="outline"
              icon={Home}
              iconPosition="left"
              className={styles.returnHomeButton}
            >
              Return Home
            </Button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <BatchTabNavigation activeTab={batchTab} onTabChange={handleTabChange} />

      {/* Tab Content */}
      <div className={styles.contentTabPanel}>
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className={styles.loadingContainer}>
                <div className={styles.loadingText}>Loading...</div>
              </div>
            }
          >
            {batchTab === BATCH_TABS.HISTORY ? (
              <HistoryTab
                onTriggerBatch={onTriggerBatch}
                onTriggerTrackedAppsBatch={onTriggerTrackedAppsBatch}
              />
            ) : (
              <BatchTab
                onBatchConfigUpdate={onBatchConfigUpdate}
                colorScheme={colorScheme}
                onColorSchemeChange={onColorSchemeChange}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

BatchPage.propTypes = {
  onBatchConfigUpdate: PropTypes.func,
  colorScheme: PropTypes.string,
  onColorSchemeChange: PropTypes.func,
  onReturnHome: PropTypes.func,
  onTriggerBatch: PropTypes.func,
  onTriggerTrackedAppsBatch: PropTypes.func,
  activeTab: PropTypes.string,
  onTabChange: PropTypes.func,
};

export default BatchPage;

