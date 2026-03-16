import React from "react";
import PropTypes from "prop-types";
import { History, Zap, ArrowUpCircle, Layers, CheckCircle, Archive, Settings } from "lucide-react";
import {
  CONTAINERS_CONTENT_TABS,
  CONTAINERS_CONTENT_TAB_LABELS,
  CONTAINERS_IMAGE_SOURCE_FILTERS,
  CONTAINERS_IMAGE_SOURCE_FILTER_LABELS,
} from "../../constants/containersPage";
import styles from "./SourcesSidebar.module.css";

/**
 * SourcesSidebar Component
 * Renders the sidebar with content tabs and instance filters
 */
const SourcesSidebar = React.memo(function SourcesSidebar({
  sourceInstances,
  contentTab,
  onContentTabChange,
  selectedSourceInstances,
  onSelectedSourceInstancesChange,
  selectedImageSourceFilters,
  onSelectedImageSourceFiltersChange,
  onManageSources,
  onManageIntents,
}) {
  const handleInstanceToggle = (instanceName, checked) => {
    onSelectedSourceInstancesChange((prev) => {
      const next = new Set(prev);

      if (checked) {
        next.add(instanceName);

        // Check if all instances are now selected
        const allInstances = sourceInstances.filter((inst) => inst != null && inst.name);
        const allSelected =
          allInstances.length > 0 && allInstances.every((inst) => next.has(inst.name));

        // If all are selected, clear all to show all
        if (allSelected) {
          return new Set();
        }

        return next;
      } else {
        next.delete(instanceName);
        return next;
      }
    });
  };

  const handleImageSourceToggle = (sourceFilter, checked) => {
    onSelectedImageSourceFiltersChange((prev) => {
      const next = new Set(prev);

      if (checked) {
        next.add(sourceFilter);

        // Check if all filters are now selected
        const allFilters = [
          CONTAINERS_IMAGE_SOURCE_FILTERS.DOCKERHUB,
          CONTAINERS_IMAGE_SOURCE_FILTERS.GITHUB,
          CONTAINERS_IMAGE_SOURCE_FILTERS.GITLAB,
          CONTAINERS_IMAGE_SOURCE_FILTERS.GOOGLE,
        ];
        const allSelected = allFilters.every((filter) => next.has(filter));

        // If all are selected, clear all to show all
        if (allSelected) {
          return new Set();
        }

        return next;
      } else {
        next.delete(sourceFilter);
        return next;
      }
    });
  };

  return (
    <div className={styles.sidebar}>
      {/* Views Toolbar */}
      <div className={styles.viewsToolbar}>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === CONTAINERS_CONTENT_TABS.UPDATES ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(CONTAINERS_CONTENT_TABS.UPDATES)}
        >
          <ArrowUpCircle size={16} className={styles.sidebarIcon} />
          <span className={styles.sidebarItemName}>
            {CONTAINERS_CONTENT_TAB_LABELS[CONTAINERS_CONTENT_TABS.UPDATES]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === CONTAINERS_CONTENT_TABS.ALL ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(CONTAINERS_CONTENT_TABS.ALL)}
        >
          <Layers size={16} className={styles.sidebarIcon} />
          <span className={styles.sidebarItemName}>
            {CONTAINERS_CONTENT_TAB_LABELS[CONTAINERS_CONTENT_TABS.ALL]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === CONTAINERS_CONTENT_TABS.CURRENT ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(CONTAINERS_CONTENT_TABS.CURRENT)}
        >
          <CheckCircle size={16} className={styles.sidebarIcon} />
          <span className={styles.sidebarItemName}>
            {CONTAINERS_CONTENT_TAB_LABELS[CONTAINERS_CONTENT_TABS.CURRENT]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === CONTAINERS_CONTENT_TABS.UNUSED ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(CONTAINERS_CONTENT_TABS.UNUSED)}
        >
          <Archive size={16} className={styles.sidebarIcon} />
          <span className={styles.sidebarItemName}>
            {CONTAINERS_CONTENT_TAB_LABELS[CONTAINERS_CONTENT_TABS.UNUSED]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === CONTAINERS_CONTENT_TABS.HISTORY ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(CONTAINERS_CONTENT_TABS.HISTORY)}
        >
          <History size={16} className={styles.sidebarIcon} />
          <span className={styles.sidebarItemName}>
            {CONTAINERS_CONTENT_TAB_LABELS[CONTAINERS_CONTENT_TABS.HISTORY]}
          </span>
        </button>
      </div>

      {/* Instance Filter */}
      <div className={styles.sidebarHeader}>
        <h3>Filter by Source</h3>
      </div>
      <div className={styles.filterContainer}>
        <div className={styles.filterBox}>
          {sourceInstances
            .filter((inst) => inst != null && inst.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((instance) => (
              <div key={instance.name} className={styles.filterLabel}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={selectedSourceInstances.has(instance.name)}
                    onChange={(e) => handleInstanceToggle(instance.name, e.target.checked)}
                    aria-label={`Filter by ${instance.name}`}
                  />
                </label>
                <span
                  className={styles.filterText}
                  onClick={() =>
                    handleInstanceToggle(instance.name, !selectedSourceInstances.has(instance.name))
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleInstanceToggle(
                        instance.name,
                        !selectedSourceInstances.has(instance.name)
                      );
                    }
                  }}
                >
                  {instance.name}
                  {instance.isRunner && <span className={styles.runnerBadge}>Runner</span>}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Source Filter */}
      <div className={`${styles.sidebarHeader} ${styles.filterSectionSpacing}`}>
        <h3>Filter by Source</h3>
      </div>
      <div className={styles.filterContainer}>
        <div className={styles.filterBox}>
          {Object.values(CONTAINERS_IMAGE_SOURCE_FILTERS).map((sourceFilter) => (
            <div key={sourceFilter} className={styles.filterLabel}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={selectedImageSourceFilters.has(sourceFilter)}
                  onChange={(e) => handleImageSourceToggle(sourceFilter, e.target.checked)}
                  aria-label={`Filter by ${CONTAINERS_IMAGE_SOURCE_FILTER_LABELS[sourceFilter]}`}
                />
              </label>
              <span
                className={styles.filterText}
                onClick={() =>
                  handleImageSourceToggle(
                    sourceFilter,
                    !selectedImageSourceFilters.has(sourceFilter)
                  )
                }
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleImageSourceToggle(
                      sourceFilter,
                      !selectedImageSourceFilters.has(sourceFilter)
                    );
                  }
                }}
              >
                {CONTAINERS_IMAGE_SOURCE_FILTER_LABELS[sourceFilter]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Manage */}
      {(onManageSources || onManageIntents) && (
        <div className={`${styles.sidebarHeader} ${styles.filterSectionSpacing}`}>
          <h3>Manage</h3>
        </div>
      )}
      {(onManageSources || onManageIntents) && (
        <div className={styles.filterContainer}>
          {onManageSources && (
            <button
              className={`${styles.sidebarItem} ${styles.manageIntentsButton}`}
              onClick={onManageSources}
              title="Manage Sources"
              aria-label="Manage Sources"
            >
              <Settings size={16} aria-hidden="true" />
              <span>Sources</span>
            </button>
          )}
          {onManageIntents && (
            <button
              className={`${styles.sidebarItem} ${styles.manageIntentsButton}`}
              onClick={onManageIntents}
              title="Manage Intents"
              aria-label="Manage Intents"
            >
              <Zap size={16} aria-hidden="true" />
              <span>Intents</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

SourcesSidebar.propTypes = {
  sourceInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  contentTab: PropTypes.string.isRequired,
  onContentTabChange: PropTypes.func.isRequired,
  selectedSourceInstances: PropTypes.instanceOf(Set).isRequired,
  onSelectedSourceInstancesChange: PropTypes.func.isRequired,
  selectedImageSourceFilters: PropTypes.instanceOf(Set).isRequired,
  onSelectedImageSourceFiltersChange: PropTypes.func.isRequired,
  onManageSources: PropTypes.func,
  onManageIntents: PropTypes.func,
};

SourcesSidebar.displayName = "SourcesSidebar";

export default SourcesSidebar;
