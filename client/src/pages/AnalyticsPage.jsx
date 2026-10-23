/**
 * AnalyticsPage Component
 * Upgrade analytics with sidebar (view tabs + filters), matching Sources/Tracked Apps layout
 */

import React, { useState, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { SlidersHorizontal } from "lucide-react";
import { useUpgradeHistory } from "../hooks/useUpgradeHistory";
import { useTrackedAppUpgradeHistory } from "../hooks/useTrackedAppUpgradeHistory";
import { useIsMobile } from "../hooks/useIsMobile";
import AnalyticsSidebar from "../components/analytics/AnalyticsSidebar";
import UpgradeChartsContent from "../components/analytics/UpgradeChartsContent";
import AnalyticsPageSkeleton from "../components/analytics/AnalyticsPageSkeleton";
import MobileDrawer from "../components/ui/MobileDrawer";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { ANALYTICS_VIEW_TABS, ANALYTICS_DATA_SOURCE } from "../constants/analyticsPage";
import styles from "./AnalyticsPage.module.css";

// Rows each history source contributes to the charts. The connection is
// cursor-paged and the server caps a page at 500, so this is walked in pages.
const ANALYTICS_HISTORY_LIMIT = 1000;

function AnalyticsPage({ sourceInstances = [] }) {
  const [activeViewTab, setActiveViewTab] = useState(ANALYTICS_VIEW_TABS.OVERVIEW);
  const [selectedDataSources, setSelectedDataSources] = useState(() => new Set());
  const [selectedSourceInstances, setSelectedSourceInstances] = useState(() => new Set());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  // The charts aggregate over the whole window, so ask for more than the
  // default 100 rows; the hook walks the connection cursor to honor it.
  const {
    history: containerHistoryRaw = [],
    loading: containerLoading,
    error: containerHistoryError,
  } = useUpgradeHistory({ limit: ANALYTICS_HISTORY_LIMIT });
  const {
    history: trackedAppHistory = [],
    loading: trackedAppLoading,
    error: trackedAppHistoryError,
  } = useTrackedAppUpgradeHistory();

  const isInitialLoading = containerLoading && trackedAppLoading;

  const containerHistory = useMemo(() => {
    const includeContainers =
      selectedDataSources.size === 0 || selectedDataSources.has(ANALYTICS_DATA_SOURCE.CONTAINERS);
    if (!includeContainers) return [];
    if (selectedSourceInstances.size === 0) return containerHistoryRaw;
    return containerHistoryRaw.filter((u) =>
      selectedSourceInstances.has(u.source_name || "Unknown")
    );
  }, [containerHistoryRaw, selectedDataSources, selectedSourceInstances]);

  const trackedAppHistoryFiltered = useMemo(() => {
    const includeTrackedApps =
      selectedDataSources.size === 0 || selectedDataSources.has(ANALYTICS_DATA_SOURCE.TRACKED_APPS);
    return includeTrackedApps ? trackedAppHistory : [];
  }, [trackedAppHistory, selectedDataSources]);

  // A failed history read must not render as "nothing to chart": the charts
  // compute plausible zeros out of data that never arrived.
  const historyError = [
    containerHistoryError && `Container history: ${containerHistoryError}`,
    trackedAppHistoryError && `Tracked app history: ${trackedAppHistoryError}`,
  ]
    .filter(Boolean)
    .join(" ");

  const sidebarProps = {
    activeViewTab,
    onViewTabChange: setActiveViewTab,
    selectedDataSources,
    onSelectedDataSourcesChange: setSelectedDataSources,
    selectedSourceInstances,
    onSelectedSourceInstancesChange: setSelectedSourceInstances,
    sourceInstances,
  };

  return (
    <div className={styles.analyticsPage}>
      {/* Mobile filter button */}
      {isMobile && (
        <div className={styles.mobileHeaderRow}>
          <Button
            onClick={() => setMobileSidebarOpen(true)}
            variant="outline"
            icon={SlidersHorizontal}
            size="sm"
            title="Filters"
            aria-label="Open filters"
            aria-expanded={mobileSidebarOpen ? "true" : "false"}
            className={styles.mobileFilterButton}
          >
            Filters
          </Button>
        </div>
      )}

      <div className={styles.analyticsSidebarLayout}>
        {/* Desktop: render sidebar inline */}
        {!isMobile && <AnalyticsSidebar {...sidebarProps} />}

        {/* Mobile: render sidebar in shared MobileDrawer */}
        <MobileDrawer
          isOpen={mobileSidebarOpen}
          onClose={closeMobileSidebar}
          title="Filters"
          ariaLabel="Analytics filters"
        >
          <AnalyticsSidebar
            {...sidebarProps}
            onViewTabChange={(tab) => {
              setActiveViewTab(tab);
              closeMobileSidebar();
            }}
          />
        </MobileDrawer>

        <div className={styles.analyticsContentArea} role="region" aria-label="Analytics charts">
          {historyError && (
            <Alert variant="error" role="alert" className={styles.historyError}>
              {historyError} The charts below are computed from whatever did load, so the totals and
              rates are not trustworthy.
            </Alert>
          )}
          {isInitialLoading ? (
            <AnalyticsPageSkeleton />
          ) : (
            <UpgradeChartsContent
              containerHistory={containerHistory}
              trackedAppHistory={trackedAppHistoryFiltered}
              activeViewTab={activeViewTab}
            />
          )}
        </div>
      </div>
    </div>
  );
}

AnalyticsPage.propTypes = {
  sourceInstances: PropTypes.arrayOf(PropTypes.object),
};

export default AnalyticsPage;
