import React, { useState, useMemo, useImperativeHandle, forwardRef } from "react";
import PropTypes from "prop-types";
import { ChevronRight, ChevronDown } from "lucide-react";
import JSONViewer from "./JSONViewer";
import styles from "../../DataTab.module.css";

/**
 * DatabaseRecordsView Component
 * Displays raw database records organized by table
 */
const DatabaseRecordsView = forwardRef(({ 
  rawDatabaseRecords, 
  searchQuery = "",
}, ref) => {
  const [expandedTables, setExpandedTables] = useState(new Set());
  const [activeTable, setActiveTable] = useState(null);
  const [expandedRecords, setExpandedRecords] = useState(new Set());

  // Extract tables - must be done before useMemo
  const tables = rawDatabaseRecords && Object.keys(rawDatabaseRecords).length > 0
    ? Object.keys(rawDatabaseRecords).filter((key) => !key.endsWith("_error"))
    : [];

  // Filter records based on search query - must be called before any early returns
  const filteredRecordsByTable = useMemo(() => {
    if (!rawDatabaseRecords || Object.keys(rawDatabaseRecords).length === 0) {
      return {};
    }

    const filtered = {};
    const query = searchQuery.toLowerCase().trim();

    tables.forEach((tableName) => {
      const records = rawDatabaseRecords[tableName] || [];
      if (!query) {
        filtered[tableName] = records;
      } else {
        filtered[tableName] = records.filter((record) => {
          // Search in all record fields by stringifying the record
          try {
            const recordString = JSON.stringify(record).toLowerCase();
            return recordString.includes(query);
          } catch (e) {
            return false;
          }
        });
      }
    });

    return filtered;
  }, [rawDatabaseRecords, searchQuery, tables]);

  // Function to check if all records are expanded
  const areAllRecordsExpanded = () => {
    // Check if all tables with records are expanded
    const tablesWithRecords = tables.filter((tableName) => {
      const records = filteredRecordsByTable[tableName] || [];
      return records.length > 0;
    });
    
    if (tablesWithRecords.length === 0) {
      return false;
    }
    
    const allTablesExpanded = tablesWithRecords.every((tableName) => expandedTables.has(tableName));
    
    // Check if all records are expanded
    let totalRecords = 0;
    let expandedCount = 0;
    tables.forEach((tableName) => {
      const records = filteredRecordsByTable[tableName] || [];
      records.forEach((record, index) => {
        totalRecords++;
        const primaryKey = record.id || record.user_id || record.container_id || record.deployed_image_id || record.registry_image_version_id;
        const recordKey = `${tableName}:${primaryKey || index}`;
        if (expandedRecords.has(recordKey)) {
          expandedCount++;
        }
      });
    });
    
    const allRecordsExpanded = totalRecords > 0 && expandedCount === totalRecords;
    
    return allTablesExpanded && allRecordsExpanded;
  };

  // Expose methods to parent via ref - must be after tables and filteredRecordsByTable are defined
  useImperativeHandle(ref, () => ({
    expandAll: () => {
      const tablesWithRecords = tables.filter((tableName) => {
        const records = filteredRecordsByTable[tableName] || [];
        return records.length > 0;
      });
      setExpandedTables(new Set(tablesWithRecords));
      if (tablesWithRecords.length > 0) {
        setActiveTable(tablesWithRecords[0]);
      }
      
      const allRecordKeys = new Set();
      tables.forEach((tableName) => {
        const records = filteredRecordsByTable[tableName] || [];
        records.forEach((record, index) => {
          const primaryKey = record.id || record.user_id || record.container_id || record.deployed_image_id || record.registry_image_version_id;
          const recordKey = `${tableName}:${primaryKey || index}`;
          allRecordKeys.add(recordKey);
        });
      });
      setExpandedRecords(allRecordKeys);
    },
    collapseAll: () => {
      setExpandedTables(new Set());
      setActiveTable(null);
      setExpandedRecords(new Set());
    },
  }), [tables, filteredRecordsByTable]);

  if (!rawDatabaseRecords || Object.keys(rawDatabaseRecords).length === 0) {
    return (
      <div className={styles.databaseRecordsView}>
        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>Database Records</div>
          <p>No database records available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.databaseRecordsView}>
      <div className={styles.dataSection}>
        <div className={styles.dataHeader}>Raw Database Records</div>
        <p className={styles.dataDescription}>
          Raw records from database tables. Use this to debug update detection
          and see the actual state of your data.
        </p>

        <div className={styles.tableTabs}>
          {tables.map((tableName) => {
            const allRecords = rawDatabaseRecords[tableName] || [];
            const filteredRecords = filteredRecordsByTable[tableName] || [];
            const error = rawDatabaseRecords[`${tableName}_error`];
            const isTableExpanded = expandedTables.has(tableName);
            const hasFilteredResults = searchQuery.trim() && filteredRecords.length < allRecords.length;

            return (
              <div key={tableName} className={styles.tableTab}>
                <button
                  className={`${styles.tableTabButton} ${
                    expandedTables.has(tableName) ? styles.active : ""
                  }`}
                  onClick={() => {
                    // Toggle table expansion
                    setExpandedTables((prev) => {
                      const next = new Set(prev);
                      if (next.has(tableName)) {
                        next.delete(tableName);
                        // If this was the active table, clear it
                        if (activeTable === tableName) {
                          setActiveTable(null);
                        }
                      } else {
                        next.add(tableName);
                        // Set as active table
                        setActiveTable(tableName);
                      }
                      return next;
                    });
                  }}
                >
                  <span className={styles.tableTabName}>{tableName}</span>
                  <span className={styles.tableTabCount}>
                    ({filteredRecords.length}{hasFilteredResults && `/${allRecords.length}`} {filteredRecords.length === 1 ? "record" : "records"})
                  </span>
                  {error && (
                    <span className={styles.tableTabError} title={error}>
                      ⚠️
                    </span>
                  )}
                </button>

                {expandedTables.has(tableName) && (
                  <div className={styles.tableContent}>
                    {error ? (
                      <div className={styles.errorMessage}>
                        Error loading {tableName}: {error}
                      </div>
                    ) : filteredRecords.length === 0 ? (
                      <div className={styles.emptyMessage}>
                        {searchQuery.trim()
                          ? `No records found in ${tableName} matching "${searchQuery}"`
                          : `No records found in ${tableName}`}
                      </div>
                    ) : (
                      <div className={styles.recordsList}>
                        {filteredRecords.map((record, index) => {
                          // Use a stable key based on the record's primary key or a combination of fields
                          const primaryKey = record.id || record.user_id || record.container_id || record.deployed_image_id || record.registry_image_version_id;
                          const recordKey = `${tableName}:${primaryKey || index}`;
                          const isExpanded = expandedRecords.has(recordKey);
                          
                          // Get display header based on table type
                          let displayHeader = `ID: ${primaryKey || `Record ${index + 1}`}`;
                          if (tableName === "portainer_instances" && record.name) {
                            displayHeader = record.name;
                          } else if (tableName === "deployed_images" && record.repository) {
                            displayHeader = record.repository;
                          } else if (tableName === "containers" && record.container_name) {
                            displayHeader = record.container_name;
                          } else if (tableName === "registry_image_versions" && record.repository) {
                            displayHeader = record.repository;
                          } else if (tableName === "tracked_images" && record.name) {
                            displayHeader = record.name;
                          } else if (primaryKey) {
                            displayHeader = `ID: ${primaryKey}`;
                          }

                          return (
                            <div key={primaryKey || index} className={styles.recordItem}>
                              <button
                                className={styles.recordHeaderButton}
                                onClick={() => {
                                  setExpandedRecords((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(recordKey)) {
                                      next.delete(recordKey);
                                    } else {
                                      next.add(recordKey);
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <span className={styles.recordHeaderIcon}>
                                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                                <span className={styles.recordHeaderText}>
                                  {displayHeader}
                                </span>
                              </button>
                              {isExpanded && (
                                <div className={styles.recordContent}>
                                  <JSONViewer data={record} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

DatabaseRecordsView.propTypes = {
  rawDatabaseRecords: PropTypes.object,
  searchQuery: PropTypes.string,
};

DatabaseRecordsView.displayName = "DatabaseRecordsView";

export default DatabaseRecordsView;

