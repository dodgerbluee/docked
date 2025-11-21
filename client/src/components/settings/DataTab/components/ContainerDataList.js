/**
 * Container data list component
 */

import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import PropTypes from "prop-types";
import ContainerDataEntry from "./ContainerDataEntry";
import DatabaseRecordsView from "./DatabaseRecordsView";
import styles from "../../DataTab.module.css";

/**
 * Container data list component
 * @param {Object} props
 * @param {Array} props.dataEntries - Array of data entries
 * @param {Set} props.expandedContainers - Set of expanded container keys
 * @param {Function} props.onToggleExpansion - Handler for toggling expansion
 * @param {Object} props.rawDatabaseRecords - Raw database records organized by table
 * @param {string} props.searchQuery - Search query string
 */
const ContainerDataList = forwardRef(({
  dataEntries,
  expandedContainers,
  onToggleExpansion,
  rawDatabaseRecords,
  searchQuery = "",
  onViewModeChange,
}, ref) => {
  const [viewMode, setViewMode] = useState("formatted"); // "formatted" or "raw"
  const databaseRecordsViewRef = useRef(null);
  
  const handleViewModeChange = (newMode) => {
    setViewMode(newMode);
    if (onViewModeChange) {
      onViewModeChange(newMode);
    }
  };
  
  useImperativeHandle(ref, () => ({
    expandAllRawRecords: () => {
      if (databaseRecordsViewRef.current) {
        databaseRecordsViewRef.current.expandAll();
      }
    },
    collapseAllRawRecords: () => {
      if (databaseRecordsViewRef.current) {
        databaseRecordsViewRef.current.collapseAll();
      }
    },
  }));

  if (dataEntries.length === 0 && (!rawDatabaseRecords || Object.keys(rawDatabaseRecords).length === 0)) {
    return <div className={styles.empty}>No data entries found</div>;
  }

  return (
    <div className={styles.dataWrapper}>
      {/* View Mode Toggle */}
      <div className={styles.viewModeToggle}>
        <button
          className={`${styles.viewModeButton} ${
            viewMode === "formatted" ? styles.active : ""
          }`}
          onClick={() => handleViewModeChange("formatted")}
        >
          Formatted View
        </button>
        <button
          className={`${styles.viewModeButton} ${
            viewMode === "raw" ? styles.active : ""
          }`}
          onClick={() => handleViewModeChange("raw")}
        >
          Raw Database Records
        </button>
      </div>

      {/* Formatted View */}
      {viewMode === "formatted" && (
        <div>
          {dataEntries.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No formatted container data available.</p>
            </div>
          ) : (
            dataEntries.map((entry) => (
              <ContainerDataEntry
                key={entry.key}
                entry={entry}
                expandedContainers={expandedContainers}
                onToggleExpansion={onToggleExpansion}
              />
            ))
          )}
        </div>
      )}

      {/* Raw Database Records View */}
      {viewMode === "raw" && (
        <DatabaseRecordsView 
          ref={databaseRecordsViewRef}
          rawDatabaseRecords={rawDatabaseRecords}
          searchQuery={searchQuery}
        />
      )}
    </div>
  );
});

ContainerDataList.propTypes = {
  dataEntries: PropTypes.array.isRequired,
  expandedContainers: PropTypes.instanceOf(Set).isRequired,
  onToggleExpansion: PropTypes.func.isRequired,
  rawDatabaseRecords: PropTypes.object,
  searchQuery: PropTypes.string,
  onViewModeChange: PropTypes.func,
};

ContainerDataList.displayName = "ContainerDataList";

export default ContainerDataList;
