/**
 * AnalyticsPage Component
 * Upgrade analytics with sidebar (view tabs + filters), matching Portainer/Tracked Apps layout
 */

import React, { useState, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { SlidersHorizontal } from "lucide-react";
import { useUpgradeHistory } from "../hooks/useUpgradeHistory";
import { useTrackedAppUpgradeHistory } from "../hooks/useTrackedAppUpgradeHistory";
import { useIsMobile } from "../hooks/useIsMobile";
import AnalyticsSidebar from "../components/analytics/AnalyticsSidebar";
import UpgradeChartsContent from "../components/analytics/UpgradeChartsContent";
import MobileDrawer from "../components/ui/MobileDrawer";
import Button from "../components/ui/Button";
import { ANALYTICS_VIEW_TABS, ANALYTICS_DATA_SOURCE } from "../constants/analyticsPage";
import styles from "./AnalyticsPage.module.css";

function AnalyticsPage({ portainerInstances = [] }) {
  const [activeViewTab, setActiveViewTab] = useState(ANALYTICS_VIEW_TABS.OVERVIEW);
  const [selectedDataSources, setSelectedDataSources] = useState(() => new Set());
  const [selectedPortainerInstances, setSelectedPortainerInstances] = useState(() => new Set());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const { history: containerHistoryRaw = [] } = useUpgradeHistory();
  const { history: trackedAppHistory = [] } = useTrackedAppUpgradeHistory();

  const containerHistory = useMemo(() => {
    const includeContainers =
      selectedDataSources.size === 0 || selectedDataSources.has(ANALYTICS_DATA_SOURCE.CONTAINERS);
    if (!includeContainers) return [];
    if (selectedPortainerInstances.size === 0) return containerHistoryRaw;
    return containerHistoryRaw.filter((u) =>
      selectedPortainerInstances.has(u.portainer_instance_name || "Unknown")
    );
  }, [containerHistoryRaw, selectedDataSources, selectedPortainerInstances]);

  const trackedAppHistoryFiltered = useMemo(() => {
    const includeTrackedApps =
      selectedDataSources.size === 0 || selectedDataSources.has(ANALYTICS_DATA_SOURCE.TRACKED_APPS);
    return includeTrackedApps ? trackedAppHistory : [];
  }, [trackedAppHistory, selectedDataSources]);

  const sidebarProps = {
    activeViewTab,
    onViewTabChange: setActiveViewTab,
    selectedDataSources,
    onSelectedDataSourcesChange: setSelectedDataSources,
    selectedPortainerInstances,
    onSelectedPortainerInstancesChange: setSelectedPortainerInstances,
    portainerInstances,
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
          <UpgradeChartsContent
            containerHistory={containerHistory}
            trackedAppHistory={trackedAppHistoryFiltered}
            activeViewTab={activeViewTab}
          />
        </div>
      </div>
    </div>
  );
}

AnalyticsPage.propTypes = {
  portainerInstances: PropTypes.arrayOf(PropTypes.object),
};

export default AnalyticsPage;
