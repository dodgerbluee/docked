/**
 * AnalyticsSidebar Component
 * View tabs and filters for upgrade analytics (matches Portainer/Tracked Apps sidebar pattern)
 */

import React from "react";
import PropTypes from "prop-types";
import {
  TrendingUp,
  BarChart3,
  Package,
  Zap,
  Calendar,
  Award,
} from "lucide-react";
import {
  ANALYTICS_VIEW_TABS,
  ANALYTICS_VIEW_TAB_LABELS,
  ANALYTICS_DATA_SOURCE,
  ANALYTICS_DATA_SOURCE_LABELS,
} from "../../constants/analyticsPage";
import styles from "./AnalyticsSidebar.module.css";

const VIEW_ICONS = {
  [ANALYTICS_VIEW_TABS.OVERVIEW]: TrendingUp,
  [ANALYTICS_VIEW_TABS.CONTAINERS]: BarChart3,
  [ANALYTICS_VIEW_TABS.TRACKED_APPS]: Package,
  [ANALYTICS_VIEW_TABS.PERFORMANCE]: Zap,
  [ANALYTICS_VIEW_TABS.PATTERNS]: Calendar,
  [ANALYTICS_VIEW_TABS.INSIGHTS]: Award,
};

const AnalyticsSidebar = React.memo(function AnalyticsSidebar({
  activeViewTab,
  onViewTabChange,
  selectedDataSources,
  onSelectedDataSourcesChange,
  selectedPortainerInstances,
  onSelectedPortainerInstancesChange,
  portainerInstances = [],
}) {
  const showContainerData = selectedDataSources.has(ANALYTICS_DATA_SOURCE.CONTAINERS);
  const showInstanceFilter = showContainerData && portainerInstances.length > 0;

  const handleDataSourceToggle = (source, checked) => {
    onSelectedDataSourcesChange((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(source);
        return next;
      }
      next.delete(source);
      return next.size > 0 ? next : new Set([ANALYTICS_DATA_SOURCE.CONTAINERS, ANALYTICS_DATA_SOURCE.TRACKED_APPS]);
    });
  };

  const handleInstanceToggle = (instanceName, checked) => {
    onSelectedPortainerInstancesChange((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(instanceName);
        const allSelected =
          portainerInstances.filter((i) => i?.name).length > 0 &&
          portainerInstances.every((i) => i?.name && next.has(i.name));
        if (allSelected) return new Set();
        return next;
      }
      next.delete(instanceName);
      return next;
    });
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.viewsToolbar}>
        {Object.values(ANALYTICS_VIEW_TABS).map((tabId) => {
          const Icon = VIEW_ICONS[tabId];
          return (
            <button
              key={tabId}
              type="button"
              className={`${styles.sidebarItem} ${activeViewTab === tabId ? styles.active : ""}`}
              onClick={() => onViewTabChange(tabId)}
              aria-label={`View ${ANALYTICS_VIEW_TAB_LABELS[tabId]}`}
              aria-current={activeViewTab === tabId ? "true" : undefined}
            >
              {Icon && <Icon size={16} className={styles.sidebarItemIcon} aria-hidden="true" />}
              <span className={styles.sidebarItemName}>{ANALYTICS_VIEW_TAB_LABELS[tabId]}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.sidebarHeader}>
        <h3>Data source</h3>
      </div>
      <div className={styles.filterContainer}>
        <div className={styles.filterBox}>
          {[ANALYTICS_DATA_SOURCE.CONTAINERS, ANALYTICS_DATA_SOURCE.TRACKED_APPS].map((source) => (
            <div key={source} className={styles.filterLabel}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={selectedDataSources.has(source)}
                  onChange={(e) => handleDataSourceToggle(source, e.target.checked)}
                  aria-label={`Include ${ANALYTICS_DATA_SOURCE_LABELS[source]}`}
                />
              </label>
              <span
                className={styles.filterText}
                onClick={() => handleDataSourceToggle(source, !selectedDataSources.has(source))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleDataSourceToggle(source, !selectedDataSources.has(source));
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {ANALYTICS_DATA_SOURCE_LABELS[source]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {showInstanceFilter && (
        <>
          <div className={`${styles.sidebarHeader} ${styles.filterSectionSpacing}`}>
            <h3>Filter by instance</h3>
          </div>
          <div className={styles.filterContainer}>
            <div className={styles.filterBox}>
              {portainerInstances
                .filter((inst) => inst != null && inst.name)
                .map((instance) => (
                  <div key={instance.name} className={styles.filterLabel}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={selectedPortainerInstances.has(instance.name)}
                        onChange={(e) => handleInstanceToggle(instance.name, e.target.checked)}
                        aria-label={`Filter by ${instance.name}`}
                      />
                    </label>
                    <span
                      className={styles.filterText}
                      onClick={() =>
                        handleInstanceToggle(instance.name, !selectedPortainerInstances.has(instance.name))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleInstanceToggle(instance.name, !selectedPortainerInstances.has(instance.name));
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {instance.name}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

AnalyticsSidebar.propTypes = {
  activeViewTab: PropTypes.string.isRequired,
  onViewTabChange: PropTypes.func.isRequired,
  selectedDataSources: PropTypes.instanceOf(Set).isRequired,
  onSelectedDataSourcesChange: PropTypes.func.isRequired,
  selectedPortainerInstances: PropTypes.instanceOf(Set).isRequired,
  onSelectedPortainerInstancesChange: PropTypes.func.isRequired,
  portainerInstances: PropTypes.arrayOf(PropTypes.object),
};

AnalyticsSidebar.displayName = "AnalyticsSidebar";

export default AnalyticsSidebar;
