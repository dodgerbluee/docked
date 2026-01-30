/**
 * AnalyticsPage Component
 * Upgrade analytics with sidebar (view tabs + filters), matching Portainer/Tracked Apps layout
 */

import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { BarChart3 } from "lucide-react";
import { useUpgradeHistory } from "../hooks/useUpgradeHistory";
import { useTrackedAppUpgradeHistory } from "../hooks/useTrackedAppUpgradeHistory";
import AnalyticsSidebar from "../components/analytics/AnalyticsSidebar";
import UpgradeChartsContent from "../components/analytics/UpgradeChartsContent";
import { ANALYTICS_VIEW_TABS, ANALYTICS_DATA_SOURCE } from "../constants/analyticsPage";
import styles from "./AnalyticsPage.module.css";

function AnalyticsPage({ portainerInstances = [] }) {
  const [activeViewTab, setActiveViewTab] = useState(ANALYTICS_VIEW_TABS.OVERVIEW);
  const [selectedDataSources, setSelectedDataSources] = useState(() => new Set());
  const [selectedPortainerInstances, setSelectedPortainerInstances] = useState(() => new Set());

  const { history: containerHistoryRaw = [] } = useUpgradeHistory();
  const { history: trackedAppHistory = [] } = useTrackedAppUpgradeHistory();

  const containerHistory = useMemo(() => {
    const includeContainers = selectedDataSources.size === 0 || selectedDataSources.has(ANALYTICS_DATA_SOURCE.CONTAINERS);
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

  return (
    <div className={styles.analyticsPage}>

      <div className={styles.analyticsSidebarLayout}>
        <AnalyticsSidebar
          activeViewTab={activeViewTab}
          onViewTabChange={setActiveViewTab}
          selectedDataSources={selectedDataSources}
          onSelectedDataSourcesChange={setSelectedDataSources}
          selectedPortainerInstances={selectedPortainerInstances}
          onSelectedPortainerInstancesChange={setSelectedPortainerInstances}
          portainerInstances={portainerInstances}
        />
        <div
          className={styles.analyticsContentArea}
          role="region"
          aria-label="Analytics charts"
        >
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
