/**
 * Correlated Records View Component
 * Displays raw database records correlated by image name/version
 * Shows all related records (containers, deployed_images, registry_image_versions, portainer_instances)
 * together in a single JSON object for debugging
 */

import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { ChevronRight, ChevronDown } from "lucide-react";
import JSONViewer from "./JSONViewer";
import styles from "../../DataTab.module.css";

/**
 * CorrelatedRecordsView Component
 * @param {Object} props
 * @param {Object} props.correlatedRecords - Correlated records grouped by image
 * @param {Set} props.expandedContainers - Set of expanded image keys
 * @param {Function} props.onToggleExpansion - Handler for toggling expansion
 * @param {string} props.searchQuery - Search query string
 */
const CorrelatedRecordsView = ({
  correlatedRecords,
  expandedContainers,
  onToggleExpansion,
  searchQuery = "",
}) => {
  const [localExpanded, setLocalExpanded] = useState(new Set());
  
  // Use local state if onToggleExpansion is not provided, otherwise use parent state
  const isExpanded = (key) => {
    // For correlated records, the key format is "correlated-{imageKey}"
    // The expansion hook stores it directly as the key
    if (onToggleExpansion && expandedContainers) {
      return expandedContainers.has(key);
    }
    return localExpanded.has(key);
  };
  
  const toggleExpansion = (key) => {
    if (onToggleExpansion) {
      // Parent manages state - use a dummy entry key since we're not using the old format
      // The key format is "correlated-{imageKey}", so we'll use it as both entryKey and containerName
      // But we need to handle it properly in the expansion hook
      onToggleExpansion("correlated", key);
    } else {
      // Local state management
      setLocalExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    }
  };
  // Filter correlated records based on search query
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) {
      return correlatedRecords;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = {};

    Object.keys(correlatedRecords).forEach((imageKey) => {
      const record = correlatedRecords[imageKey];
      
      // Check if any part of the record matches the search query
      try {
        const recordString = JSON.stringify(record).toLowerCase();
        if (recordString.includes(query)) {
          filtered[imageKey] = record;
        }
      } catch (e) {
        // If stringify fails, check individual fields
        const imageRepo = (record.imageRepo || "").toLowerCase();
        const imageTag = (record.imageTag || "").toLowerCase();
        if (imageRepo.includes(query) || imageTag.includes(query)) {
          filtered[imageKey] = record;
        }
      }
    });

    return filtered;
  }, [correlatedRecords, searchQuery]);

  if (!correlatedRecords || Object.keys(correlatedRecords).length === 0) {
    return (
      <div className={styles.databaseRecordsView}>
        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>Correlated Database Records</div>
          <p>No correlated records available.</p>
        </div>
      </div>
    );
  }

  const imageKeys = Object.keys(filteredRecords).sort();

  return (
    <div className={styles.databaseRecordsView}>
      <div className={styles.dataSection}>
        <div className={styles.dataHeader}>Correlated Database Records by Image</div>
        <p className={styles.dataDescription}>
          Raw database records correlated by image name/version. All related records
          (containers, deployed_images, registry_image_versions, portainer_instances)
          are grouped together to show connections and help with debugging.
        </p>
        {searchQuery.trim() && (
          <p className={styles.searchInfo}>
            Showing {imageKeys.length} of {Object.keys(correlatedRecords).length} images
            {searchQuery.trim() && ` matching "${searchQuery}"`}
          </p>
        )}

        <div className={styles.correlatedRecordsList}>
          {imageKeys.map((imageKey) => {
            const record = filteredRecords[imageKey];
            const recordKey = `correlated-${imageKey}`;
            const expanded = isExpanded(recordKey);

            // Build display header
            const summary = record.summary || {};
            const displayHeader = `${record.imageRepo || "unknown"}:${record.imageTag || "latest"}`;
            const counts = [
              summary.containerCount > 0 && `${summary.containerCount} container${summary.containerCount !== 1 ? "s" : ""}`,
              summary.deployedImageCount > 0 && `${summary.deployedImageCount} deployed image${summary.deployedImageCount !== 1 ? "s" : ""}`,
              summary.registryVersionCount > 0 && `${summary.registryVersionCount} version${summary.registryVersionCount !== 1 ? "s" : ""}`,
              summary.portainerInstanceCount > 0 && `${summary.portainerInstanceCount} instance${summary.portainerInstanceCount !== 1 ? "s" : ""}`,
            ].filter(Boolean).join(", ");

            return (
              <div key={imageKey} className={styles.correlatedRecordItem}>
                <button
                  className={styles.correlatedRecordHeader}
                  onClick={() => toggleExpansion(recordKey)}
                >
                  <span className={styles.correlatedRecordIcon}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className={styles.correlatedRecordTitle}>{displayHeader}</span>
                  {counts && (
                    <span className={styles.correlatedRecordCounts}>({counts})</span>
                  )}
                </button>
                {expanded && (
                  <div className={styles.correlatedRecordContent}>
                    <JSONViewer data={record} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

CorrelatedRecordsView.propTypes = {
  correlatedRecords: PropTypes.object.isRequired,
  expandedContainers: PropTypes.instanceOf(Set),
  onToggleExpansion: PropTypes.func,
  searchQuery: PropTypes.string,
};

export default CorrelatedRecordsView;

