import React from "react";
import PropTypes from "prop-types";
import { Plus } from "lucide-react";
import { TRACKED_APPS_CONTENT_TABS, TRACKED_APPS_CONTENT_TAB_LABELS, TRACKED_APPS_SOURCE_FILTERS, TRACKED_APPS_SOURCE_FILTER_LABELS } from "../../constants/trackedAppsPage";
import styles from "./TrackedAppsSidebar.module.css";

/**
 * TrackedAppsSidebar Component
 * Renders the sidebar with content tabs and source filters
 */
const TrackedAppsSidebar = React.memo(function TrackedAppsSidebar({
  contentTab,
  onContentTabChange,
  selectedSourceFilters,
  onSelectedSourceFiltersChange,
  onAddApp,
}) {
  const handleSourceFilterToggle = (sourceType, checked) => {
    onSelectedSourceFiltersChange((prev) => {
      const next = new Set(prev);
      
      if (checked) {
        next.add(sourceType);
        
        // Check if all sources are now selected
        const allSources = Object.values(TRACKED_APPS_SOURCE_FILTERS);
        const allSelected = allSources.length > 0 &&
          allSources.every((source) => next.has(source));
        
        // If all are selected, clear all to show all
        if (allSelected) {
          return new Set();
        }
        
        return next;
      } else {
        next.delete(sourceType);
        return next;
      }
    });
  };

  const sourceFilters = [
    TRACKED_APPS_SOURCE_FILTERS.GITHUB,
    TRACKED_APPS_SOURCE_FILTERS.GITLAB,
    TRACKED_APPS_SOURCE_FILTERS.DOCKERHUB,
  ];

  return (
    <div className={styles.sidebar}>
      {/* Views Toolbar */}
      <div className={styles.viewsToolbar}>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === TRACKED_APPS_CONTENT_TABS.ALL ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(TRACKED_APPS_CONTENT_TABS.ALL)}
        >
          <span className={styles.sidebarItemName}>
            {TRACKED_APPS_CONTENT_TAB_LABELS[TRACKED_APPS_CONTENT_TABS.ALL]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(TRACKED_APPS_CONTENT_TABS.UPDATES)}
        >
          <span className={styles.sidebarItemName}>
            {TRACKED_APPS_CONTENT_TAB_LABELS[TRACKED_APPS_CONTENT_TABS.UPDATES]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(TRACKED_APPS_CONTENT_TABS.UP_TO_DATE)}
        >
          <span className={styles.sidebarItemName}>
            {TRACKED_APPS_CONTENT_TAB_LABELS[TRACKED_APPS_CONTENT_TABS.UP_TO_DATE]}
          </span>
        </button>
      </div>

      {/* Source Filter */}
      <div className={styles.sidebarHeader}>
        <h3>Filter by Source</h3>
      </div>
      <div className={styles.filterContainer}>
        <div className={styles.filterBox}>
          {sourceFilters.map((sourceType) => (
            <div
              key={sourceType}
              className={styles.filterLabel}
            >
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={selectedSourceFilters.has(sourceType)}
                  onChange={(e) => handleSourceFilterToggle(sourceType, e.target.checked)}
                  aria-label={`Filter by ${TRACKED_APPS_SOURCE_FILTER_LABELS[sourceType]}`}
                />
              </label>
              <span 
                className={styles.filterText}
                onClick={() => handleSourceFilterToggle(sourceType, !selectedSourceFilters.has(sourceType))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSourceFilterToggle(sourceType, !selectedSourceFilters.has(sourceType));
                  }
                }}
              >
                {TRACKED_APPS_SOURCE_FILTER_LABELS[sourceType]}
              </span>
            </div>
          ))}
        </div>
        <button
          className={`${styles.sidebarItem} ${styles.addButton}`}
          onClick={onAddApp}
          title="Add Tracked App"
          aria-label="Add Tracked App"
        >
          <Plus size={16} aria-hidden="true" />
          <span>Add App</span>
        </button>
      </div>
    </div>
  );
});

TrackedAppsSidebar.propTypes = {
  contentTab: PropTypes.string.isRequired,
  onContentTabChange: PropTypes.func.isRequired,
  selectedSourceFilters: PropTypes.instanceOf(Set).isRequired,
  onSelectedSourceFiltersChange: PropTypes.func.isRequired,
  onAddApp: PropTypes.func.isRequired,
};

TrackedAppsSidebar.displayName = "TrackedAppsSidebar";

export default TrackedAppsSidebar;

