/**
 * Container data entry component
 */

import React from "react";
import PropTypes from "prop-types";
import { ChevronRight, ChevronDown } from "lucide-react";
import Alert from "../../../ui/Alert";
import JSONViewer from "./JSONViewer";
import { categorizeContainerData, buildStructuredData } from "../utils/containerDataProcessing";
import styles from "../../DataTab.module.css";

/**
 * Container data entry component
 * @param {Object} props
 * @param {Object} props.entry - Data entry object
 * @param {Set} props.expandedContainers - Set of expanded container keys
 * @param {Function} props.onToggleExpansion - Handler for toggling expansion
 */
const ContainerDataEntry = ({ entry, expandedContainers, onToggleExpansion }) => {
  const hasData = entry.data && !entry.error;
  const containerNames = entry.containerNames || [];
  const containers = entry.data?.containers || [];
  const searchQuery = entry._searchQuery || "";

  // Filter containers based on search query if present
  let filteredContainerNames = containerNames;
  let filteredContainers = containers;

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    
    // Helper function to check if a container's JSON data matches the query
    const containerJsonMatches = (container) => {
      try {
        const containerJsonString = JSON.stringify(container || {}).toLowerCase();
        return containerJsonString.includes(query);
      } catch (e) {
        return false;
      }
    };
    
    // Filter container names - check if name matches OR if the container's JSON matches
    filteredContainerNames = containerNames.filter((name, idx) => {
      const nameMatches = name?.toLowerCase().includes(query);
      if (nameMatches) return true;
      
      // Check if this container's JSON data matches
      const container = containers[idx];
      if (container && containerJsonMatches(container)) {
        return true;
      }
      return false;
    });
    
    // Filter containers by name, image, ID, or JSON content
    filteredContainers = containers.filter((container) => {
      const containerName = container.name?.toLowerCase() || "";
      const containerImage = container.image?.toLowerCase() || "";
      const containerId = container.id?.toLowerCase() || "";
      
      // Check name, image, or ID match
      if (
        containerName.includes(query) ||
        containerImage.includes(query) ||
        containerId.includes(query)
      ) {
        return true;
      }
      
      // Check if container's JSON content matches
      if (containerJsonMatches(container)) {
        return true;
      }
      
      return false;
    });
  }

  // Display containers if we have container names OR if we have containers in the data
  const hasContainers = filteredContainerNames.length > 0 || filteredContainers.length > 0;

  // Check if we have Portainer instance data (instanceName, instanceUrl) even without containers
  const hasPortainerInstanceData = entry.data?.instanceName || entry.data?.instanceUrl;

  // If we have data but no containers, show all available data in a structured format
  if (hasData && !hasContainers) {
    // Build complete data structure showing all available information
    const completeData = {
      dataEntry: {
        key: entry.key,
        containerCount: entry.containerCount || 0,
        updatedAt: entry.updatedAt || null,
        createdAt: entry.createdAt || null,
      },
      portainerData: {},
    };

    // Add Portainer instance data if available
    if (hasPortainerInstanceData) {
      completeData.portainerData.portainerInstance = {
        name: entry.data.instanceName || null,
        url: entry.data.instanceUrl || null,
      };
    }

    // Include any other data from entry.data that might be useful
    const otherData = { ...entry.data };
    delete otherData.instanceName;
    delete otherData.instanceUrl;
    delete otherData.containers;

    if (Object.keys(otherData).length > 0) {
      completeData.portainerData.other = otherData;
    }

    // If we have Portainer instance data, show structured format
    if (hasPortainerInstanceData) {
      return (
        <div className={styles.dataEntry}>
          <div className={styles.dataSection}>
            <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
            <Alert variant="info" style={{ marginBottom: "12px" }}>
              No containers found in this data entry. Showing all available Portainer instance data.
            </Alert>
            <JSONViewer data={completeData} />
          </div>
        </div>
      );
    }

    // Fallback: show raw data if no structured Portainer data
    return (
      <div className={styles.dataEntry}>
        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
          <Alert variant="info" style={{ marginBottom: "12px" }}>
            No containers found in this data entry. Showing raw data.
          </Alert>
          <JSONViewer data={entry.data} />
        </div>
      </div>
    );
  }

  if (hasData && hasContainers) {
    // Use filtered containerNames if available, otherwise use filtered containers directly
    const containersToDisplay =
      filteredContainerNames.length > 0
        ? filteredContainerNames.map((name, idx) => ({ name, idx }))
        : filteredContainers.map((c, idx) => ({ name: c.name || c.id || `Container ${idx + 1}`, idx }));

    return (
      <>
        {containersToDisplay.map(({ name, idx }) => {
          const containerKey = `${entry.key}:${name}`;
          const isContainerExpanded = expandedContainers.has(containerKey);
          // Try multiple ways to find the container data
          const containerData =
            filteredContainers.find((c) => {
              const cName = c.name || "";
              const cId = c.id || "";
              // Match by name (with or without leading slash)
              return (
                cName === name ||
                cName.replace("/", "") === name ||
                cName === name.replace("/", "") ||
                // Match by ID (full or short)
                cId === name ||
                cId.substring(0, 12) === name ||
                name.substring(0, 12) === cId.substring(0, 12)
              );
            }) || filteredContainers[idx]; // Fallback to index-based lookup

          return (
            <div key={`${entry.key}-${idx}`} className={styles.containerItem}>
              <div
                className={styles.containerLine}
                onClick={() => onToggleExpansion(entry.key, name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleExpansion(entry.key, name);
                  }
                }}
              >
                <span className={styles.expandIcon}>
                  {isContainerExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className={styles.containerName}>{name}</span>
                <span className={styles.expandHint}>
                  {isContainerExpanded ? " (click to collapse)" : " (click to expand)"}
                </span>
              </div>
              {isContainerExpanded &&
                (() => {
                  // If no containerData found, show a message or try to find it differently
                  if (!containerData) {
                    // Try to find by index as fallback
                    const containerByIndex = entry.data?.containers?.[idx];
                    if (containerByIndex) {
                      const categorized = categorizeContainerData(containerByIndex);
                      const structuredData = buildStructuredData(
                        categorized || containerByIndex,
                        containerByIndex
                      );
                      return <JSONViewer data={structuredData} />;
                    }
                    return (
                      <div className={styles.containerData}>
                        <Alert variant="warning">
                          Container data not found for "{name}". Showing raw data entry.
                        </Alert>
                        <JSONViewer data={entry.data} />
                      </div>
                    );
                  }

                  const categorized = categorizeContainerData(containerData);
                  const structuredData = buildStructuredData(
                    categorized || containerData,
                    containerData
                  );
                  return <JSONViewer data={structuredData} />;
                })()}
            </div>
          );
        })}
      </>
    );
  }

  // Final fallback: if we have any data at all, show it
  // This ensures we always display something if data exists
  if (hasData) {
    // Build complete data structure
    const completeData = {
      dataEntry: {
        key: entry.key,
        containerCount: entry.containerCount || 0,
        updatedAt: entry.updatedAt || null,
        createdAt: entry.createdAt || null,
      },
      portainerData: {},
    };

    // Check if we have Portainer instance data
    const hasPortainerInstanceData = entry.data?.instanceName || entry.data?.instanceUrl;

    if (hasPortainerInstanceData) {
      completeData.portainerData.portainerInstance = {
        name: entry.data.instanceName || null,
        url: entry.data.instanceUrl || null,
      };
    }

    // Include any other data from entry.data
    const otherData = { ...entry.data };
    delete otherData.instanceName;
    delete otherData.instanceUrl;
    delete otherData.containers;

    if (Object.keys(otherData).length > 0) {
      completeData.portainerData.other = otherData;
    }

    if (hasPortainerInstanceData || Object.keys(completeData.portainerData).length > 0) {
      return (
        <div className={styles.dataEntry}>
          <div className={styles.dataSection}>
            <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
            <Alert variant="info" style={{ marginBottom: "12px" }}>
              Showing all available data for this data entry.
            </Alert>
            <JSONViewer data={completeData} />
          </div>
        </div>
      );
    }

    // Last resort: show raw data
    return (
      <div className={styles.dataEntry}>
        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
          <JSONViewer data={entry.data} />
        </div>
      </div>
    );
  }

  // Only return null if we truly have no data
  return null;
};

ContainerDataEntry.propTypes = {
  entry: PropTypes.object.isRequired,
  expandedContainers: PropTypes.instanceOf(Set).isRequired,
  onToggleExpansion: PropTypes.func.isRequired,
};

export default ContainerDataEntry;
